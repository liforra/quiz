import React, { useMemo, useState } from 'react';
import { Award, TrendingUp } from 'lucide-react';
import { computeCategoryBreakdown, pickBestCategory, bucketAttemptsByDay, Attempt, StatEntry } from '../stats';
import StatsChart from './StatsChart';
import { t, Lang } from '../i18n';

interface StatsPanelProps {
  statsMap: Record<string, StatEntry>;
  attempts: Attempt[];
  quizzes: any[];
  uiLang: Lang;
}

export default function StatsPanel({ statsMap, attempts, quizzes, uiLang }: StatsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const breakdown = useMemo(() => computeCategoryBreakdown(statsMap, quizzes), [statsMap, quizzes]);
  const best = useMemo(() => pickBestCategory(breakdown), [breakdown]);
  const dayPoints = useMemo(() => bucketAttemptsByDay(attempts, activeCategory), [attempts, activeCategory]);

  if (breakdown.length === 0) {
    return <p className="text-sm text-zinc-400 italic">{t(uiLang, 'noStatsYet')}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Category filter — scopes the callout, list and chart below */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeCategory === null ? 'bg-purple-600 text-white' : 'bg-zinc-100 dark:bg-[#23202B] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2A2633]'}`}
        >
          {t(uiLang, 'allCategories')}
        </button>
        {breakdown.map(c => (
          <button
            key={c.name}
            onClick={() => setActiveCategory(c.name)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeCategory === c.name ? 'bg-purple-600 text-white' : 'bg-zinc-100 dark:bg-[#23202B] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2A2633]'}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Best category callout */}
      {best && (
        <div className="flex items-center gap-4 p-5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl shadow-lg shadow-purple-200 dark:shadow-none">
          <div className="p-3 bg-white/20 rounded-xl"><Award size={28} /></div>
          <div>
            <p className="text-xs uppercase tracking-wider text-purple-100 font-bold">{t(uiLang, 'bestCategory')}</p>
            <p className="text-xl font-bold">{best.name} — {Math.round(best.correct / (best.correct + best.wrong || 1) * 100)}%</p>
            <p className="text-sm text-purple-100">{best.correct}/{best.correct + best.wrong} {t(uiLang, 'attempts')}</p>
          </div>
        </div>
      )}

      {/* Full category breakdown */}
      <div className="bg-white dark:bg-[#18161F] rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633] p-5">
        <h3 className="flex items-center gap-2 font-bold text-zinc-800 dark:text-white mb-4">
          <TrendingUp size={18} className="text-purple-500" /> {t(uiLang, 'performanceStats')}
        </h3>
        <div className="space-y-3">
          {breakdown.map(c => {
            const total = c.correct + c.wrong;
            const pct = Math.round((c.correct / (total || 1)) * 100);
            return (
              <div key={c.name}>
                <div className="flex justify-between items-center text-sm mb-1">
                  <span className="font-medium text-zinc-600 dark:text-zinc-300 truncate">{c.name}</span>
                  <span className="text-xs text-zinc-400">{pct}% · {total} {t(uiLang, 'attempts')}</span>
                </div>
                <div className="h-1.5 bg-zinc-100 dark:bg-[#23202B] rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Trend chart */}
      <div className="bg-white dark:bg-[#18161F] rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633] p-5">
        <h3 className="flex items-center gap-2 font-bold text-zinc-800 dark:text-white mb-2">
          {t(uiLang, 'accuracyOverTime')}
        </h3>
        <StatsChart points={dayPoints} label={activeCategory || t(uiLang, 'allCategories')} uiLang={uiLang} />
      </div>
    </div>
  );
}
