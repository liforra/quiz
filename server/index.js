// Small backend whose only job is to keep the Groq API key server-side.
// The client never sees the key or the system prompts — it only ever POSTs
// question/answer context and gets back a result.

// Must stay the first import: it populates process.env for every module
// below, several of which read it at import time. See server/env.js.
import './env.js';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { watch, promises as fs } from 'fs';
import { exec } from 'child_process';
import { buildGradingMessages, buildExplainMessages, buildHelpMessages, buildExamGradingMessages } from './prompts.js';
import { authRouter, sessionMiddleware, authentikConfigured, legacyMigrationEnabled } from './auth.js';
import { dataRouter } from './data.js';
import { settingsRouter } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const PRUEFUNGEN_ROOT = path.join(PROJECT_ROOT, 'Prüfungen');
const EXAM_SOURCES_DIR = path.join(PROJECT_ROOT, 'public', 'exam-sources');

const PORT = process.env.PORT || 8787;
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3849,https://quiz.liforra.de').split(',');

const app = express();
app.use(express.json());
// credentials:true is only meaningful for the app's own origin; other origins
// (the account portal) authenticate with a bearer token, which needs the
// Authorization header allowed through preflight.
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true, allowedHeaders: ['Content-Type', 'Authorization'] }));

// Very lightweight per-IP rate limit — not meant to stop a determined
// attacker, just to keep casual abuse from burning through the Groq quota.
const RATE_LIMIT = 20; // requests
const RATE_WINDOW_MS = 5 * 60 * 1000; // per 5 minutes
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }
  if (entry.count >= RATE_LIMIT) {
    return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) });
  }
  entry.count++;
  next();
}

// Groq's own quota/rate limit is shared across every user (one API key for
// the whole app) — tracked here so every client finds out immediately via
// /api/groq/status instead of each hammering Groq and getting 429s one by one.
let groqCooldownUntil = 0;

function groqQuotaGuard(req, res, next) {
  if (Date.now() < groqCooldownUntil) {
    return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: Math.ceil((groqCooldownUntil - Date.now()) / 1000) });
  }
  next();
}

async function callGroq(messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.3 })
  });
  if (res.status === 429) {
    const retryAfterHeader = Number(res.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : 60_000;
    groqCooldownUntil = Date.now() + retryAfterMs;
    const err = new Error('Groq quota/rate limit hit');
    err.rateLimited = true;
    err.retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Groq API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: { totalTokens: data.usage?.total_tokens ?? 0 }
  };
}

function handleAiError(res, e, fallbackMessage) {
  if (e.rateLimited) {
    return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: e.retryAfterSeconds });
  }
  console.error(fallbackMessage, e);
  res.status(502).json({ error: fallbackMessage });
}

// Session cookie → req.user, for every route below (including the data API).
app.use(sessionMiddleware);

// Authentik (auth.liforra.de) SSO — the only login. Mounted before the
// static/SPA fallback so its redirects aren't swallowed by index.html.
app.use(authRouter);

// The data API — replaces the client's direct Firestore access.
app.use(dataRouter);

// Self-describing settings, readable by a central account portal.
app.use(settingsRouter);

app.get('/api/groq/status', (req, res) => {
  const rateLimited = Date.now() < groqCooldownUntil;
  res.json({
    enabled: !!GROQ_API_KEY,
    rateLimited,
    retryAfterSeconds: rateLimited ? Math.ceil((groqCooldownUntil - Date.now()) / 1000) : 0
  });
});

app.post('/api/groq/grade', rateLimit, groqQuotaGuard, async (req, res) => {
  if (!GROQ_API_KEY) return res.status(503).json({ error: 'AI grading not configured' });
  try {
    const { question, correctAnswer, userAnswer, lang } = req.body || {};
    if (!question || correctAnswer == null || userAnswer == null) {
      return res.status(400).json({ error: 'Missing question/correctAnswer/userAnswer' });
    }
    const { content, usage } = await callGroq(buildGradingMessages({ question, correctAnswer, userAnswer, lang }));
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? content);
    res.json({ correct: !!parsed.correct, reasoning: parsed.reasoning || '', usage });
  } catch (e) {
    handleAiError(res, e, 'AI grading failed');
  }
});

app.post('/api/groq/grade-exam-task', rateLimit, groqQuotaGuard, async (req, res) => {
  if (!GROQ_API_KEY) return res.status(503).json({ error: 'AI grading not configured' });
  try {
    const { parts, lang } = req.body || {};
    if (!Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ error: 'Missing parts' });
    }
    for (const p of parts) {
      if (!p.id || !p.prompt || p.modelAnswer == null || typeof p.maxPoints !== 'number') {
        return res.status(400).json({ error: 'Each part needs id/prompt/modelAnswer/maxPoints' });
      }
    }
    const { content } = await callGroq(buildExamGradingMessages({ parts, lang }));
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? content);
    const byId = new Map(parts.map(p => [p.id, p.maxPoints]));
    const results = (Array.isArray(parsed.results) ? parsed.results : [])
      .filter(r => byId.has(r.id))
      .map(r => ({ id: r.id, score: Math.max(0, Math.min(byId.get(r.id), Number(r.score) || 0)), maxScore: byId.get(r.id), reasoning: r.reasoning || '' }));
    res.json({ results });
  } catch (e) {
    handleAiError(res, e, 'AI exam grading failed');
  }
});

app.post('/api/groq/explain', rateLimit, groqQuotaGuard, async (req, res) => {
  if (!GROQ_API_KEY) return res.status(503).json({ error: 'AI explanations not configured' });
  try {
    const { question, options, correctAnswer, userAnswer, wasCorrect, lang } = req.body || {};
    if (!question || correctAnswer == null) {
      return res.status(400).json({ error: 'Missing question/correctAnswer' });
    }
    const { content: explanation, usage } = await callGroq(buildExplainMessages({ question, options, correctAnswer, userAnswer, wasCorrect, lang }));
    res.json({ explanation, usage });
  } catch (e) {
    handleAiError(res, e, 'AI explanation failed');
  }
});

app.post('/api/groq/help', rateLimit, groqQuotaGuard, async (req, res) => {
  if (!GROQ_API_KEY) return res.status(503).json({ error: 'AI help chat not configured' });
  try {
    const { question, options, history, lang } = req.body || {};
    if (!question || !Array.isArray(history)) {
      return res.status(400).json({ error: 'Missing question/history' });
    }
    // Only forward role+content — never trust/forward a client-supplied "system" message.
    const safeHistory = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10);
    const { content: reply, usage } = await callGroq(buildHelpMessages({ question, options, history: safeHistory, lang }));
    res.json({ reply, usage });
  } catch (e) {
    handleAiError(res, e, 'AI help chat failed');
  }
});

// --- Admin: pick which real exam PDF (from the private, gitignored
// Prüfungen/ archive) backs a given digitized exam, so the export pipeline
// can overlay answers onto the actual paper instead of a generated summary.
// Personal-use-only tooling (no auth) — this app has no other users.

function resolveWithinPruefungen(relativePath) {
  const target = path.resolve(PRUEFUNGEN_ROOT, relativePath || '.');
  if (target !== PRUEFUNGEN_ROOT && !target.startsWith(PRUEFUNGEN_ROOT + path.sep)) {
    throw new Error('Path escapes Prüfungen/');
  }
  return target;
}

app.get('/api/admin/browse', async (req, res) => {
  try {
    const dir = resolveWithinPruefungen(req.query.dir || '.');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, isDirectory: e.isDirectory(), isPdf: e.isFile() && e.name.toLowerCase().endsWith('.pdf') }))
      .filter(e => e.isDirectory || e.isPdf)
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    res.json({ dir: path.relative(PRUEFUNGEN_ROOT, dir), items });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/admin/exam-sources', async (req, res) => {
  try {
    await fs.mkdir(EXAM_SOURCES_DIR, { recursive: true });
    const entries = await fs.readdir(EXAM_SOURCES_DIR, { withFileTypes: true });
    const sources = {};
    for (const e of entries) {
      if (!e.name.endsWith('.pdf')) continue;
      const examId = e.name.slice(0, -4);
      try {
        const linkTarget = await fs.readlink(path.join(EXAM_SOURCES_DIR, e.name));
        sources[examId] = path.relative(PRUEFUNGEN_ROOT, linkTarget);
      } catch {
        sources[examId] = null; // not a symlink (unexpected) — still report it exists
      }
    }
    res.json({ sources });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/exam-source', express.json(), async (req, res) => {
  try {
    const { examId, relativePath } = req.body || {};
    if (!examId || !relativePath) return res.status(400).json({ error: 'Missing examId/relativePath' });
    const target = resolveWithinPruefungen(relativePath);
    if (!target.toLowerCase().endsWith('.pdf')) return res.status(400).json({ error: 'Not a PDF' });
    await fs.mkdir(EXAM_SOURCES_DIR, { recursive: true });
    const linkPath = path.join(EXAM_SOURCES_DIR, `${examId}.pdf`);
    await fs.rm(linkPath, { force: true });
    await fs.symlink(target, linkPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/exam-source/:examId', async (req, res) => {
  try {
    await fs.rm(path.join(EXAM_SOURCES_DIR, `${req.params.examId}.pdf`), { force: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Symlinked source PDFs — served directly (fs follows symlinks by default),
// independent of Vite's public/ copy behavior at build time.
app.use('/exam-sources', express.static(EXAM_SOURCES_DIR));

// Serves the production build (`npm run production` runs `vite build` first)
// so a single process handles both the API and the frontend — in dev, `dist/`
// doesn't exist and the frontend is served by Vite's own dev server instead,
// so express.static below just finds nothing and next() falls through.
app.use(express.static(DIST_DIR));
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
    if (err) next(); // no build present (dev mode) — let it 404 normally
  });
});

// AUTO_REBUILD (set by the "production" npm script) watches the frontend
// source for changes and rebuilds in place — no restart, no external deploy
// hook. Once dist/ (and its version.json) is regenerated, already-open tabs
// pick up the new build id on their next poll and show the update card
// (see the UPDATE-AVAILABLE CHECK effect in src/app.tsx) instead of anything
// reloading out from under the user. Only rebuilds the static bundle —
// server/*.js changes still need a real process restart, which is out of
// scope for a process trying to watch its own source.
if (process.env.AUTO_REBUILD === '1') {
  let rebuildTimer = null;
  let rebuilding = false;
  const triggerRebuild = (eventType, filename) => {
    // write-version.js (run by every rebuild, below) writes public/version.json —
    // without this check that write re-triggers the public/ watcher, which
    // rebuilds again, which writes version.json again... forever.
    if (filename === 'version.json') return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      if (rebuilding) { triggerRebuild(); return; } // change landed mid-build — rebuild again after
      rebuilding = true;
      console.log('Source changed — rebuilding...');
      exec('node scripts/write-version.js && npx vite build', { cwd: PROJECT_ROOT }, (err, stdout, stderr) => {
        rebuilding = false;
        if (err) { console.error('Rebuild failed:', stderr || err.message); return; }
        console.log('Rebuild complete.');
      });
    }, 1000); // debounce — editors/saves fire multiple fs events per change
  };
  for (const dir of ['src', 'public']) {
    watch(path.join(PROJECT_ROOT, dir), { recursive: true }, triggerRebuild);
  }
  console.log('AUTO_REBUILD enabled — watching src/ and public/ for changes');
}

app.listen(PORT, () => {
  console.log(`Groq proxy listening on :${PORT} (AI ${GROQ_API_KEY ? 'enabled' : 'disabled — set GROQ_API_KEY in .env'})`);
  console.log(`Authentik SSO ${authentikConfigured ? 'enabled' : 'disabled — set AUTHENTIK_* in .env.local'}`);
  console.log(`Legacy migration ${legacyMigrationEnabled ? 'enabled' : 'off'}`);
});
