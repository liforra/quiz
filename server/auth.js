// Authentication: Authentik (auth.liforra.de) OIDC → own session cookie.
//
// No Firebase anywhere in the steady state. The browser gets an opaque,
// HttpOnly session id; every API route resolves it to a uid via the sessions
// table. That replaces what Firebase Auth + firestore.rules used to do.
//
// The one exception is the *migration* path: to prove ownership of a legacy
// account we still have to check its old password, and only Firebase can do
// that. It's called over Firebase's REST API with the public web API key —
// no SDK, no service account, nothing in the client. The ID token it returns
// is then used to pull that user's Firestore data across (server/migrate.js).
// Delete the /api/auth/legacy/* routes, migrate.js and LEGACY_MIGRATION once
// everyone has moved.

import express from 'express';
import crypto from 'crypto';
import { db } from './db.js';
import { importLegacyUser, importPublicData } from './migrate.js';

const ISSUER = (process.env.AUTHENTIK_ISSUER || '').replace(/\/$/, '');
const CLIENT_ID = process.env.AUTHENTIK_CLIENT_ID || '';
const CLIENT_SECRET = process.env.AUTHENTIK_CLIENT_SECRET || '';
const SCOPES = process.env.AUTHENTIK_SCOPES || 'openid profile email';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://localhost:3849').replace(/\/$/, '');
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'liforra')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const LEGACY_MIGRATION = process.env.LEGACY_MIGRATION !== '0';
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || '';

export const authentikConfigured = !!(ISSUER && CLIENT_ID && CLIENT_SECRET);
export const legacyMigrationEnabled = LEGACY_MIGRATION && !!FIREBASE_API_KEY;

const REDIRECT_URI = `${PUBLIC_BASE_URL}/api/auth/authentik/callback`;
const SESSION_COOKIE = 'quiz_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SECURE_COOKIES = PUBLIC_BASE_URL.startsWith('https://');

// --- OIDC discovery ---

let discoveryCache = null;
async function discover() {
  if (discoveryCache) return discoveryCache;
  const res = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) for ${ISSUER}`);
  discoveryCache = await res.json();
  return discoveryCache;
}

// --- Sessions ---

const b64url = (buf) => buf.toString('base64url');
const nowIso = () => new Date().toISOString();

function createSession(uid) {
  const id = b64url(crypto.randomBytes(32));
  db.prepare('INSERT INTO sessions (id, uid, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, uid, nowIso(), Date.now() + SESSION_TTL_MS);
  return id;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setSessionCookie(res, id) {
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,          // JS can't read it — an XSS can't exfiltrate the session
    sameSite: 'lax',         // survives the OIDC redirect back from Authentik
    secure: SECURE_COOKIES,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
}

// Access tokens are verified by asking Authentik's userinfo endpoint, the
// same way the login callback does — no JWT library, and revocation takes
// effect immediately. Verified subjects are cached briefly so a portal
// rendering several settings screens doesn't cause a round trip per request.
const tokenCache = new Map();
const TOKEN_CACHE_MS = 60_000;

async function subjectForToken(token) {
  const hit = tokenCache.get(token);
  if (hit && Date.now() < hit.expiresAt) return hit.sub;
  try {
    const { userinfo_endpoint } = await discover();
    const res = await fetch(userinfo_endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const { sub } = await res.json();
    if (!sub) return null;
    tokenCache.set(token, { sub, expiresAt: Date.now() + TOKEN_CACHE_MS });
    return sub;
  } catch (e) {
    console.error('Token validation failed', e.message);
    return null;
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokenCache) if (now > v.expiresAt) tokenCache.delete(k);
}, 5 * 60_000).unref?.();

// Resolves the caller to a user row. Two ways in: the session cookie for this
// app's own frontend, and an Authentik access token for other origins (the
// account portal). Cookies are same-origin only — SameSite=Lax is what stops
// a foreign page from making authenticated requests, so cross-origin callers
// deliberately use a bearer token instead of relaxing that.
export async function sessionMiddleware(req, res, next) {
  req.user = null;

  const id = readCookie(req, SESSION_COOKIE);
  if (id) {
    const row = db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.uid = s.uid
      WHERE s.id = ? AND s.expires_at > ? AND u.deactivated_at IS NULL
    `).get(id, Date.now());
    if (row) {
      req.user = row;
      req.sessionId = id;
      return next();
    }
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ') && authentikConfigured) {
    const sub = await subjectForToken(auth.slice(7).trim());
    if (sub) {
      req.user = db.prepare('SELECT * FROM users WHERE authentik_sub = ? AND deactivated_at IS NULL').get(sub) || null;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'forbidden' });
  next();
}

// Expired sessions are only cleaned up lazily above; sweep the rest hourly.
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}, 60 * 60 * 1000).unref?.();

// --- Pending OIDC requests (PKCE verifier + what the flow is for) ---

const pending = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (now > v.expiresAt) pending.delete(k);
}, 60_000).unref?.();

// --- Identity resolution ---

// Maps a verified Authentik profile onto a row in `users`, creating it or
// adopting a migrated legacy account. Returns the uid.
//
// `legacyUid` comes from the migration flow and is the *Firestore* uid of an
// already-imported account. Adopting it (rather than creating a fresh row)
// is what preserves all imported stats/attempts/quizzes: every other table
// references users(uid), so leaving that value alone keeps the data attached.
function resolveUser(profile, legacyUid) {
  const username = profile.preferred_username || profile.nickname || profile.name || profile.email || profile.sub;
  const email = profile.email || null;
  const isAdmin = ADMIN_USERNAMES.includes(String(username).toLowerCase()) ? 1 : 0;

  const existing = db.prepare('SELECT * FROM users WHERE authentik_sub = ?').get(profile.sub);
  if (existing) {
    if (existing.deactivated_at) throw Object.assign(new Error('account_deactivated'), { code: 'account_deactivated' });
    if (legacyUid && legacyUid !== existing.uid) throw Object.assign(new Error('already_linked'), { code: 'already_linked' });
    db.prepare('UPDATE users SET username = ?, email = ?, is_admin = ?, last_login = ? WHERE uid = ?')
      .run(username, email, isAdmin, nowIso(), existing.uid);
    return existing.uid;
  }

  if (legacyUid) {
    const legacy = db.prepare('SELECT * FROM users WHERE uid = ?').get(legacyUid);
    if (!legacy) throw Object.assign(new Error('legacy_account_not_imported'), { code: 'legacy_account_not_imported' });
    if (legacy.authentik_sub) throw Object.assign(new Error('account_has_other_identity'), { code: 'account_has_other_identity' });
    // Note: the old fake <name>@quiz.local address is overwritten here, never
    // carried forward — the Authentik address is the only real one.
    db.prepare(`
      UPDATE users SET authentik_sub = ?, username = ?, email = ?, is_admin = ?,
                       legacy_firebase_uid = uid, last_login = ?
      WHERE uid = ?
    `).run(profile.sub, username, email, isAdmin, nowIso(), legacyUid);
    return legacyUid;
  }

  const uid = 'u_' + b64url(crypto.randomBytes(12));
  db.prepare(`
    INSERT INTO users (uid, username, email, authentik_sub, is_admin, created_at, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uid, username, email, profile.sub, isAdmin, nowIso(), nowIso());
  return uid;
}

// --- Routes ---

export const authRouter = express.Router();

authRouter.get('/api/auth/status', (req, res) => {
  res.json({
    authentik: authentikConfigured,
    legacyMigration: legacyMigrationEnabled,
    issuer: authentikConfigured ? ISSUER : null
  });
});

// Who am I? The client calls this on load instead of onAuthStateChanged.
authRouter.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  res.json({
    uid: req.user.uid,
    username: req.user.username,
    email: req.user.email || '',
    gravatarEmail: req.user.gravatar_email || '',
    hideFromLeaderboard: !!req.user.hide_from_leaderboard,
    isAdmin: !!req.user.is_admin
  });
});

// Ends the local session and reports where to go next. With SSO, dropping our
// own cookie isn't enough: the Authentik session survives, so the next login
// would sail straight through without a prompt. Handing back the provider's
// end_session_endpoint lets the client finish the job (RP-initiated logout).
authRouter.post('/api/auth/logout', async (req, res) => {
  if (req.sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  res.clearCookie(SESSION_COOKIE, { path: '/' });

  let ssoLogoutUrl = null;
  if (authentikConfigured) {
    try {
      const { end_session_endpoint } = await discover();
      if (end_session_endpoint) {
        // Deliberately no post_logout_redirect_uri: Authentik only honours one
        // that is registered as a Logout-type redirect URI, and this instance
        // can't register those. Sending an unregistered one risks an error
        // page; without it the user reliably lands on Authentik's own
        // "signed out" page. The local session is already gone either way.
        ssoLogoutUrl = end_session_endpoint;
      }
    } catch (e) {
      // Local logout already happened; losing the SSO leg is not fatal.
      console.error('Could not build SSO logout URL', e.message);
    }
  }
  res.json({ ok: true, ssoLogoutUrl });
});

// Step 1 of the migration: prove ownership of a legacy account.
// Verified against Firebase's REST endpoint with the *public* web API key —
// the same check the old client-side signInWithEmailAndPassword did, just
// without shipping an SDK. Returns a ticket, not a session: the account only
// becomes usable once an Authentik identity is attached to it.
authRouter.post('/api/auth/legacy/verify', express.json(), async (req, res) => {
  if (!legacyMigrationEnabled) return res.status(503).json({ error: 'legacy_migration_disabled' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });

  const virtualEmail = `${String(username).toLowerCase().replace(/\s+/g, '')}@quiz.local`;
  try {
    // returnSecureToken gives us an ID token *for this user* — the key to the
    // whole migration: it lets the server read their Firestore data under the
    // existing security rules, so no service account is needed anywhere.
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: virtualEmail, password, returnSecureToken: true })
      }
    );
    if (!r.ok) return res.status(401).json({ error: 'invalid_credentials' });
    const { localId, idToken } = await r.json();
    if (!localId || !idToken) return res.status(401).json({ error: 'invalid_credentials' });

    const existing = db.prepare('SELECT authentik_sub FROM users WHERE uid = ?').get(localId);
    if (existing?.authentik_sub) return res.status(409).json({ error: 'account_has_other_identity' });

    // Pull their data across now, while we hold a valid token. The account
    // stays unlinked until Authentik confirms who they are — an abandoned
    // flow just leaves imported-but-unclaimed data, and a retry is harmless
    // because every import is idempotent.
    const imported = await importLegacyUser(idToken, localId);
    let publicImport = null;
    try {
      publicImport = await importPublicData(idToken);
    } catch (e) {
      console.error('Public data import failed (continuing)', e.message);
    }
    const username = db.prepare('SELECT username FROM users WHERE uid = ?').get(localId)?.username;
    console.log(`Migrated legacy account ${username} (${localId}):`, imported, publicImport || '');

    const ticket = b64url(crypto.randomBytes(24));
    pending.set(`ticket:${ticket}`, { legacyUid: localId, expiresAt: Date.now() + PENDING_TTL_MS });
    res.json({ ticket, username, imported });
  } catch (e) {
    console.error('Legacy verification failed', e);
    res.status(502).json({ error: 'legacy_verification_failed' });
  }
});

// Same as above, but for users who were *already signed in* when the app
// switched over. Their browser still holds a Firebase session in IndexedDB;
// the refresh token in it proves ownership just as well as a password, so
// they never have to type one. Redeeming it also yields the ID token the
// import needs.
authRouter.post('/api/auth/legacy/session', express.json(), async (req, res) => {
  if (!legacyMigrationEnabled) return res.status(503).json({ error: 'legacy_migration_disabled' });
  const refreshToken = String(req.body?.refreshToken || '');
  if (!refreshToken) return res.status(400).json({ error: 'missing_refresh_token' });

  try {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
    });
    // A revoked or expired token is not an error the user can act on — they
    // just fall back to the username/password form.
    if (!r.ok) return res.status(401).json({ error: 'legacy_session_invalid' });
    const { id_token: idToken, user_id: localId } = await r.json();
    if (!idToken || !localId) return res.status(401).json({ error: 'legacy_session_invalid' });

    const existing = db.prepare('SELECT authentik_sub FROM users WHERE uid = ?').get(localId);
    if (existing?.authentik_sub) return res.status(409).json({ error: 'account_has_other_identity' });

    const imported = await importLegacyUser(idToken, localId);
    try {
      await importPublicData(idToken);
    } catch (e) {
      console.error('Public data import failed (continuing)', e.message);
    }
    const username = db.prepare('SELECT username FROM users WHERE uid = ?').get(localId)?.username;
    console.log(`Migrated legacy session ${username} (${localId}):`, imported);

    const ticket = b64url(crypto.randomBytes(24));
    pending.set(`ticket:${ticket}`, { legacyUid: localId, expiresAt: Date.now() + PENDING_TTL_MS });
    res.json({ ticket, username, imported });
  } catch (e) {
    console.error('Legacy session migration failed', e);
    res.status(502).json({ error: 'legacy_verification_failed' });
  }
});

// Step 2 — hand off to Authentik. `ticket` (from the step above) marks this
// as a migration rather than a fresh sign-up.
authRouter.get('/api/auth/authentik/start', async (req, res) => {
  if (!authentikConfigured) return res.status(503).json({ error: 'authentik_not_configured' });
  try {
    let legacyUid = null;
    if (req.query.ticket) {
      const entry = pending.get(`ticket:${req.query.ticket}`);
      pending.delete(`ticket:${req.query.ticket}`);
      if (!entry || Date.now() > entry.expiresAt) return res.redirect('/?auth_error=invalid_state');
      legacyUid = entry.legacyUid;
    }

    const { authorization_endpoint } = await discover();
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    pending.set(state, { verifier, legacyUid, expiresAt: Date.now() + PENDING_TTL_MS });

    const url = new URL(authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    res.redirect(url.toString());
  } catch (e) {
    console.error('Authentik start failed', e);
    res.redirect('/?auth_error=start_failed');
  }
});

// Step 3 — Authentik redirects back. On success the session cookie is set
// here directly, so nothing sensitive ever travels in a URL.
authRouter.get('/api/auth/authentik/callback', async (req, res) => {
  const fail = (code) => res.redirect(`/?auth_error=${encodeURIComponent(code)}`);
  if (!authentikConfigured) return fail('authentik_not_configured');
  try {
    if (req.query.error) return fail(String(req.query.error));
    const state = String(req.query.state || '');
    const entry = pending.get(state);
    pending.delete(state);
    if (!entry || Date.now() > entry.expiresAt) return fail('invalid_state');

    const { token_endpoint, userinfo_endpoint } = await discover();
    const tokenRes = await fetch(token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code || ''),
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: entry.verifier
      })
    });
    if (!tokenRes.ok) {
      console.error('Authentik token exchange failed', tokenRes.status, await tokenRes.text().catch(() => ''));
      return fail('token_exchange_failed');
    }
    const tokens = await tokenRes.json();

    // Claims come from userinfo over a direct TLS call with the freshly issued
    // access token, so they need no separate signature check — nothing
    // untrusted has touched them.
    const infoRes = await fetch(userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!infoRes.ok) return fail('userinfo_failed');
    const profile = await infoRes.json();
    if (!profile.sub) return fail('userinfo_missing_sub');

    const uid = resolveUser(profile, entry.legacyUid);
    setSessionCookie(res, createSession(uid));
    res.redirect('/');
  } catch (e) {
    console.error('Authentik callback failed', e);
    const known = ['already_linked', 'account_has_other_identity', 'legacy_account_not_imported', 'account_deactivated'];
    fail(known.includes(e.code) ? e.code : 'callback_failed');
  }
});
