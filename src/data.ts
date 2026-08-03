// Client for the app's own data API (server/data.js) — the replacement for
// the direct Firestore access this app used to do from the browser.
//
// Everything goes through the session cookie, so there is no uid, token or
// project config on the client at all. `credentials: 'same-origin'` is the
// default for same-origin requests, which is all we make.

export interface AppUser {
  uid: string;
  username: string;
  email: string;
  gravatarEmail: string;
  hideFromLeaderboard: boolean;
  isAdmin: boolean;
}

export interface QuestionStat {
  correct: number;
  wrong: number;
  lastPlayed: string | null;
}

export interface Attempt {
  questionId: string;
  category: string;
  correct: boolean;
  skipped: boolean;
  quizId: string | null;
  timestamp: string;
}

export interface StoredQuiz {
  id: string;
  title: string;
  icon: string;
  modes: string[];
  questions: any[];
  author: string;
  authorId: string;
  createdAt: string;
}

export interface CustomMode {
  id: string;
  label: string;
  icon: string;
  createdAt: string;
}

export interface Bootstrap {
  user: AppUser;
  stats: Record<string, QuestionStat>;
  attempts: Attempt[];
  privateQuizzes: StoredQuiz[];
  publicQuizzes: StoredQuiz[];
  customModes: CustomMode[];
}

export interface LeaderboardEntry {
  uid: string;
  username: string;
  bestScore: number | null;
  bestTotal: number | null;
  bestPercentage: number | null;
  bestTimeSeconds: number | null;
  lastPlayed: string;
}

export interface LeaderboardSummary {
  quizId: string;
  title: string;
  isCustom: boolean;
  updatedAt: string;
  entryCount: number;
}

export class UnauthenticatedError extends Error {
  constructor() { super('unauthenticated'); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init?.headers || {}) } : init?.headers
  });
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as any));
    throw new Error(body.error || `request_failed_${res.status}`);
  }
  return res.json();
}

const post = <T>(path: string, body?: any) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

// --- Auth ---

export interface AuthStatus {
  authentik: boolean;
  legacyMigration: boolean;
  issuer: string | null;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    return await req<AuthStatus>('/api/auth/status');
  } catch {
    return { authentik: false, legacyMigration: false, issuer: null };
  }
}

// Returns null when nobody is signed in — the replacement for the "no user"
// branch of onAuthStateChanged.
export async function fetchMe(): Promise<AppUser | null> {
  try {
    return await req<AppUser>('/api/auth/me');
  } catch (e) {
    if (e instanceof UnauthenticatedError) return null;
    throw e;
  }
}

// Ends the local session. `ssoLogoutUrl` is where to send the browser to also
// end the Authentik session — without that leg the next login would be
// silently auto-approved by the still-valid SSO session.
export const logout = () => post<{ ok: true; ssoLogoutUrl: string | null }>('/api/auth/logout');

// Verifies a legacy username/password and pulls that account's data across
// from Firestore. Returns a ticket that ties the following Authentik login to
// the migrated account.
export const verifyLegacyAccount = (username: string, password: string) =>
  post<{ ticket: string; username: string; imported: Record<string, number> }>(
    '/api/auth/legacy/verify', { username, password }
  );

// Migrates a user who was already signed in when the app switched over,
// using the Firebase session still sitting in their browser (src/legacySession.ts).
export const migrateLegacySession = (refreshToken: string) =>
  post<{ ticket: string; username: string; imported: Record<string, number> }>(
    '/api/auth/legacy/session', { refreshToken }
  );

// Full-page navigation: the OIDC flow needs the browser's own session with
// auth.liforra.de, and a popup would break on mobile.
export function startAuthentikLogin(ticket?: string) {
  window.location.href = ticket
    ? `/api/auth/authentik/start?ticket=${encodeURIComponent(ticket)}`
    : '/api/auth/authentik/start';
}

// --- Data ---

export const fetchBootstrap = () => req<Bootstrap>('/api/data/bootstrap');

export const fetchQuizStats = (quizId: string) =>
  req<{ stats: Record<string, QuestionStat> }>(`/api/data/quiz-stats/${encodeURIComponent(quizId)}`);

export const saveProfile = (gravatarEmail: string, hideFromLeaderboard: boolean) =>
  req<{ ok: true }>('/api/data/profile', {
    method: 'PATCH',
    body: JSON.stringify({ gravatarEmail, hideFromLeaderboard })
  });

// One call per answered question — the server updates the global tally, the
// per-quiz tally and the attempt log in a single transaction.
export const recordAnswer = (a: {
  questionId: string; quizId: string | null; category: string; correct: boolean; skipped: boolean;
}) => post<{ ok: true }>('/api/data/answer', a);

export const createQuiz = (q: {
  scope: 'private' | 'public'; title: string; icon: string; modes: string[]; questions: any[];
}) => post<{ id: string }>('/api/data/quizzes', q);

export const updateQuiz = (id: string, q: { title: string; icon: string; modes: string[] }) =>
  req<{ ok: true }>(`/api/data/quizzes/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(q)
  });

export const deleteQuiz = (id: string) =>
  req<{ ok: true }>(`/api/data/quizzes/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const createMode = (label: string, icon: string) =>
  post<{ id: string }>('/api/data/modes', { label, icon });

export const fetchLeaderboards = () =>
  req<{ leaderboards: LeaderboardSummary[] }>('/api/data/leaderboards');

export const fetchLeaderboard = (quizId: string) =>
  req<{ entries: LeaderboardEntry[] }>(`/api/data/leaderboards/${encodeURIComponent(quizId)}`);

// The server decides whether this beats the previous best, so a tampered
// client can't replace a good result with a worse one.
export const submitLeaderboardResult = (quizId: string, r: {
  title: string; score: number; total: number; timeSeconds: number;
}) => post<{ ok: true; improved?: boolean }>(`/api/data/leaderboards/${encodeURIComponent(quizId)}`, r);

// --- AI usage ---

export const recordAiUsage = (totalTokens: number) =>
  post<{ ok: true }>('/api/data/ai-usage', { totalTokens });

export interface AiUsageRow {
  uid: string;
  username: string;
  totalRequests: number;
  totalTokens: number;
  avgRequestsPerMin: number;
  avgTokensPerMin: number;
}

export const fetchAiUsageLeaderboard = () =>
  req<{ usage: AiUsageRow[] }>('/api/data/admin/ai-usage');

// --- Admin ---

export interface AdminUserRow {
  uid: string;
  username: string;
  email: string | null;
  lastLogin: string | null;
  migrated: boolean;
  linked: boolean;
  attemptCount: number;
}

export const fetchAdminUsers = () => req<{ users: AdminUserRow[] }>('/api/data/admin/users');

export const fetchAdminUser = (uid: string) =>
  req<{ user: AppUser; stats: Record<string, QuestionStat>; attempts: Attempt[]; quizzes: StoredQuiz[] }>(
    `/api/data/admin/users/${encodeURIComponent(uid)}`
  );
