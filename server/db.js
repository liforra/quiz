// SQLite data layer — replaces Firestore.
//
// node:sqlite is built into Node (>=22.5, stable since 24), so this needs no
// native dependency and no build step. The whole app is a single process with
// one writer, which is exactly the workload SQLite is best at.
//
// Everything here is synchronous on purpose: DatabaseSync does no I/O wait
// worth yielding for at this scale, and it keeps the route handlers free of
// transaction-interleaving bugs.

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'quiz.db'));

// WAL lets the (rare) writes proceed without blocking concurrent reads.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  uid                   TEXT PRIMARY KEY,
  username              TEXT NOT NULL,
  email                 TEXT,              -- real address from Authentik, never the old @quiz.local ones
  authentik_sub         TEXT UNIQUE,
  gravatar_email        TEXT NOT NULL DEFAULT '',
  hide_from_leaderboard INTEGER NOT NULL DEFAULT 0,
  is_admin              INTEGER NOT NULL DEFAULT 0,
  legacy_firebase_uid   TEXT UNIQUE,       -- set when an old account was migrated
  created_at            TEXT NOT NULL,
  last_login            TEXT
);

-- Small key/value scratch space (e.g. "public Firestore data already pulled").
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);

-- Firestore kept two separate collections for this (users/{uid}/stats and
-- users/{uid}/quiz_stats/{quizId}/stats) because nesting was the only way to
-- scope them. One table with a quiz_id column does both; '' means the global,
-- cross-quiz tally.
CREATE TABLE IF NOT EXISTS question_stats (
  uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  quiz_id     TEXT NOT NULL DEFAULT '',
  question_id TEXT NOT NULL,
  correct     INTEGER NOT NULL DEFAULT 0,
  wrong       INTEGER NOT NULL DEFAULT 0,
  last_played TEXT,
  PRIMARY KEY (uid, quiz_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Unknown',
  correct     INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  quiz_id     TEXT,
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_uid_ts ON attempts(uid, timestamp);

-- Private and public quizzes were two collections in Firestore; here they
-- differ only by scope. owner_uid stays set for public quizzes too, so an
-- author can still edit/delete what they published.
CREATE TABLE IF NOT EXISTS quizzes (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL CHECK (scope IN ('private', 'public')),
  owner_uid  TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  icon       TEXT,
  modes      TEXT NOT NULL DEFAULT '[]',   -- JSON array
  questions  TEXT NOT NULL,                -- JSON array
  author     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quizzes_scope ON quizzes(scope);
CREATE INDEX IF NOT EXISTS idx_quizzes_owner ON quizzes(owner_uid);

CREATE TABLE IF NOT EXISTS custom_modes (
  id         TEXT PRIMARY KEY,
  uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  icon       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_modes_uid ON custom_modes(uid);

CREATE TABLE IF NOT EXISTS leaderboards (
  quiz_id    TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  is_custom  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  quiz_id           TEXT NOT NULL REFERENCES leaderboards(quiz_id) ON DELETE CASCADE,
  uid               TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  username          TEXT NOT NULL,
  best_score        INTEGER,
  best_total        INTEGER,
  best_percentage   REAL,
  best_time_seconds INTEGER,
  last_played       TEXT NOT NULL,
  PRIMARY KEY (quiz_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_lb_entries_uid ON leaderboard_entries(uid);
`);

// --- Row <-> API shape helpers -------------------------------------------
//
// The client still speaks the Firestore-ish camelCase shape, so the mapping
// lives here rather than being smeared across every route.

export const toUser = (r) => r && ({
  uid: r.uid,
  username: r.username,
  email: r.email || '',
  gravatarEmail: r.gravatar_email || '',
  hideFromLeaderboard: !!r.hide_from_leaderboard,
  isAdmin: !!r.is_admin,
  lastLogin: r.last_login
});

export const toQuiz = (r) => r && ({
  id: r.id,
  title: r.title,
  icon: r.icon,
  modes: JSON.parse(r.modes || '[]'),
  questions: JSON.parse(r.questions),
  author: r.author,
  authorId: r.owner_uid,
  createdAt: r.created_at
});

export const toEntry = (r) => r && ({
  uid: r.uid,
  username: r.username,
  bestScore: r.best_score,
  bestTotal: r.best_total,
  bestPercentage: r.best_percentage,
  bestTimeSeconds: r.best_time_seconds,
  lastPlayed: r.last_played
});
