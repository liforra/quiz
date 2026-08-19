// Client for the 1v1 duel API (server/duels.js).
//
// Note what is *missing* from DuelQuestion: there is no `answer`. In a duel
// the server grades, so the browser is never told the solution before it has
// committed to a pick — and `picked` carries option indices rather than text,
// so a translated or locally reshuffled question still grades correctly.

export interface DuelPlayer {
  uid: string;
  username: string;
  // SHA-256 of the player's Gravatar address, or null when they never set one
  // (the arena falls back to initials). Hashed server-side — see server/duels.js.
  avatarHash: string | null;
  hp: number;
  maxHp: number;
  questionIndex: number;
  correct: number;
  wrong: number;
  streak: number;
  damageDealt: number;
  connected: boolean;
}

export interface DuelQuestion {
  index: number;
  id: string;
  type: 'single' | 'multiple';
  category: string;
  question: string;
  options: string[];
  translations?: Record<string, { question?: string; options?: string[] }>;
}

export type DuelStatus = 'waiting' | 'active' | 'finished' | 'cancelled';
export type DuelEndReason = 'ko' | 'exhausted' | 'forfeit' | 'disconnect' | 'timeout' | null;

export interface DuelEvent {
  id: number;
  uid: string | null;
  kind: 'join' | 'hit' | 'miss' | 'end';
  damage: number | null;
  questionIndex: number | null;
  timestamp: string;
}

export interface DuelState {
  id: string;
  code: string;
  status: DuelStatus;
  title: string;
  quizId: string | null;
  maxHp: number;
  questionCount: number;
  baseDamage: number;
  winnerUid: string | null;
  endReason: DuelEndReason;
  isHost: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  me: DuelPlayer | null;
  opponent: DuelPlayer | null;
  question: DuelQuestion | null;
  events: DuelEvent[];
}

export interface OpenDuel {
  id: string;
  code: string;
  title: string;
  host: string;
  questionCount: number;
  createdAt: string;
  mine: boolean;
}

export interface DuelHistoryEntry {
  id: string;
  title: string;
  finishedAt: string;
  endReason: DuelEndReason;
  outcome: 'win' | 'loss' | 'draw';
  opponent: string | null;
  myHp: number | null;
  opponentHp: number | null;
}

export interface AnswerResult {
  correct: boolean;
  damage: number;
  correctIndexes: number[];
  explanation: string | null;
  duel: DuelState;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init?.headers || {}) } : init?.headers
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server's error codes double as i18n keys (duelError_*), so the raw
    // string is worth more here than a generic message.
    const code = (body as { error?: string })?.error;
    throw new Error(code || `request_failed_${res.status}`);
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

// The host's client supplies the questions because the built-in quizzes ship
// in the bundle rather than the database. From here on the server's copy is
// the only one that counts — see the note at the top of server/duels.js.
export const createDuel = (d: { title: string; quizId: string | null; questions: unknown[] }) =>
  post<{ duel: DuelState }>('/api/duels', d).then(r => r.duel);

export const joinDuel = (by: { code?: string; id?: string }) =>
  post<{ duel: DuelState }>('/api/duels/join', by).then(r => r.duel);

export const fetchDuel = (id: string) =>
  req<{ duel: DuelState }>(`/api/duels/${encodeURIComponent(id)}`).then(r => r.duel);

export const fetchOpenDuels = () => req<{ duels: OpenDuel[] }>('/api/duels/open').then(r => r.duels);

export const fetchMyDuels = () =>
  req<{ active: { id: string; code: string; title: string; status: DuelStatus }[]; recent: DuelHistoryEntry[] }>('/api/duels/mine');

// `picked` is a list of option indices — empty means "I don't know", which
// counts as a miss and deals no damage.
export const answerDuel = (id: string, index: number, picked: number[]) =>
  post<AnswerResult>(`/api/duels/${encodeURIComponent(id)}/answer`, { index, picked });

export const forfeitDuel = (id: string) =>
  post<{ duel: DuelState }>(`/api/duels/${encodeURIComponent(id)}/forfeit`).then(r => r.duel);
