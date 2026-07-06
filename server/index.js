// Small backend whose only job is to keep the Groq API key server-side.
// The client never sees the key or the system prompts — it only ever POSTs
// question/answer context and gets back a result.

// GROQ_API_KEY is a real secret, unlike the Firebase client config in the
// (git-tracked) .env — it belongs in .env.local, which .gitignore already
// excludes via the `*.local` pattern.
try {
  process.loadEnvFile?.(new URL('../.env.local', import.meta.url));
} catch {
  // .env.local is optional — AI features just stay disabled without it.
}

import express from 'express';
import cors from 'cors';
import { buildGradingMessages, buildExplainMessages, buildHelpMessages } from './prompts.js';

const PORT = process.env.PORT || 8787;
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3849,https://quiz.liforra.de').split(',');

const app = express();
app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGINS }));

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
  return data.choices?.[0]?.message?.content ?? '';
}

function handleAiError(res, e, fallbackMessage) {
  if (e.rateLimited) {
    return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: e.retryAfterSeconds });
  }
  console.error(fallbackMessage, e);
  res.status(502).json({ error: fallbackMessage });
}

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
    const content = await callGroq(buildGradingMessages({ question, correctAnswer, userAnswer, lang }));
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? content);
    res.json({ correct: !!parsed.correct, reasoning: parsed.reasoning || '' });
  } catch (e) {
    handleAiError(res, e, 'AI grading failed');
  }
});

app.post('/api/groq/explain', rateLimit, groqQuotaGuard, async (req, res) => {
  if (!GROQ_API_KEY) return res.status(503).json({ error: 'AI explanations not configured' });
  try {
    const { question, options, correctAnswer, userAnswer, wasCorrect, lang } = req.body || {};
    if (!question || correctAnswer == null) {
      return res.status(400).json({ error: 'Missing question/correctAnswer' });
    }
    const explanation = await callGroq(buildExplainMessages({ question, options, correctAnswer, userAnswer, wasCorrect, lang }));
    res.json({ explanation });
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
    const reply = await callGroq(buildHelpMessages({ question, options, history: safeHistory, lang }));
    res.json({ reply });
  } catch (e) {
    handleAiError(res, e, 'AI help chat failed');
  }
});

app.listen(PORT, () => {
  console.log(`Groq proxy listening on :${PORT} (AI ${GROQ_API_KEY ? 'enabled' : 'disabled — set GROQ_API_KEY in .env'})`);
});
