// The data API — everything the client used to do against Firestore directly.
//
// Access control moved from firestore.rules to this file: every route reads
// req.user (set by sessionMiddleware) and scopes its SQL by req.user.uid.
// There is no client-supplied uid anywhere; that's what makes forging another
// user's stats or leaderboard entry impossible.
//
// The client used 8 realtime listeners. Live updates only ever mattered for
// leaderboards (other people's scores) — a user's own data changes only from
// their own tab, so /bootstrap on load plus refetch-after-write is equivalent
// and far cheaper.

import express from 'express';
import crypto from 'crypto';
import { db, toUser, toQuiz, toEntry, toActivity } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';

export const dataRouter = express.Router();
dataRouter.use(express.json({ limit: '10mb' })); // quiz uploads carry full question sets

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomBytes(12).toString('base64url');

// --- Reads ---------------------------------------------------------------

const readStats = (uid, quizId = '') =>
  Object.fromEntries(
    db.prepare('SELECT question_id, correct, wrong, last_played FROM question_stats WHERE uid = ? AND quiz_id = ?')
      .all(uid, quizId)
      .map(r => [r.question_id, { correct: r.correct, wrong: r.wrong, lastPlayed: r.last_played }])
  );

const readAttempts = (uid) =>
  db.prepare('SELECT question_id, category, correct, skipped, quiz_id, timestamp FROM attempts WHERE uid = ? ORDER BY timestamp')
    .all(uid)
    .map(r => ({ questionId: r.question_id, category: r.category, correct: !!r.correct, skipped: !!r.skipped, quizId: r.quiz_id, timestamp: r.timestamp }));

// One round trip for the whole app state — replaces five onSnapshot listeners.
dataRouter.get('/api/data/bootstrap', requireAuth, (req, res) => {
  const uid = req.user.uid;
  res.json({
    user: toUser(req.user),
    stats: readStats(uid),
    attempts: readAttempts(uid),
    privateQuizzes: db.prepare("SELECT * FROM quizzes WHERE scope = 'private' AND owner_uid = ? ORDER BY created_at").all(uid).map(toQuiz),
    publicQuizzes: db.prepare("SELECT * FROM quizzes WHERE scope = 'public' ORDER BY created_at").all().map(toQuiz),
    customModes: db.prepare('SELECT id, label, icon, created_at FROM custom_modes WHERE uid = ? ORDER BY created_at').all(uid)
      .map(r => ({ id: r.id, label: r.label, icon: r.icon, createdAt: r.created_at }))
  });
});

// Per-quiz stats are only needed once a quiz is actually open.
dataRouter.get('/api/data/quiz-stats/:quizId', requireAuth, (req, res) => {
  res.json({ stats: readStats(req.user.uid, req.params.quizId) });
});

// --- Profile -------------------------------------------------------------

dataRouter.patch('/api/data/profile', requireAuth, (req, res) => {
  const { gravatarEmail, hideFromLeaderboard } = req.body || {};
  const hide = hideFromLeaderboard ? 1 : 0;
  db.prepare('UPDATE users SET gravatar_email = ?, hide_from_leaderboard = ? WHERE uid = ?')
    .run(String(gravatarEmail || '').trim(), hide, req.user.uid);

  // Opting out also erases existing entries. In Firestore this needed a
  // leaderboardQuizIds array on the user doc to avoid a collectionGroup query;
  // in SQL it's one indexed DELETE.
  if (hide) db.prepare('DELETE FROM leaderboard_entries WHERE uid = ?').run(req.user.uid);

  res.json({ ok: true });
});

// --- Answering -----------------------------------------------------------

// One call per answered question. Firestore needed three round trips here
// (global stat, per-quiz stat, attempt log); this is one transaction.
const recordAnswer = db.prepare(`
  INSERT INTO question_stats (uid, quiz_id, question_id, correct, wrong, last_played)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (uid, quiz_id, question_id) DO UPDATE SET
    correct = correct + excluded.correct,
    wrong   = wrong   + excluded.wrong,
    last_played = excluded.last_played
`);

dataRouter.post('/api/data/answer', requireAuth, (req, res) => {
  const { questionId, quizId, category, correct, skipped } = req.body || {};
  if (!questionId) return res.status(400).json({ error: 'missing_question_id' });
  const uid = req.user.uid;
  const inc = correct ? [1, 0] : [0, 1];
  const ts = nowIso();

  db.exec('BEGIN');
  try {
    recordAnswer.run(uid, '', String(questionId), inc[0], inc[1], ts);
    if (quizId) recordAnswer.run(uid, String(quizId), String(questionId), inc[0], inc[1], ts);
    db.prepare(`
      INSERT INTO attempts (uid, question_id, category, correct, skipped, quiz_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uid, String(questionId), category || 'Unknown', correct ? 1 : 0, skipped ? 1 : 0, quizId || null, ts);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Failed to record answer', e);
    return res.status(500).json({ error: 'write_failed' });
  }
  res.json({ ok: true });
});

// --- Activity log --------------------------------------------------------
//
// A record of *when* the user worked (sessions started/finished, how long,
// what), meant to be shown to someone else as evidence of practice time.
// Deliberately separate from `attempts`: this one is opt-out and clearable,
// and dropping it costs no learning data.
//
// Timestamps come from the server clock, never the request body — a log the
// client could backdate would prove nothing. The client only supplies what it
// alone knows (which quiz, how many questions, the score).

const ACTIVITY_KINDS = new Set(['quiz_start', 'quiz_finish', 'exam_start', 'exam_finish']);
const MAX_ACTIVITY_LIMIT = 1000;

// Clamps a client-supplied number into a sane range, or null if absent.
const optInt = (v, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : null);

dataRouter.post('/api/data/activity', requireAuth, (req, res) => {
  // The opt-out is enforced here, not just in the UI, so a stale tab that
  // still thinks tracking is on can't keep writing rows after it was turned off.
  if (!req.user.log_activity) return res.json({ ok: true, skipped: 'logging_disabled' });

  const { kind, title, quizId, questionCount, score, total, durationSeconds, startedAt } = req.body || {};
  if (!ACTIVITY_KINDS.has(kind)) return res.status(400).json({ error: 'bad_kind' });

  // A client-supplied startedAt is only accepted as an ISO string that isn't
  // in the future; anything else falls back to "unknown" rather than being
  // trusted. 24h caps the duration so a tab left open overnight can't book
  // itself a day of work.
  let started = null;
  if (typeof startedAt === 'string') {
    const ms = Date.parse(startedAt);
    if (Number.isFinite(ms) && ms <= Date.now()) started = new Date(ms).toISOString();
  }

  const info = db.prepare(`
    INSERT INTO activity_log (uid, kind, title, quiz_id, question_count, score, total, duration_seconds, started_at, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.uid, kind, String(title || '').slice(0, 200), quizId ? String(quizId) : null,
    optInt(questionCount, 10_000), optInt(score, 10_000), optInt(total, 10_000),
    optInt(durationSeconds, 24 * 3600), started, nowIso()
  );
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

const readActivity = (uid, limit) =>
  db.prepare('SELECT * FROM activity_log WHERE uid = ? ORDER BY timestamp DESC, id DESC LIMIT ?')
    .all(uid, limit)
    .map(toActivity);

dataRouter.get('/api/data/activity', requireAuth, (req, res) => {
  const limit = Math.max(1, Math.min(MAX_ACTIVITY_LIMIT, Number(req.query.limit) || 200));
  res.json({
    enabled: !!req.user.log_activity,
    total: db.prepare('SELECT COUNT(*) AS n FROM activity_log WHERE uid = ?').get(req.user.uid).n,
    entries: readActivity(req.user.uid, limit)
  });
});

// A CSV is what actually gets handed to somebody (or opened in Excel) as
// proof — the JSON export at /api/settings/export is for taking your data
// with you, which is a different job.
dataRouter.get('/api/data/activity/export.csv', requireAuth, (req, res) => {
  const rows = readActivity(req.user.uid, MAX_ACTIVITY_LIMIT);
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Semicolon-separated: German Excel splits on ';' by default, and a
  // comma-separated file would land in a single column there.
  const lines = [['timestamp', 'kind', 'title', 'started_at', 'duration_seconds', 'score', 'total', 'questions'].join(';')];
  for (const r of rows.slice().reverse()) {
    lines.push([r.timestamp, r.kind, r.title, r.startedAt, r.durationSeconds, r.score, r.total, r.questionCount].map(escape).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="quiz-logbuch-${req.user.username}.csv"`);
  res.send('﻿' + lines.join('\n')); // BOM so Excel reads the umlauts as UTF-8
});

dataRouter.delete('/api/data/activity', requireAuth, (req, res) => {
  const { changes } = db.prepare('DELETE FROM activity_log WHERE uid = ?').run(req.user.uid);
  res.json({ ok: true, deleted: changes });
});

// --- Quizzes -------------------------------------------------------------

dataRouter.post('/api/data/quizzes', requireAuth, (req, res) => {
  const { scope, title, icon, modes, questions } = req.body || {};
  if (scope !== 'private' && scope !== 'public') return res.status(400).json({ error: 'bad_scope' });
  if (!Array.isArray(questions) || questions.length === 0) return res.status(400).json({ error: 'no_questions' });

  const id = newId();
  db.prepare(`
    INSERT INTO quizzes (id, scope, owner_uid, title, icon, modes, questions, author, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, scope, req.user.uid, title || 'Quiz', icon || 'BookOpen',
         JSON.stringify(modes || []), JSON.stringify(questions), req.user.username, nowIso());
  res.json({ id });
});

// Only the owner may edit or delete — including for public quizzes, which
// anyone can *read* but only the author can change.
function ownedQuiz(req, res) {
  const row = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!row) { res.status(404).json({ error: 'not_found' }); return null; }
  if (row.owner_uid !== req.user.uid && !req.user.is_admin) { res.status(403).json({ error: 'forbidden' }); return null; }
  return row;
}

dataRouter.patch('/api/data/quizzes/:id', requireAuth, (req, res) => {
  if (!ownedQuiz(req, res)) return;
  const { title, icon, modes } = req.body || {};
  db.prepare('UPDATE quizzes SET title = ?, icon = ?, modes = ? WHERE id = ?')
    .run(title || 'Quiz', icon || 'BookOpen', JSON.stringify(modes || []), req.params.id);
  res.json({ ok: true });
});

dataRouter.delete('/api/data/quizzes/:id', requireAuth, (req, res) => {
  if (!ownedQuiz(req, res)) return;
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Custom modes --------------------------------------------------------

dataRouter.post('/api/data/modes', requireAuth, (req, res) => {
  const { label, icon } = req.body || {};
  if (!label) return res.status(400).json({ error: 'missing_label' });
  const id = newId();
  db.prepare('INSERT INTO custom_modes (id, uid, label, icon, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.uid, label, icon || 'BookOpen', nowIso());
  res.json({ id });
});

dataRouter.delete('/api/data/modes/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM custom_modes WHERE id = ? AND uid = ?').run(req.params.id, req.user.uid);
  res.json({ ok: true });
});

// --- Leaderboards --------------------------------------------------------

dataRouter.get('/api/data/leaderboards', requireAuth, (req, res) => {
  res.json({
    leaderboards: db.prepare(`
      SELECT l.quiz_id, l.title, l.is_custom, l.updated_at, COUNT(e.uid) AS entry_count
      FROM leaderboards l LEFT JOIN leaderboard_entries e ON e.quiz_id = l.quiz_id
      GROUP BY l.quiz_id ORDER BY l.updated_at DESC
    `).all().map(r => ({
      quizId: r.quiz_id, title: r.title, isCustom: !!r.is_custom,
      updatedAt: r.updated_at, entryCount: r.entry_count
    }))
  });
});

dataRouter.get('/api/data/leaderboards/:quizId', requireAuth, (req, res) => {
  res.json({
    entries: db.prepare(`
      SELECT * FROM leaderboard_entries WHERE quiz_id = ?
      ORDER BY best_percentage DESC, best_time_seconds ASC
    `).all(req.params.quizId).map(toEntry)
  });
});

// Submits a result. The server decides what counts as an improvement, so a
// tampered client can't post a fake "best" that overwrites a real one with
// something worse — and the score itself is bounded by the submitted total.
dataRouter.post('/api/data/leaderboards/:quizId', requireAuth, (req, res) => {
  if (req.user.hide_from_leaderboard) return res.json({ ok: true, skipped: 'opted_out' });
  const quizId = req.params.quizId;
  const { title, score, total, timeSeconds } = req.body || {};
  if (!quizId || !Number.isFinite(score) || !Number.isFinite(total) || total <= 0) {
    return res.status(400).json({ error: 'bad_result' });
  }
  const clampedScore = Math.max(0, Math.min(total, score));
  const percentage = Math.round((clampedScore / total) * 100);
  const seconds = Math.max(0, Math.round(timeSeconds || 0));
  const ts = nowIso();

  db.prepare(`
    INSERT INTO leaderboards (quiz_id, title, is_custom, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (quiz_id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
  `).run(quizId, title || 'Quiz', quizId.startsWith('custom-') ? 1 : 0, ts);

  const prev = db.prepare('SELECT * FROM leaderboard_entries WHERE quiz_id = ? AND uid = ?').get(quizId, req.user.uid);
  const isImprovement = !prev || percentage > prev.best_percentage ||
    (percentage === prev.best_percentage && seconds < (prev.best_time_seconds ?? Infinity));

  if (isImprovement) {
    db.prepare(`
      INSERT INTO leaderboard_entries (quiz_id, uid, username, best_score, best_total, best_percentage, best_time_seconds, last_played)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (quiz_id, uid) DO UPDATE SET
        username = excluded.username, best_score = excluded.best_score, best_total = excluded.best_total,
        best_percentage = excluded.best_percentage, best_time_seconds = excluded.best_time_seconds,
        last_played = excluded.last_played
    `).run(quizId, req.user.uid, req.user.username, clampedScore, total, percentage, seconds, ts);
  } else {
    db.prepare('UPDATE leaderboard_entries SET username = ?, last_played = ? WHERE quiz_id = ? AND uid = ?')
      .run(req.user.username, ts, quizId, req.user.uid);
  }
  res.json({ ok: true, improved: isImprovement });
});

// --- AI usage ---

// Recorded per AI call so the admin panel can see who is burning through the
// shared Groq quota. Counting happens here rather than in the client's own
// document (as it did in Firestore), so the numbers can't be edited away.
dataRouter.post('/api/data/ai-usage', requireAuth, (req, res) => {
  const tokens = Math.max(0, Number(req.body?.totalTokens) || 0);
  const ts = nowIso();
  db.prepare(`
    INSERT INTO ai_usage (uid, total_requests, total_tokens, first_used, last_used)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT (uid) DO UPDATE SET
      total_requests = total_requests + 1,
      total_tokens   = total_tokens + excluded.total_tokens,
      last_used      = excluded.last_used
  `).run(req.user.uid, tokens, ts, ts);
  res.json({ ok: true });
});

dataRouter.get('/api/data/admin/ai-usage', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.username FROM ai_usage a JOIN users u ON u.uid = a.uid
    ORDER BY a.total_tokens DESC
  `).all();
  res.json({
    usage: rows.map(r => {
      // Floor at one minute so a handful of requests seconds apart don't
      // produce a wildly inflated (or infinite) per-minute rate.
      const minutes = Math.max(1, (new Date(r.last_used).getTime() - new Date(r.first_used).getTime()) / 60000);
      return {
        uid: r.uid,
        username: r.username || 'Unknown',
        totalRequests: r.total_requests,
        totalTokens: r.total_tokens,
        avgRequestsPerMin: r.total_requests / minutes,
        avgTokensPerMin: r.total_tokens / minutes
      };
    })
  });
});

// --- Admin ---------------------------------------------------------------

dataRouter.get('/api/data/admin/users', requireAdmin, (req, res) => {
  res.json({
    users: db.prepare(`
      SELECT u.uid, u.username, u.email, u.last_login, u.authentik_sub, u.legacy_firebase_uid, u.deactivated_at,
             (SELECT COUNT(*) FROM attempts a WHERE a.uid = u.uid) AS attempt_count
      FROM users u ORDER BY u.username
    `).all().map(r => ({
      uid: r.uid, username: r.username, email: r.email, lastLogin: r.last_login,
      migrated: !!r.legacy_firebase_uid, linked: !!r.authentik_sub,
      deactivatedAt: r.deactivated_at || null, attemptCount: r.attempt_count
    }))
  });
});

// Undoing a deactivation has to be an admin action: a deactivated user can't
// sign in, so they can't reach any endpoint of their own to reverse it.
dataRouter.post('/api/data/admin/users/:uid/reactivate', requireAdmin, (req, res) => {
  const r = db.prepare('UPDATE users SET deactivated_at = NULL WHERE uid = ?').run(req.params.uid);
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

dataRouter.get('/api/data/admin/users/:uid', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE uid = ?').get(req.params.uid);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({
    user: toUser(row),
    stats: readStats(row.uid),
    attempts: readAttempts(row.uid),
    quizzes: db.prepare("SELECT * FROM quizzes WHERE owner_uid = ? AND scope = 'private'").all(row.uid).map(toQuiz)
  });
});
