import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, Firestore } from 'firebase/firestore';
import { Trophy, Medal, ChevronLeft, EyeOff, Timer } from 'lucide-react';

interface LeaderboardEntry {
  id: string; // uid
  username?: string;
  bestScore?: number;
  bestTotal?: number;
  bestPercentage?: number;
  bestTimeSeconds?: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface LeaderboardProps {
  db: Firestore;
  appId: string;
  quizId: string;
  quizTitle: string;
  currentUserId: string;
  hideFromLeaderboard: boolean;
  onBack: () => void;
}

const MEDAL_COLORS = ['text-amber-400', 'text-zinc-400', 'text-amber-700'];

export default function Leaderboard({ db, appId, quizId, quizTitle, currentUserId, hideFromLeaderboard, onBack }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const entriesRef = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboards', quizId, 'entries');
    const unsub = onSnapshot(entriesRef, (snapshot) => {
      const rows = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as LeaderboardEntry));
      // Rank by score first; a faster completion time only matters as the
      // tiebreaker between equal percentages (missing times sort last).
      rows.sort((a, b) =>
        (b.bestPercentage ?? -1) - (a.bestPercentage ?? -1) ||
        (a.bestTimeSeconds ?? Infinity) - (b.bestTimeSeconds ?? Infinity)
      );
      setEntries(rows);
      setLoading(false);
    }, (err) => {
      console.error("Leaderboard sync error", err);
      setLoading(false);
    });
    return () => unsub();
  }, [db, appId, quizId]);

  return (
    <div className="min-h-screen flex items-start justify-center p-4 py-12">
      <div className="max-w-2xl w-full">
        <button onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-zinc-500 dark:text-[#9D99A8] hover:text-purple-600 dark:hover:text-purple-400 mb-4">
          <ChevronLeft size={16} /> Back
        </button>

        <div className="bg-white dark:bg-[#18161F] rounded-3xl shadow-2xl overflow-hidden border border-zinc-100 dark:border-[#2A2633]">
          <div className="bg-purple-600 dark:bg-purple-700 p-8 text-center text-white">
            <Trophy className="mx-auto mb-3 opacity-90" size={40} />
            <h2 className="text-2xl font-bold">{quizTitle}</h2>
            <p className="text-purple-200 text-sm mt-1">Leaderboard</p>
            <p className="text-purple-200/80 text-xs mt-2 flex items-center justify-center gap-1"><Timer size={12} /> Ranked by score first — ties go to whoever finished faster</p>
          </div>

          {hideFromLeaderboard && (
            <div className="flex items-center gap-2 px-6 py-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium">
              <EyeOff size={14} /> You're hidden from leaderboards — your scores are saved but never shown here. Change this in Profile Settings.
            </div>
          )}

          <div className="p-6 space-y-2">
            {loading ? (
              <p className="text-sm text-zinc-400 italic text-center py-6">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-zinc-400 italic text-center py-6">No scores yet — be the first to finish this quiz!</p>
            ) : (
              entries.map((entry, index) => {
                const isMe = entry.id === currentUserId;
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center gap-4 p-4 rounded-xl border ${isMe ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700' : 'bg-zinc-50 dark:bg-[#23202B] border-transparent'}`}
                  >
                    <div className="w-8 flex justify-center">
                      {index < 3 ? (
                        <Medal className={MEDAL_COLORS[index]} size={22} />
                      ) : (
                        <span className="text-sm font-bold text-zinc-400">{index + 1}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold truncate ${isMe ? 'text-purple-700 dark:text-purple-300' : 'text-zinc-800 dark:text-white'}`}>
                        {entry.username || 'Anonymous'}{isMe ? ' (you)' : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-zinc-800 dark:text-white">{entry.bestPercentage ?? 0}%</p>
                      <p className="text-xs text-zinc-400 flex items-center justify-end gap-2">
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
