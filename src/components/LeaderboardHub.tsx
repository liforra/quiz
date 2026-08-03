import React, { useEffect, useState } from 'react';
import { fetchLeaderboards, LeaderboardSummary } from '../data';
import { Trophy, ChevronLeft, Shuffle, ChevronRight } from 'lucide-react';
import { t, Lang } from '../i18n';

interface LeaderboardHubProps {
  uiLang: Lang;
  onOpenLeaderboard: (quizId: string, title: string) => void;
  onBack: () => void;
}

export default function LeaderboardHub({ uiLang, onOpenLeaderboard, onBack }: LeaderboardHubProps) {
  const [boards, setBoards] = useState<LeaderboardSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Already ordered by the server (most recently played first).
    fetchLeaderboards()
      .then(({ leaderboards }) => setBoards(leaderboards))
      .catch(err => console.error('Leaderboard hub fetch error', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-zinc-500 dark:text-[#9D99A8] hover:text-purple-600 dark:hover:text-purple-400 mb-6">
        <ChevronLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20 shrink-0">
          <Trophy size={26} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{t(uiLang, 'leaderboards')}</h1>
          <p className="text-sm text-zinc-400">{t(uiLang, 'leaderboardsDesc')}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400 italic text-center py-16">Loading…</p>
      ) : boards.length === 0 ? (
        <p className="text-sm text-zinc-400 italic text-center py-16">{t(uiLang, 'noLeaderboardsYet')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {boards.map(board => (
            <button
              key={board.quizId}
              onClick={() => onOpenLeaderboard(board.quizId, board.title || 'Quiz')}
              className="group flex items-center gap-4 p-5 bg-white dark:bg-[#18161F] rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633] hover:border-purple-500 dark:hover:border-purple-400 hover:shadow-md transition-all text-left"
            >
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${board.isCustom ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-500' : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400'}`}>
                {board.isCustom ? <Shuffle size={20} /> : <Trophy size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-zinc-800 dark:text-white truncate">{board.title || 'Quiz'}</p>
                {board.isCustom && (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">{t(uiLang, 'customQuizLeaderboard')}</p>
                )}
              </div>
              <ChevronRight size={18} className="text-zinc-300 dark:text-zinc-600 group-hover:text-purple-500 transition-colors shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
