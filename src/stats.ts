export const UNKNOWN_CATEGORY = 'Unknown';

export interface StatEntry {
  correct?: number;
  wrong?: number;
  lastPlayed?: string;
}

export interface Attempt {
  questionId: string;
  category: string;
  correct: boolean;
  quizId?: string | null;
  timestamp: string;
}

export interface CategoryBucket {
  name: string;
  correct: number;
  wrong: number;
}

// Cross-references every answered question id (from statsMap, which has all
// of them unconditionally) against the currently-loaded quiz question pools
// to find its category. Falls back to "Unknown" whenever the question has no
// category field, or isn't found in any currently-loaded quiz (deleted quiz,
// pre-category-tracking history) — so nothing is ever silently dropped.
export function computeCategoryBreakdown(statsMap: Record<string, StatEntry>, quizzes: any[]): CategoryBucket[] {
  const idToCategory = new Map<string, string>();
  for (const quiz of quizzes) {
    for (const q of quiz.questions || []) {
      if (!idToCategory.has(q.id)) idToCategory.set(q.id, q.category || UNKNOWN_CATEGORY);
    }
  }

  const buckets = new Map<string, CategoryBucket>();
  for (const [qid, s] of Object.entries(statsMap)) {
    const name = idToCategory.get(qid) || UNKNOWN_CATEGORY;
    const bucket = buckets.get(name) || { name, correct: 0, wrong: 0 };
    bucket.correct += s.correct || 0;
    bucket.wrong += s.wrong || 0;
    buckets.set(name, bucket);
  }

  return Array.from(buckets.values()).sort((a, b) => (b.correct + b.wrong) - (a.correct + a.wrong));
}

// Highest accuracy among categories with enough attempts to be meaningful;
// falls back to whichever has the most attempts if none qualify.
export function pickBestCategory(breakdown: CategoryBucket[], minAttempts = 3): CategoryBucket | null {
  if (breakdown.length === 0) return null;
  const qualified = breakdown.filter(b => b.correct + b.wrong >= minAttempts);
  const pool = qualified.length > 0 ? qualified : breakdown;
  return pool.reduce((best, b) => {
    const rate = b.correct / (b.correct + b.wrong || 1);
    const bestRate = best.correct / (best.correct + best.wrong || 1);
    return rate > bestRate ? b : best;
  }, pool[0]);
}

export interface DayBucket {
  date: string; // YYYY-MM-DD
  correct: number;
  wrong: number;
}

export function bucketAttemptsByDay(attempts: Attempt[], categoryFilter?: string | null): DayBucket[] {
  const scoped = categoryFilter ? attempts.filter(a => a.category === categoryFilter) : attempts;
  const byDay = new Map<string, DayBucket>();
  for (const a of scoped) {
    const date = a.timestamp.slice(0, 10); // ISO date prefix
    const bucket = byDay.get(date) || { date, correct: 0, wrong: 0 };
    if (a.correct) bucket.correct++; else bucket.wrong++;
    byDay.set(date, bucket);
  }
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
}
