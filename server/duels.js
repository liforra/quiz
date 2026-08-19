// 1v1 duels — the "health bar" mode.
//
// Two players race through the *same* question list. Every correct answer
// takes HP off the opponent; whoever drops to 0 first loses. Both fight at
// their own pace (there are no turns) — being fast is an advantage because
// damage lands the moment you answer, not when the other one catches up.
//
// Three things make this different from the rest of the app:
//
// 1. The questions live here, not in the client. Everywhere else a client
//    that peeks at the answers only cheats itself; in a duel it would beat
//    somebody else, so /api/duels/* hands out questions with `answer`
//    stripped and does the grading itself.
// 2. The client submits *option indices*, not answer text. The UI renders
//    DE or EN (and shuffles the option order locally), so the text it shows
//    is not necessarily the text stored here — an index is language- and
//    order-independent, and it's all the server needs to grade.
// 3. Every state transition is computed lazily in settle(), on read. No
//    timers, no in-memory match registry: a duel that ends because someone
//    closed their tab is decided the next time anyone looks at it, which
//    also means a server restart can't leave matches hanging forever.

import express from 'express';
import crypto from 'crypto';
import { db } from './db.js';
import { requireAuth } from './auth.js';

export const duelRouter = express.Router();
duelRouter.use(express.json({ limit: '4mb' }));

// --- Rules ---------------------------------------------------------------
// All tunable in one place: a duel is ~10 correct answers long, so a 20
// question match usually ends in a KO before the list runs out.

const MAX_HP = 100;
const BASE_DAMAGE = 10;
// Consecutive correct answers hit harder (10 → 12 → 14 → 16), which is what
// makes a comeback possible: catching up needs a run, not just parity.
const COMBO_STEP = 2;
const COMBO_CAP = 3;

const MIN_QUESTIONS = 4;
const MAX_QUESTIONS = 50;

// A backgrounded browser tab has its timers throttled to roughly one tick per
// minute, so "hasn't polled in 90s" is the earliest we can call someone gone
// without kicking a player who merely switched tabs.
const DISCONNECT_MS = 90_000;
const FRESH_MS = 30_000;       // the survivor has to be demonstrably present to win by default
const MATCH_MAX_MS = 20 * 60_000;
const LOBBY_MAX_MS = 20 * 60_000;

const EVENT_LIMIT = 25;

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomBytes(9).toString('base64url');
const ageMs = (iso) => (iso ? Date.now() - Date.parse(iso) : Infinity);

// No 0/O/1/I — the code gets read out loud or typed from a screenshot.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = Array.from(crypto.randomBytes(4), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (!db.prepare('SELECT 1 FROM duels WHERE code = ?').get(code)) return code;
  }
  throw new Error('could_not_allocate_code');
}

// --- Question handling ---------------------------------------------------

const isMultiple = (type) => type === 'multiple' || type === 'multiple_response';

// Free-text questions are deliberately excluded: they need an AI round trip
// to grade, which costs seconds and shared Groq quota — neither belongs in a
// race where the other player is answering meanwhile.
function sanitizeQuestions(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw.question !== 'string' || !Array.isArray(raw.options)) continue;
    const type = isMultiple(raw.type) ? 'multiple' : 'single';
    const options = raw.options.filter(o => typeof o === 'string').slice(0, 10);
    if (options.length < 2) continue;

    const answers = (Array.isArray(raw.answer) ? raw.answer : [raw.answer]).filter(a => typeof a === 'string');
    // Every correct answer has to actually be one of the options, or the
    // question is ungradeable here — better to drop it while building the
    // duel than to hand a player something nobody can win.
    if (answers.length === 0 || !answers.every(a => options.includes(a))) continue;
    if (type === 'single' && answers.length !== 1) continue;

    out.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : `duel_${out.length}`,
      type,
      category: typeof raw.category === 'string' ? raw.category : 'Unknown',
      question: raw.question,
      options,
      answer: type === 'multiple' ? answers : answers[0],
      explanation: typeof raw.explanation === 'string' ? raw.explanation : null,
      translations: raw.translations && typeof raw.translations === 'object' ? raw.translations : null
    });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

// Translations carry their own copy of `answer` (and `explanation`), so the
// same stripping has to happen per language — otherwise switching the UI to
// English would hand over exactly what we withheld in German.
function publicTranslations(translations) {
  if (!translations) return undefined;
  const out = {};
  for (const [lang, value] of Object.entries(translations)) {
    if (!value || typeof value !== 'object') continue;
    out[lang] = { question: value.question, options: value.options };
  }
  return out;
}

const publicQuestion = (q, index) => ({
  index,
  id: q.id,
  type: q.type,
  category: q.category,
  question: q.question,
  options: q.options,
  translations: publicTranslations(q.translations)
});

const correctIndexesOf = (q) => {
  const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
  return q.options.map((o, i) => (answers.includes(o) ? i : -1)).filter(i => i >= 0);
};

function isPickCorrect(q, picked) {
  const correct = correctIndexesOf(q);
  const unique = [...new Set(picked)].sort((a, b) => a - b);
  if (q.type === 'multiple') {
    return unique.length === correct.length && unique.every((i, n) => i === correct[n]);
  }
  return unique.length === 1 && correct.includes(unique[0]);
}

const damageFor = (streakBefore) => BASE_DAMAGE + COMBO_STEP * Math.min(streakBefore, COMBO_CAP);

// --- Row access ----------------------------------------------------------

const getDuel = (id) => db.prepare('SELECT * FROM duels WHERE id = ?').get(id);
// Joined against users so a player row carries the Gravatar address too — the
// arena draws both fighters as avatars, and the opponent's picture can only
// come from here.
const playersOf = (duelId) =>
  db.prepare(`
    SELECT p.*, u.gravatar_email FROM duel_players p
    LEFT JOIN users u ON u.uid = p.uid
    WHERE p.duel_id = ? ORDER BY p.rowid
  `).all(duelId);

// Gravatar's own scheme: SHA-256 of the trimmed, lowercased address. Hashing
// server-side keeps the raw address out of the response — and it only exists
// at all for users who deliberately entered one in their profile.
const avatarHashOf = (email) => {
  const clean = String(email || '').trim().toLowerCase();
  return clean ? crypto.createHash('sha256').update(clean).digest('hex') : null;
};
const questionsOf = (duel) => JSON.parse(duel.questions);

const logEvent = (duelId, uid, kind, damage = null, questionIndex = null) =>
  db.prepare('INSERT INTO duel_events (duel_id, uid, kind, damage, question_index, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
    .run(duelId, uid, kind, damage, questionIndex, nowIso());

function finish(duelId, winnerUid, reason) {
  const { changes } = db.prepare(`
    UPDATE duels SET status = 'finished', winner_uid = ?, end_reason = ?, finished_at = ?
    WHERE id = ? AND status = 'active'
  `).run(winnerUid, reason, nowIso(), duelId);
  if (changes) logEvent(duelId, winnerUid, 'end');
}

// Whoever has more HP takes it; equal HP is broken by the number of correct
// answers, and a genuine tie ends as a draw (winner NULL).
function decideOnPoints(players) {
  const [a, b] = players;
  if (a.hp !== b.hp) return a.hp > b.hp ? a.uid : b.uid;
  if (a.correct !== b.correct) return a.correct > b.correct ? a.uid : b.uid;
  return null;
}

// The whole match lifecycle, evaluated on every read. Returns the (possibly
// updated) duel row.
function settle(duel) {
  if (!duel) return duel;

  if (duel.status === 'waiting') {
    if (ageMs(duel.created_at) > LOBBY_MAX_MS) {
      db.prepare("UPDATE duels SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'waiting'")
        .run(nowIso(), duel.id);
      return getDuel(duel.id);
    }
    return duel;
  }
  if (duel.status !== 'active') return duel;

  const players = playersOf(duel.id);
  // Deleting an account cascades its duel_players row away (GDPR deletion is
  // a hard delete), which would otherwise leave the survivor polling an
  // active match that can never end.
  if (players.length !== 2) {
    finish(duel.id, players[0]?.uid ?? null, 'disconnect');
    return getDuel(duel.id);
  }
  const questionCount = questionsOf(duel).length;

  const knockedOut = players.filter(p => p.hp <= 0);
  if (knockedOut.length) {
    // Both at zero can't happen through damage (a hit that kills ends the
    // match), but a draw is still the honest answer if it somehow does.
    finish(duel.id, knockedOut.length === 2 ? null : players.find(p => p.hp > 0).uid, 'ko');
  } else if (players.every(p => p.question_index >= questionCount)) {
    finish(duel.id, decideOnPoints(players), 'exhausted');
  } else if (ageMs(duel.started_at) > MATCH_MAX_MS) {
    finish(duel.id, decideOnPoints(players), 'timeout');
  } else {
    const gone = players.filter(p => ageMs(p.last_seen) > DISCONNECT_MS);
    const present = players.filter(p => ageMs(p.last_seen) <= FRESH_MS);
    if (gone.length === 2) finish(duel.id, null, 'disconnect');
    else if (gone.length === 1 && present.length === 1) finish(duel.id, present[0].uid, 'disconnect');
  }
  return getDuel(duel.id);
}

// --- State shape ---------------------------------------------------------

const toPlayer = (p, maxHp) => p && ({
  uid: p.uid,
  username: p.username,
  avatarHash: avatarHashOf(p.gravatar_email),
  hp: Math.max(0, p.hp),
  maxHp,
  questionIndex: p.question_index,
  correct: p.correct,
  wrong: p.wrong,
  streak: p.streak,
  damageDealt: p.damage_dealt,
  connected: ageMs(p.last_seen) <= DISCONNECT_MS
});

function stateFor(duel, uid) {
  const players = playersOf(duel.id);
  const me = players.find(p => p.uid === uid);
  const opponent = players.find(p => p.uid !== uid);
  const questions = questionsOf(duel);

  // Only ever the question the player is actually on — handing out the rest
  // of the list would let a client pre-read (and pre-answer) everything.
  const question = duel.status === 'active' && me && me.hp > 0 && me.question_index < questions.length
    ? publicQuestion(questions[me.question_index], me.question_index)
    : null;

  return {
    id: duel.id,
    code: duel.code,
    status: duel.status,
    title: duel.title,
    quizId: duel.quiz_id,
    maxHp: duel.max_hp,
    questionCount: questions.length,
    baseDamage: BASE_DAMAGE,
    winnerUid: duel.winner_uid,
    endReason: duel.end_reason,
    isHost: duel.host_uid === uid,
    createdAt: duel.created_at,
    startedAt: duel.started_at,
    finishedAt: duel.finished_at,
    me: toPlayer(me, duel.max_hp) || null,
    opponent: toPlayer(opponent, duel.max_hp) || null,
    question,
    events: db.prepare('SELECT * FROM duel_events WHERE duel_id = ? ORDER BY id DESC LIMIT ?')
      .all(duel.id, EVENT_LIMIT)
      .map(e => ({ id: e.id, uid: e.uid, kind: e.kind, damage: e.damage, questionIndex: e.question_index, timestamp: e.timestamp }))
  };
}

// Reading the state doubles as the presence heartbeat — a client that stops
// polling is a client whose player has left the fight (see settle()).
function touch(duelId, uid) {
  db.prepare('UPDATE duel_players SET last_seen = ? WHERE duel_id = ? AND uid = ?').run(nowIso(), duelId, uid);
}

// Loads a duel the caller is actually part of, settling it on the way.
function loadForPlayer(req, res) {
  const duel = getDuel(req.params.id);
  if (!duel) { res.status(404).json({ error: 'not_found' }); return null; }
  if (duel.host_uid !== req.user.uid && duel.guest_uid !== req.user.uid) {
    res.status(403).json({ error: 'not_your_duel' });
    return null;
  }
  return settle(duel);
}

// --- Routes --------------------------------------------------------------

// Create a lobby. The questions come from the host's client because that's
// where the library lives (built-in quizzes ship in the bundle, not the DB) —
// but from here on they are the server's copy, and the guest only ever sees
// what this route stored.
duelRouter.post('/api/duels', requireAuth, (req, res) => {
  const { title, quizId, questions } = req.body || {};
  const clean = sanitizeQuestions(questions);
  if (clean.length < MIN_QUESTIONS) return res.status(400).json({ error: 'not_enough_questions' });

  const uid = req.user.uid;
  const ts = nowIso();
  const id = newId();

  db.exec('BEGIN');
  try {
    // One open lobby per person: an abandoned one would otherwise sit in the
    // list forever inviting people into a match nobody is waiting for.
    const stale = db.prepare("SELECT id FROM duels WHERE host_uid = ? AND status = 'waiting'").all(uid);
    for (const row of stale) {
      db.prepare("UPDATE duels SET status = 'cancelled', finished_at = ? WHERE id = ?").run(ts, row.id);
    }

    db.prepare(`
      INSERT INTO duels (id, code, status, title, quiz_id, questions, max_hp, host_uid, created_at)
      VALUES (?, ?, 'waiting', ?, ?, ?, ?, ?, ?)
    `).run(id, newCode(), String(title || 'Duell').slice(0, 120), quizId ? String(quizId) : null,
           JSON.stringify(clean), MAX_HP, uid, ts);

    db.prepare(`
      INSERT INTO duel_players (duel_id, uid, username, hp, last_seen) VALUES (?, ?, ?, ?, ?)
    `).run(id, uid, req.user.username, MAX_HP, ts);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Failed to create duel', e);
    return res.status(500).json({ error: 'create_failed' });
  }
  res.json({ duel: stateFor(getDuel(id), uid) });
});

// Open lobbies anyone can drop into, plus the caller's own (so the hub can
// show "your lobby is waiting" without a second request).
duelRouter.get('/api/duels/open', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, u.username AS host_username
    FROM duels d JOIN users u ON u.uid = d.host_uid
    WHERE d.status = 'waiting' ORDER BY d.created_at DESC LIMIT 30
  `).all();
  res.json({
    duels: rows
      .filter(d => ageMs(d.created_at) <= LOBBY_MAX_MS)
      .map(d => ({
        id: d.id,
        code: d.code,
        title: d.title,
        host: d.host_username,
        questionCount: JSON.parse(d.questions).length,
        createdAt: d.created_at,
        mine: d.host_uid === req.user.uid
      }))
  });
});

// What the hub needs on load: a match to rejoin (a reload mid-duel must not
// cost the fight) and how the last few went.
duelRouter.get('/api/duels/mine', requireAuth, (req, res) => {
  const uid = req.user.uid;
  const rows = db.prepare(`
    SELECT * FROM duels WHERE host_uid = ? OR guest_uid = ? ORDER BY created_at DESC LIMIT 40
  `).all(uid, uid);

  const active = [];
  const recent = [];
  for (const row of rows) {
    const duel = settle(row);
    if (duel.status === 'waiting' || duel.status === 'active') {
      active.push({ id: duel.id, code: duel.code, title: duel.title, status: duel.status });
    } else if (duel.status === 'finished' && recent.length < 10) {
      const players = playersOf(duel.id);
      const me = players.find(p => p.uid === uid);
      const opponent = players.find(p => p.uid !== uid);
      recent.push({
        id: duel.id,
        title: duel.title,
        finishedAt: duel.finished_at,
        endReason: duel.end_reason,
        outcome: duel.winner_uid === uid ? 'win' : duel.winner_uid ? 'loss' : 'draw',
        opponent: opponent?.username || null,
        myHp: me ? Math.max(0, me.hp) : null,
        opponentHp: opponent ? Math.max(0, opponent.hp) : null
      });
    }
  }
  res.json({ active, recent });
});

// Join by code (typed in) or by id (tapped in the open list) — same
// transition either way, so it's one route.
duelRouter.post('/api/duels/join', requireAuth, (req, res) => {
  const { code, id } = req.body || {};
  const duel = id
    ? getDuel(String(id))
    : db.prepare('SELECT * FROM duels WHERE code = ?').get(String(code || '').trim().toUpperCase());
  if (!duel) return res.status(404).json({ error: 'duel_not_found' });

  const settled = settle(duel);
  const uid = req.user.uid;
  // Rejoining a duel you're already in is a normal reload, not an error.
  if (settled.host_uid === uid || settled.guest_uid === uid) {
    touch(settled.id, uid);
    return res.json({ duel: stateFor(settled, uid) });
  }
  if (settled.status !== 'waiting') return res.status(409).json({ error: 'duel_not_open' });

  const ts = nowIso();
  db.exec('BEGIN');
  try {
    // Guarded UPDATE rather than a read-then-write: two people tapping the
    // same lobby at the same moment would otherwise both become the guest.
    const { changes } = db.prepare(`
      UPDATE duels SET guest_uid = ?, status = 'active', started_at = ?
      WHERE id = ? AND status = 'waiting' AND guest_uid IS NULL
    `).run(uid, ts, settled.id);
    if (!changes) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: 'duel_full' });
    }
    db.prepare('INSERT INTO duel_players (duel_id, uid, username, hp, last_seen) VALUES (?, ?, ?, ?, ?)')
      .run(settled.id, uid, req.user.username, settled.max_hp, ts);
    // Both fighters get their clock reset at the start, so the host's idle
    // time in the lobby can't count as a disconnect one second into the match.
    db.prepare('UPDATE duel_players SET last_seen = ? WHERE duel_id = ?').run(ts, settled.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Failed to join duel', e);
    return res.status(500).json({ error: 'join_failed' });
  }
  logEvent(settled.id, uid, 'join');
  res.json({ duel: stateFor(getDuel(settled.id), uid) });
});

duelRouter.get('/api/duels/:id', requireAuth, (req, res) => {
  const duel = loadForPlayer(req, res);
  if (!duel) return;
  if (duel.status === 'active') touch(duel.id, req.user.uid);
  res.json({ duel: stateFor(duel, req.user.uid) });
});

// The only route that can change HP. `picked` is a list of option indices
// into the *stored* question, which is why a translated or reshuffled client
// view still grades correctly.
duelRouter.post('/api/duels/:id/answer', requireAuth, (req, res) => {
  const duel = loadForPlayer(req, res);
  if (!duel) return;
  const uid = req.user.uid;
  if (duel.status !== 'active') return res.status(409).json({ error: 'duel_not_active', duel: stateFor(duel, uid) });

  const players = playersOf(duel.id);
  const me = players.find(p => p.uid === uid);
  const opponent = players.find(p => p.uid !== uid);
  if (!me || !opponent) return res.status(409).json({ error: 'duel_incomplete' });

  const questions = questionsOf(duel);
  const index = Number(req.body?.index);
  // The index is checked against the server's own cursor, so a replayed or
  // out-of-order request can't answer the same question twice for damage.
  if (!Number.isInteger(index) || index !== me.question_index || index >= questions.length) {
    return res.status(409).json({ error: 'out_of_sync', duel: stateFor(duel, uid) });
  }

  const question = questions[index];
  const picked = Array.isArray(req.body?.picked) ? req.body.picked : [req.body?.picked];
  const pickedIndexes = picked
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 0 && n < question.options.length);
  const skipped = pickedIndexes.length === 0;
  const correct = !skipped && isPickCorrect(question, pickedIndexes);
  const damage = correct ? damageFor(me.streak) : 0;
  const ts = nowIso();

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE duel_players
      SET question_index = question_index + 1, correct = correct + ?, wrong = wrong + ?,
          streak = ?, damage_dealt = damage_dealt + ?, last_seen = ?
      WHERE duel_id = ? AND uid = ?
    `).run(correct ? 1 : 0, correct ? 0 : 1, correct ? me.streak + 1 : 0, damage, ts, duel.id, uid);

    if (damage) {
      db.prepare('UPDATE duel_players SET hp = hp - ? WHERE duel_id = ? AND uid = ?').run(damage, duel.id, opponent.uid);
    }
    db.prepare('INSERT INTO duel_events (duel_id, uid, kind, damage, question_index, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(duel.id, uid, correct ? 'hit' : 'miss', damage || null, index, ts);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Failed to record duel answer', e);
    return res.status(500).json({ error: 'answer_failed' });
  }

  const after = settle(getDuel(duel.id));
  res.json({
    correct,
    damage,
    // Returned only now, with the verdict — this is the first moment the
    // client is allowed to know the answer to this question.
    correctIndexes: correctIndexesOf(question),
    explanation: question.explanation,
    duel: stateFor(after, uid)
  });
});

// Leaving: closes an unstarted lobby, or hands the win to the opponent.
duelRouter.post('/api/duels/:id/forfeit', requireAuth, (req, res) => {
  const duel = loadForPlayer(req, res);
  if (!duel) return;
  const uid = req.user.uid;

  if (duel.status === 'waiting') {
    db.prepare("UPDATE duels SET status = 'cancelled', finished_at = ? WHERE id = ?").run(nowIso(), duel.id);
  } else if (duel.status === 'active') {
    const opponent = playersOf(duel.id).find(p => p.uid !== uid);
    finish(duel.id, opponent?.uid ?? null, 'forfeit');
  }
  res.json({ duel: stateFor(getDuel(duel.id), uid) });
});
