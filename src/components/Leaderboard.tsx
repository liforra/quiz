import React, { useEffect, useState } from 'react';
import { fetchLeaderboard, LeaderboardEntry } from '../data';
import { Trophy, ChevronLeft, EyeOff, Timer } from 'lucide-react';

const PODIUM_STYLES = [
  { badge: 'bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-lg shadow-amber-500/30', height: 'h-24', order: 'order-2' },
  { badge: 'bg-gradient-to-br from-zinc-300 to-zinc-400 text-white shadow-lg shadow-zinc-400/30', height: 'h-16', order: 'order-1' },
  { badge: 'bg-gradient-to-br from-amber-600 to-amber-800 text-white shadow-lg shadow-amber-700/30', height: 'h-12', order: 'order-3' },
];

function initials(name?: string): string {
  return (name || '?').trim().substring(0, 2).toUpperCase();
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface LeaderboardProps {
  quizId: string;
  quizTitle: string;
  currentUserId: string;
  hideFromLeaderboard: boolean;
  onBack: () => void;
}

export default function Leaderboard({ quizId, quizTitle, currentUserId, hideFromLeaderboard, onBack }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    // The server already sorts by percentage with completion time as the
    // tiebreaker; sorting again here would just duplicate that rule.
    fetchLeaderboard(quizId)
      .then(({ entries }) => { if (!cancelled) { setEntries(entries); setLoading(false); } })
      .catch((err) => {
        console.error("Leaderboard fetch error", err);
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [quizId]);

  return (
    <div className="min-h-screen flex items-start justify-center p-4 py-12">
      <div className="max-w-2xl w-full">
        <button onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-zinc-500 dark:text-[#9D99A8] hover:text-purple-600 dark:hover:text-purple-400 mb-4">
          <ChevronLeft size={16} /> Back
        </button>

        <div className="bg-white dark:bg-[#18161F] rounded-3xl shadow-2xl overflow-hidden border border-zinc-100 dark:border-[#2A2633]">
          <div className="bg-purple-600 dark:bg-purple-700 p-6 sm:p-8 text-center text-white">
            <Trophy className="mx-auto mb-3 opacity-90" size={40} />
            <h2 className="text-xl sm:text-2xl font-bold break-words">{quizTitle}</h2>
            <p className="text-purple-200 text-sm mt-1">Leaderboard</p>
            <p className="text-purple-200/80 text-xs mt-2 flex items-center justify-center gap-1"><Timer size={12} /> Ranked by score first — ties go to whoever finished faster</p>
          </div>

          {hideFromLeaderboard && (
            <div className="flex items-center gap-2 px-6 py-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium">
              <EyeOff size={14} /> You're hidden from leaderboards — your scores are saved but never shown here. Change this in Profile Settings.
            </div>
          )}

          {!loading && entries.length > 0 && (
            <div className="flex items-end justify-center gap-3 sm:gap-6 px-6 pt-8 pb-2 bg-zinc-50/50 dark:bg-[#1C1A24]">
              {entries.slice(0, 3).map((entry, index) => {
                const isMe = entry.uid === currentUserId;
                const style = PODIUM_STYLES[index];
                return (
                  <div key={entry.uid} className={`flex flex-col items-center ${style.order} w-24 sm:w-28`}>
                    <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center font-bold text-sm mb-2 ${style.badge} ${isMe ? 'ring-4 ring-purple-400/50' : ''}`}>
                      {initials(entry.username)}
                    </div>
                    <p className={`text-xs font-bold truncate w-full text-center ${isMe ? 'text-purple-600 dark:text-purple-400' : 'text-zinc-700 dark:text-zinc-200'}`}>
                      {entry.username || 'Anonymous'}
                    </p>
                    <p className="text-[11px] text-zinc-400 mb-2">{entry.bestPercentage ?? 0}%</p>
                    <div className={`w-full ${style.height} rounded-t-xl ${style.badge} flex items-start justify-center pt-2 text-lg font-black`}>
                      {index + 1}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="p-3 sm:p-6 space-y-2">
            {loading ? (
              <p className="text-sm text-zinc-400 italic text-center py-6">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-zinc-400 italic text-center py-6">No scores yet — be the first to finish this quiz!</p>
            ) : (
              entries.slice(3).map((entry, i) => {
                const index = i + 3;
                const isMe = entry.uid === currentUserId;
                return (
                  <div
                    key={entry.uid}
                    className={`flex items-center gap-2 sm:gap-4 p-3 sm:p-4 rounded-xl border ${isMe ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700' : 'bg-zinc-50 dark:bg-[#23202B] border-transparent'}`}
                  >
                    <span className="w-6 sm:w-8 text-center text-sm font-bold text-zinc-400 shrink-0">{index + 1}</span>
                    <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-[#2A2633] text-zinc-500 dark:text-zinc-300 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {initials(entry.username)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold truncate ${isMe ? 'text-purple-700 dark:text-purple-300' : 'text-zinc-800 dark:text-white'}`}>
                        {entry.username || 'Anonymous'}{isMe ? ' (you)' : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-zinc-800 dark:text-white">{entry.bestPercentage ?? 0}%</p>
                      <p className="text-xs text-zinc-400 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
                        {entry.bestScore != null && entry.bestTotal != null && <span>{entry.bestScore}/{entry.bestTotal}</span>}
                        {entry.bestTimeSeconds != null && (
                          <span className="flex items-center gap-0.5"><Timer size={11} /> {formatTime(entry.bestTimeSeconds)}</span>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
