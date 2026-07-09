// Thin client for the Groq proxy in server/index.js. No key, no system
// prompts, no model name — none of that lives on the client.

import { Lang } from './i18n';

export class AiRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super('AI rate limited');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AiStatus {
  enabled: boolean;
  rateLimited: boolean;
  retryAfterSeconds: number;
}

export interface AiUsage {
  totalTokens: number;
}

export async function checkAiStatus(): Promise<AiStatus> {
  try {
    const res = await fetch('/api/groq/status');
    if (!res.ok) return { enabled: false, rateLimited: false, retryAfterSeconds: 0 };
    return await res.json();
  } catch {
    return { enabled: false, rateLimited: false, retryAfterSeconds: 0 };
  }
}

async function throwIfRateLimited(res: Response) {
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    throw new AiRateLimitError(data.retryAfterSeconds || 60);
  }
}

export async function gradeAnswer(question: string, correctAnswer: any, userAnswer: string, lang: Lang): Promise<{ correct: boolean; reasoning: string; usage: AiUsage }> {
  const res = await fetch('/api/groq/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, correctAnswer, userAnswer, lang })
  });
  await throwIfRateLimited(res);
  if (!res.ok) throw new Error('AI grading failed');
  return res.json();
}

export async function explainAnswer(question: string, options: any, correctAnswer: any, userAnswer: any, wasCorrect: boolean, lang: Lang): Promise<{ explanation: string; usage: AiUsage }> {
  const res = await fetch('/api/groq/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, options, correctAnswer, userAnswer, wasCorrect, lang })
  });
  await throwIfRateLimited(res);
  if (!res.ok) throw new Error('AI explanation failed');
  return res.json();
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function askHelp(question: string, options: any, history: ChatMessage[], lang: Lang): Promise<{ reply: string; usage: AiUsage }> {
  const res = await fetch('/api/groq/help', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, options, history, lang })
  });
  await throwIfRateLimited(res);
  if (!res.ok) throw new Error('AI help chat failed');
  return res.json();
}
