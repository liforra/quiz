// Lazy Firestore → SQLite migration, one user at a time.
//
// The trick that makes this need no service account: verifying a legacy
// password against Firebase's REST endpoint also hands back an ID token *for
// that user*. Reading Firestore over REST with it is subject to the security
// rules you already have — `allow read: if isOwner(userId)` for the user's own
// subtree, `allow read: if isSignedIn()` for the public collections. So every
// user brings their own data across at the moment they migrate, and nobody
// can pull anyone else's private data through here.
//
// This whole file is deletable once everyone has migrated (together with the
// /api/auth/legacy/* routes).

import { db } from './db.js';

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || '';
const APP_ID = process.env.VITE_APP_ID || 'default-app-id';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// --- Firestore REST value decoding ---------------------------------------
// REST returns typed values ({"stringValue": "x"}) rather than plain JSON.

function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
const decodeFields = (fields) => Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, decode(v)]));
const docId = (name) => String(name || '').split('/').pop();

async function getDoc(idToken, path) {
  const res = await fetch(`${BASE}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path} → ${res.status}`);
  const doc = await res.json();
  return { id: docId(doc.name), ...decodeFields(doc.fields) };
}

// showMissing surfaces "implicit" parent documents — ones that exist only
// because they have subcollections (quiz_stats/{quizId} is exactly that).
async function listDocs(idToken, path, { showMissing = false } = {}) {
  const out = [];
  let pageToken = '';
  do {
    const url = new URL(`${BASE}/${path}`);
    url.searchParams.set('pageSize', '300');
    if (showMissing) url.searchParams.set('showMissing', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (res.status === 404 || res.status === 403) return out;
    if (!res.ok) throw new Error(`Firestore LIST ${path} → ${res.status}`);
    const data = await res.json();
    for (const doc of data.documents || []) out.push({ id: docId(doc.name), ...decodeFields(doc.fields) });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

// --- Import --------------------------------------------------------------

const nowIso = () => new Date().toISOString();
const userRoot = (uid) => `artifacts/${APP_ID}/users/${uid}`;

// Ensures a `users` row exists for a legacy Firebase uid. Rows created here
// have no authentik_sub yet — they're adopted later, when that person signs
// in through Authentik (see resolveUser in auth.js).
export function ensurePlaceholderUser(uid, username) {
  const existing = db.prepare('SELECT uid FROM users WHERE uid = ?').get(uid);
  if (existing) return false;
  db.prepare('INSERT INTO users (uid, username, created_at) VALUES (?, ?, ?)')
    .run(uid, username || uid, nowIso());
  return true;
}

// Pulls one user's own subtree. Idempotent: re-running replaces rather than
// duplicates, so a half-finished migration can simply be retried.
export async function importLegacyUser(idToken, uid) {
  const summary = { stats: 0, quizStats: 0, attempts: 0, quizzes: 0, modes: 0 };

  const profile = await getDoc(idToken, userRoot(uid));
  const username = profile?.username || uid;
  ensurePlaceholderUser(uid, username);
  db.prepare('UPDATE users SET username = ?, gravatar_email = ?, hide_from_leaderboard = ? WHERE uid = ?')
    .run(username, profile?.gravatarEmail || '', profile?.hideFromLeaderboard ? 1 : 0, uid);

  const upsertStat = db.prepare(`
    INSERT INTO question_stats (uid, quiz_id, question_id, correct, wrong, last_played)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (uid, quiz_id, question_id) DO UPDATE SET
      correct = excluded.correct, wrong = excluded.wrong, last_played = excluded.last_played
  `);

  for (const s of await listDocs(idToken, `${userRoot(uid)}/stats`)) {
    upsertStat.run(uid, '', s.id, s.correct || 0, s.wrong || 0, s.lastPlayed || null);
    summary.stats++;
  }

  // Per-quiz stats sit two levels down (quiz_stats/{quizId}/stats/{questionId}).
  try {
    for (const quiz of await listDocs(idToken, `${userRoot(uid)}/quiz_stats`, { showMissing: true })) {
      for (const s of await listDocs(idToken, `${userRoot(uid)}/quiz_stats/${quiz.id}/stats`)) {
        upsertStat.run(uid, quiz.id, s.id, s.correct || 0, s.wrong || 0, s.lastPlayed || null);
        summary.quizStats++;
      }
    }
  } catch (e) {
    console.error('quiz_stats import failed (continuing)', e.message);
  }

  db.prepare('DELETE FROM attempts WHERE uid = ?').run(uid);
  const insertAttempt = db.prepare(`
    INSERT INTO attempts (uid, question_id, category, correct, skipped, quiz_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const a of await listDocs(idToken, `${userRoot(uid)}/attempts`)) {
    insertAttempt.run(uid, a.questionId || '', a.category || 'Unknown',
      a.correct ? 1 : 0, a.skipped ? 1 : 0, a.quizId || null, a.timestamp || nowIso());
    summary.attempts++;
  }

  // Fallback: if the nested per-quiz stats couldn't be listed, rebuild them
  // from the attempt log, which carries quizId on every row anyway.
  if (summary.quizStats === 0) {
    const rebuilt = db.prepare(`
      INSERT INTO question_stats (uid, quiz_id, question_id, correct, wrong, last_played)
      SELECT uid, quiz_id, question_id,
             SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END),
             SUM(CASE WHEN correct = 0 AND skipped = 0 THEN 1 ELSE 0 END),
             MAX(timestamp)
      FROM attempts WHERE uid = ? AND quiz_id IS NOT NULL AND quiz_id != ''
      GROUP BY uid, quiz_id, question_id
      ON CONFLICT (uid, quiz_id, question_id) DO NOTHING
    `).run(uid);
    summary.quizStats = rebuilt.changes;
  }

  const upsertQuiz = db.prepare(`
    INSERT INTO quizzes (id, scope, owner_uid, title, icon, modes, questions, author, created_at)
    VALUES (?, 'private', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title, icon = excluded.icon, modes = excluded.modes, questions = excluded.questions
  `);
  for (const q of await listDocs(idToken, `${userRoot(uid)}/quizzes`)) {
    if (!Array.isArray(q.questions)) continue;
    upsertQuiz.run(q.id, uid, q.title || 'Quiz', q.icon || 'BookOpen',
      JSON.stringify(q.modes || []), JSON.stringify(q.questions), q.author || username, q.createdAt || nowIso());
    summary.quizzes++;
  }

  const upsertMode = db.prepare(`
    INSERT INTO custom_modes (id, uid, label, icon, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET label = excluded.label, icon = excluded.icon
  `);
  for (const m of await listDocs(idToken, `${userRoot(uid)}/modes`)) {
    upsertMode.run(m.id, uid, m.label || 'Mode', m.icon || 'BookOpen', m.createdAt || nowIso());
    summary.modes++;
  }

  return summary;
}

// Public quizzes and leaderboards belong to everyone, so whoever migrates
// first drags them across (their rules allow reading both). Entries by users
// who haven't migrated get placeholder rows, which those users adopt when
// they eventually sign in — so nobody loses their leaderboard position.
export async function importPublicData(idToken) {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'public_import_done'").get();
  if (done) return { skipped: true };
  const summary = { quizzes: 0, leaderboards: 0, entries: 0, placeholders: 0 };

  const upsertQuiz = db.prepare(`
    INSERT INTO quizzes (id, scope, owner_uid, title, icon, modes, questions, author, created_at)
    VALUES (?, 'public', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title, icon = excluded.icon, modes = excluded.modes, questions = excluded.questions
  `);
  for (const q of await listDocs(idToken, `artifacts/${APP_ID}/public/data/quizzes`)) {
    if (!Array.isArray(q.questions)) continue;
    const owner = q.authorId || 'unknown';
    if (ensurePlaceholderUser(owner, q.author || owner)) summary.placeholders++;
    upsertQuiz.run(q.id, owner, q.title || 'Quiz', q.icon || 'BookOpen',
      JSON.stringify(q.modes || []), JSON.stringify(q.questions), q.author || '', q.createdAt || nowIso());
    summary.quizzes++;
  }

  for (const lb of await listDocs(idToken, `artifacts/${APP_ID}/public/data/leaderboards`, { showMissing: true })) {
    db.prepare(`
      INSERT INTO leaderboards (quiz_id, title, is_custom, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (quiz_id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
    `).run(lb.id, lb.title || 'Quiz', lb.isCustom || String(lb.id).startsWith('custom-') ? 1 : 0, lb.updatedAt || nowIso());
    summary.leaderboards++;

    for (const e of await listDocs(idToken, `artifacts/${APP_ID}/public/data/leaderboards/${lb.id}/entries`)) {
      if (ensurePlaceholderUser(e.id, e.username || e.id)) summary.placeholders++;
      db.prepare(`
        INSERT INTO leaderboard_entries (quiz_id, uid, username, best_score, best_total, best_percentage, best_time_seconds, last_played)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (quiz_id, uid) DO UPDATE SET
          best_score = excluded.best_score, best_total = excluded.best_total,
          best_percentage = excluded.best_percentage, best_time_seconds = excluded.best_time_seconds,
          last_played = excluded.last_played
      `).run(lb.id, e.id, e.username || 'Unknown', e.bestScore ?? null, e.bestTotal ?? null,
             e.bestPercentage ?? null, e.bestTimeSeconds ?? null, e.lastPlayed || nowIso());
      summary.entries++;
    }
  }

  db.prepare("INSERT INTO meta (key, value) VALUES ('public_import_done', ?)").run(nowIso());
  return summary;
}
