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
  uiLang: 'de' | 'en';
  theme: 'light' | 'dark';
  focusMode: boolean;
  logActivity: boolean;
  isAdmin: boolean;
  deactivatedAt?: string | null;
}

// Preferences the server owns, so they follow the user across devices. The
// same values are exposed generically via /api/settings for the account
// portal — see server/settings.js.
export type UserSettings = Partial<{
  gravatarEmail: string;
  hideFromLeaderboard: boolean;
  uiLang: 'de' | 'en';
  theme: 'light' | 'dark';
  focusMode: boolean;
  logActivity: boolean;
}>;

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

// Partial update — only the keys given are touched.
export const saveSettings = (settings: UserSettings) =>
  req<{ values: Required<UserSettings> }>('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings)
  });

export const saveProfile = (gravatarEmail: string, hideFromLeaderboard: boolean) =>
  saveSettings({ gravatarEmail, hideFromLeaderboard });

// Freezes the account: sign-in is refused and leaderboard entries are removed,
// but nothing is deleted. Only an admin can undo it.
export const deactivateAccount = (confirmUsername: string) =>
  post<{ ok: true; deactivated: true }>('/api/settings/deactivate', { confirm: confirmUsername });

// Irreversible (GDPR Art. 17). Published quizzes survive, but anonymised.
export const deleteAccount = (confirmUsername: string) =>
  req<{ ok: true; deleted: true; summary: Record<string, number> }>('/api/settings/account', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: confirmUsername })
  });

export const exportMyDataUrl = '/api/settings/export';

// One call per answered question — the server updates the global tally, the
// per-quiz tally and the attempt log in a single transaction.
export const recordAnswer = (a: {
  questionId: string; quizId: string | null; category: string; correct: boolean; skipped: boolean;
}) => post<{ ok: true }>('/api/data/answer', a);

// --- Activity log ---
//
// "When did I work?", separate from the per-question stats. The server stamps
// the time and silently drops the event when the user has logging off, so
// callers here can fire and forget.

export type ActivityKind = 'quiz_start' | 'quiz_finish' | 'exam_start' | 'exam_finish';

export interface ActivityEntry {
  id: number;
  kind: ActivityKind;
  title: string;
  quizId: string | null;
  questionCount: number | null;
  score: number | null;
  total: number | null;
  durationSeconds: number | null;
  startedAt: string | null;
  timestamp: string;
}

// Never rejects: a failed log write must not interrupt a quiz that is
// otherwise fine, and the user finds out it's empty by looking at the page.
export const logActivity = (e: {
  kind: ActivityKind; title: string; quizId?: string | null; questionCount?: number | null;
  score?: number | null; total?: number | null; durationSeconds?: number | null; startedAt?: string | null;
}) => post<{ ok: true; id?: number }>('/api/data/activity', e).catch(err => {
  console.error('Could not write the activity log', err);
  return { ok: true as const };
});

export const fetchActivity = (limit = 200) =>
  req<{ enabled: boolean; total: number; entries: ActivityEntry[] }>(`/api/data/activity?limit=${limit}`);

export const clearActivity = () =>
  req<{ ok: true; deleted: number }>('/api/data/activity', { method: 'DELETE' });

export const activityCsvUrl = '/api/data/activity/export.csv';

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
