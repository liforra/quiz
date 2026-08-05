// Self-describing user settings, for a central account portal.
//
// The contract is deliberately generic: a portal fetches /schema, renders the
// fields it gets back, and PATCHes values. It never learns what a setting
// *means* — so adding one here makes it appear in the portal with no change
// (and no deploy) on the portal's side. That's what keeps the two projects
// from having to move in lockstep.
//
// Any other service can implement the same three endpoints and be rendered by
// the same portal.

import express from 'express';
import { db, toUser } from './db.js';
import { requireAuth } from './auth.js';

export const settingsRouter = express.Router();
settingsRouter.use(express.json());

const nowIso = () => new Date().toISOString();

// The service's own identity, so a portal can label the section it renders.
const SERVICE = {
  id: 'quiz',
  name: 'FISI Trainer',
  url: process.env.PUBLIC_BASE_URL || 'http://localhost:3849'
};

// Each entry maps one API key to a column plus how to render and validate it.
// `coerce` returns the value to store, or throws for bad input.
const FIELDS = [
  {
    key: 'gravatarEmail',
    column: 'gravatar_email',
    type: 'email',
    label: { de: 'Gravatar-Adresse', en: 'Gravatar address' },
    help: {
      de: 'E-Mail für dein Profilbild. Leer lassen, um deine Initialen zu zeigen.',
      en: 'Email used for your profile picture. Leave empty to show your initials.'
    },
    coerce: (v) => String(v ?? '').trim().slice(0, 320)
  },
  {
    key: 'hideFromLeaderboard',
    column: 'hide_from_leaderboard',
    type: 'boolean',
    label: { de: 'Nicht in Bestenlisten anzeigen', en: 'Hide me from leaderboards' },
    help: {
      de: 'Entfernt auch alle bestehenden Einträge, nicht nur zukünftige.',
      en: 'Also removes every existing entry, not just future ones.'
    },
    coerce: (v) => (v ? 1 : 0)
  },
  {
    key: 'uiLang',
    column: 'ui_lang',
    type: 'select',
    options: [{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }],
    label: { de: 'Sprache', en: 'Language' },
    coerce: (v) => (v === 'en' ? 'en' : 'de')
  },
  {
    key: 'theme',
    column: 'theme',
    type: 'select',
    options: [
      { value: 'light', label: { de: 'Hell', en: 'Light' } },
      { value: 'dark', label: { de: 'Dunkel', en: 'Dark' } }
    ],
    label: { de: 'Erscheinungsbild', en: 'Appearance' },
    coerce: (v) => (v === 'light' ? 'light' : 'dark')
  },
  {
    key: 'focusMode',
    column: 'focus_mode',
    type: 'boolean',
    label: { de: 'Fokus-Modus', en: 'Focus mode' },
    help: {
      de: 'Blendet die Seitenleiste aus und vergrößert die Frage.',
      en: 'Hides the sidebar and enlarges the question.'
    },
    coerce: (v) => (v ? 1 : 0)
  },
  {
    key: 'logActivity',
    column: 'log_activity',
    type: 'boolean',
    label: { de: 'Lernzeiten aufzeichnen', en: 'Record study times' },
    help: {
      // Turning it off stops new rows but keeps the old ones on purpose: the
      // log exists to be shown to someone, and a toggle that silently erased
      // months of evidence would be the worst possible failure mode. Clearing
      // it is a separate, explicit action in the app.
      de: 'Hält fest, wann du ein Quiz startest und beendest — als Nachweis deiner Lernzeiten. Ausschalten stoppt neue Einträge; bestehende bleiben, bis du sie löschst.',
      en: 'Records when you start and finish a quiz, as evidence of your study time. Turning it off stops new entries; existing ones stay until you delete them.'
    },
    coerce: (v) => (v ? 1 : 0)
  }
];

const byKey = new Map(FIELDS.map(f => [f.key, f]));

const readValues = (row) => Object.fromEntries(FIELDS.map(f => {
  const raw = row[f.column];
  return [f.key, f.type === 'boolean' ? !!raw : raw ?? ''];
}));

// --- Schema + values -----------------------------------------------------

settingsRouter.get('/api/settings/schema', requireAuth, (req, res) => {
  res.json({
    service: SERVICE,
    fields: FIELDS.map(({ key, type, label, help, options }) => ({ key, type, label, help, options })),
    actions: [
      {
        key: 'export',
        method: 'GET',
        path: '/api/settings/export',
        label: { de: 'Meine Daten exportieren', en: 'Export my data' }
      },
      {
        key: 'deactivate',
        method: 'POST',
        path: '/api/settings/deactivate',
        destructive: true,
        confirm: 'username',
        label: { de: 'Konto deaktivieren', en: 'Deactivate account' },
        help: {
          de: 'Sperrt die Anmeldung und verbirgt dich aus Bestenlisten. Deine Daten bleiben erhalten; ein Administrator kann das rückgängig machen.',
          en: 'Blocks sign-in and hides you from leaderboards. Your data is kept; an administrator can undo this.'
        }
      },
      {
        key: 'delete',
        method: 'DELETE',
        path: '/api/settings/account',
        destructive: true,
        confirm: 'username',
        label: { de: 'Konto und Daten löschen', en: 'Delete account and data' },
        help: {
          de: 'Endgültig. Löscht Statistiken, Versuche, private Quizzes und Bestenlisten-Einträge. Von dir veröffentlichte Quizzes bleiben bestehen, aber ohne deinen Namen.',
          en: 'Permanent. Deletes stats, attempts, private quizzes and leaderboard entries. Quizzes you published stay, but without your name.'
        }
      }
    ],
    values: readValues(req.user)
  });
});

settingsRouter.get('/api/settings', requireAuth, (req, res) => {
  res.json({ values: readValues(req.user) });
});

settingsRouter.patch('/api/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  const updates = [];
  const params = [];
  const unknown = [];

  for (const [key, value] of Object.entries(body)) {
    const field = byKey.get(key);
    if (!field) { unknown.push(key); continue; }
    updates.push(`${field.column} = ?`);
    params.push(field.coerce(value));
  }
  if (unknown.length) return res.status(400).json({ error: 'unknown_settings', keys: unknown });
  if (!updates.length) return res.status(400).json({ error: 'no_settings_given' });

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE uid = ?`).run(...params, req.user.uid);

  // Opting out of leaderboards has to erase what's already there — otherwise
  // "hide me" would only apply going forward, leaving old scores on display.
  if (body.hideFromLeaderboard) {
    db.prepare('DELETE FROM leaderboard_entries WHERE uid = ?').run(req.user.uid);
  }

  const row = db.prepare('SELECT * FROM users WHERE uid = ?').get(req.user.uid);
  res.json({ values: readValues(row) });
});

// --- Data export (GDPR Art. 15/20) ---------------------------------------

settingsRouter.get('/api/settings/export', requireAuth, (req, res) => {
  const uid = req.user.uid;
  const all = (sql) => db.prepare(sql).all(uid);
  res.setHeader('Content-Disposition', `attachment; filename="quiz-daten-${req.user.username}.json"`);
  res.json({
    exportedAt: nowIso(),
    service: SERVICE,
    account: toUser(req.user),
    settings: readValues(req.user),
    questionStats: all('SELECT quiz_id, question_id, correct, wrong, last_played FROM question_stats WHERE uid = ?'),
    attempts: all('SELECT question_id, category, correct, skipped, quiz_id, timestamp FROM attempts WHERE uid = ?'),
    activityLog: all('SELECT kind, title, quiz_id, question_count, score, total, duration_seconds, started_at, timestamp FROM activity_log WHERE uid = ?'),
    quizzes: all('SELECT id, scope, title, icon, modes, questions, created_at FROM quizzes WHERE owner_uid = ?'),
    customModes: all('SELECT id, label, icon, created_at FROM custom_modes WHERE uid = ?'),
    leaderboardEntries: all('SELECT quiz_id, best_score, best_total, best_percentage, best_time_seconds, last_played FROM leaderboard_entries WHERE uid = ?'),
    aiUsage: all('SELECT total_requests, total_tokens, first_used, last_used FROM ai_usage WHERE uid = ?')
  });
});

// --- Deactivate ----------------------------------------------------------

// Reversible: the row and all its data stay, sign-in is refused (see
// resolveUser in auth.js) and existing sessions are dropped. Undoing it needs
// an administrator, precisely because the user can no longer log in.
settingsRouter.post('/api/settings/deactivate', requireAuth, (req, res) => {
  if (req.body?.confirm !== req.user.username) {
    return res.status(400).json({ error: 'confirmation_mismatch', expected: 'username' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET deactivated_at = ? WHERE uid = ?').run(nowIso(), req.user.uid);
    db.prepare('DELETE FROM leaderboard_entries WHERE uid = ?').run(req.user.uid);
    db.prepare('DELETE FROM sessions WHERE uid = ?').run(req.user.uid);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Deactivation failed', e);
    return res.status(500).json({ error: 'deactivation_failed' });
  }
  console.log(`Account deactivated: ${req.user.username} (${req.user.uid})`);
  res.json({ ok: true, deactivated: true });
});

// --- Delete (GDPR Art. 17) ------------------------------------------------

settingsRouter.delete('/api/settings/account', requireAuth, (req, res) => {
  if (req.body?.confirm !== req.user.username) {
    return res.status(400).json({ error: 'confirmation_mismatch', expected: 'username' });
  }
  const uid = req.user.uid;
  const summary = {};

  db.exec('BEGIN');
  try {
    // Quizzes published to everyone are content other people rely on, and the
    // questions themselves aren't personal data — so they are anonymised
    // rather than deleted, which severs the link to the person while leaving
    // the library intact. Private quizzes are deleted outright.
    db.prepare("INSERT OR IGNORE INTO users (uid, username, created_at) VALUES ('deleted', 'Gelöschter Nutzer', ?)").run(nowIso());
    summary.publicQuizzesAnonymised = db.prepare(
      "UPDATE quizzes SET owner_uid = 'deleted', author = 'Gelöschter Nutzer' WHERE owner_uid = ? AND scope = 'public'"
    ).run(uid).changes;

    for (const [name, sql] of [
      ['privateQuizzes', "DELETE FROM quizzes WHERE owner_uid = ? AND scope = 'private'"],
      ['questionStats', 'DELETE FROM question_stats WHERE uid = ?'],
      ['attempts', 'DELETE FROM attempts WHERE uid = ?'],
      ['activityLog', 'DELETE FROM activity_log WHERE uid = ?'],
      ['customModes', 'DELETE FROM custom_modes WHERE uid = ?'],
      ['leaderboardEntries', 'DELETE FROM leaderboard_entries WHERE uid = ?'],
      ['aiUsage', 'DELETE FROM ai_usage WHERE uid = ?'],
      ['sessions', 'DELETE FROM sessions WHERE uid = ?']
    ]) {
      summary[name] = db.prepare(sql).run(uid).changes;
    }

    // Last, so the cascade has nothing left to take with it.
    db.prepare('DELETE FROM users WHERE uid = ?').run(uid);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Account deletion failed', e);
    return res.status(500).json({ error: 'deletion_failed' });
  }

  console.log(`Account deleted: ${req.user.username} (${uid})`, summary);
  res.clearCookie('quiz_session', { path: '/' });
  res.json({ ok: true, deleted: true, summary });
});
