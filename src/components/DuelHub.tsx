// The duel lobby: build a match, open a lobby, or drop into someone else's.
//
// The question list is assembled here, in the host's browser, because that is
// where the library lives (built-in quizzes ship in the bundle, uploads come
// from /api/data/bootstrap). It is handed to the server once at creation —
// from then on the server's copy is the only one either player sees.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Swords, ChevronLeft, ChevronRight, Copy, Check, Users, Loader2,
  Crown, Skull, Minus, Hourglass, BookOpen
} from 'lucide-react';
import * as duels from '../duels';
import { t, Lang } from '../i18n';

// Only the fields the picker needs — every quiz in the library (built-in,
// private, public) satisfies this, whatever else it carries.
interface LibraryQuestion {
  type?: string;
  options?: unknown[];
}
interface LibraryQuiz {
  id: string;
  title: string;
  questions?: LibraryQuestion[];
}

interface DuelHubProps {
  uiLang: Lang;
  quizzes: LibraryQuiz[];
  onBack: () => void;
  onEnterDuel: (duel: duels.DuelState) => void;
}

// Free-text questions can't be graded server-side without an AI round trip,
// so a duel is choice questions only — the same filter the server applies.
const isChoice = (q: LibraryQuestion) =>
  ['single', 'single_choice', 'multiple', 'multiple_response'].includes(q?.type ?? '')
  && Array.isArray(q?.options) && q.options.length >= 2;

const MIN_POOL = 4;
const COUNT_OPTIONS = [10, 15, 20, 30];

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function DuelHub({ uiLang, quizzes, onBack, onEnterDuel }: DuelHubProps) {
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);
  const [count, setCount] = useState(15);
  const [open, setOpen] = useState<duels.OpenDuel[]>([]);
  const [mine, setMine] = useState<{ id: string; code: string; title: string; status: duels.DuelStatus }[]>([]);
  const [history, setHistory] = useState<duels.DuelHistoryEntry[]>([]);
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const duelable = useMemo(
    () => quizzes
      .map(q => ({ ...q, pool: (q.questions || []).filter(isChoice) }))
      .filter(q => q.pool.length >= MIN_POOL)
      .sort((a, b) => a.title.localeCompare(b.title)),
    [quizzes]
  );
  const selected = duelable.find(q => q.id === selectedQuizId) || null;
  const maxCount = selected ? Math.min(selected.pool.length, 30) : 30;

  const refresh = useCallback(() => {
    duels.fetchOpenDuels().then(setOpen).catch(e => console.error('Open duels fetch failed', e));
    duels.fetchMyDuels()
      .then(({ active, recent }) => { setMine(active); setHistory(recent); })
      .catch(e => console.error('My duels fetch failed', e));
  }, []);

  // Slow poll: the hub only needs to notice that somebody opened a lobby, and
  // the fast 1s heartbeat belongs to the arena, not here.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      // t() echoes the key back when there is no string for it, which is how
      // an unexpected server error code falls through to its raw form.
      const code = e instanceof Error ? e.message : String(e);
      const message = t(uiLang, `duelError_${code}`);
      setError(message.startsWith('duelError_') ? code : message);
    } finally {
      setBusy(false);
    }
  };

  const create = () => guard(async () => {
    if (!selected) return;
    const questions = shuffle(selected.pool).slice(0, Math.min(count, selected.pool.length));
    onEnterDuel(await duels.createDuel({ title: selected.title, quizId: selected.id, questions }));
  });

  const join = (by: { code?: string; id?: string }) => guard(async () => {
    onEnterDuel(await duels.joinDuel(by));
  });

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(''), 1500);
    }).catch(() => {});
  };

  const outcomeStyle = {
    win: { icon: <Crown size={16} />, cls: 'text-green-600 dark:text-green-400', label: t(uiLang, 'duelWin') },
    loss: { icon: <Skull size={16} />, cls: 'text-red-500', label: t(uiLang, 'duelLoss') },
    draw: { icon: <Minus size={16} />, cls: 'text-zinc-400', label: t(uiLang, 'duelDraw') }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto w-full">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-zinc-500 dark:text-[#9D99A8] hover:text-purple-600 dark:hover:text-purple-400 mb-6">
        <ChevronLeft size={16} /> {t(uiLang, 'back')}
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-red-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-red-500/20 shrink-0">
          <Swords size={26} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{t(uiLang, 'duel')}</h1>
          <p className="text-sm text-zinc-400">{t(uiLang, 'duelDesc')}</p>
        </div>
      </div>

      {error && (
        <p className="mb-6 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* A duel you are already in beats anything else on this page. */}
      {mine.length > 0 && (
        <div className="mb-8 space-y-3">
          {mine.map(d => (
            <button
              key={d.id}
              onClick={() => join({ id: d.id })}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow-lg shadow-purple-500/20"
            >
              <span className="p-2 bg-white/20 rounded-xl">
                {d.status === 'waiting' ? <Hourglass size={20} /> : <Swords size={20} />}
              </span>
              <span className="flex-1 text-left">
                <span className="block font-bold">{d.title}</span>
                <span className="block text-xs text-purple-100 opacity-90">
                  {d.status === 'waiting' ? `${t(uiLang, 'duelWaiting')} · ${d.code}` : t(uiLang, 'duelInProgress')}
                </span>
              </span>
              <span className="text-sm font-bold flex items-center gap-1">{t(uiLang, 'duelResume')} <ChevronRight size={16} /></span>
            </button>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* --- Build a match --- */}
        <div className="bg-white dark:bg-[#18161F] rounded-2xl border border-zinc-100 dark:border-[#2A2633] p-5 shadow-sm">
          <h2 className="font-bold text-zinc-800 dark:text-white mb-1">{t(uiLang, 'duelNew')}</h2>
          <p className="text-xs text-zinc-400 mb-4">{t(uiLang, 'duelChoiceOnly')}</p>

          {duelable.length === 0 ? (
            <p className="text-sm text-zinc-400 italic py-6 text-center">{t(uiLang, 'duelNotEnoughQuestions')}</p>
          ) : (
            <>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">{t(uiLang, 'duelPickQuiz')}</p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 mb-5">
                {duelable.map(q => (
                  <button
                    key={q.id}
                    onClick={() => { setSelectedQuizId(q.id); setCount(c => Math.min(c, q.pool.length)); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                      selectedQuizId === q.id
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                        : 'border-zinc-200 dark:border-[#2A2633] hover:border-purple-300'
                    }`}
                  >
                    <BookOpen size={16} className="text-purple-500 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold text-zinc-700 dark:text-[#EBE9F0]">{q.title}</span>
                    <span className="text-xs text-zinc-400 shrink-0">{q.pool.length}</span>
                  </button>
                ))}
              </div>

              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">{t(uiLang, 'duelQuestionCount')}</p>
              <div className="flex flex-wrap gap-2 mb-5">
                {COUNT_OPTIONS.filter(n => n <= maxCount).map(n => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      count === n
                        ? 'bg-purple-600 text-white'
                        : 'bg-zinc-100 dark:bg-[#23202B] text-zinc-500 dark:text-[#9D99A8] hover:text-purple-600'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <button
                onClick={create}
                disabled={!selected || busy}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-red-500 to-purple-600 hover:from-red-600 hover:to-purple-700 disabled:opacity-40 text-white font-bold flex items-center justify-center gap-2 transition-all"
              >
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Swords size={18} />}
                {t(uiLang, 'duelCreate')}
              </button>
            </>
          )}
        </div>

        {/* --- Find a match --- */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#18161F] rounded-2xl border border-zinc-100 dark:border-[#2A2633] p-5 shadow-sm">
            <h2 className="font-bold text-zinc-800 dark:text-white mb-3">{t(uiLang, 'duelJoinByCode')}</h2>
            <form
              onSubmit={(e) => { e.preventDefault(); if (codeInput.trim()) join({ code: codeInput.trim() }); }}
              className="flex gap-2"
            >
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="ABCD"
                maxLength={8}
                className="flex-1 min-w-0 px-4 py-2.5 rounded-xl bg-zinc-50 dark:bg-[#23202B] border-2 border-zinc-200 dark:border-[#2A2633] focus:border-purple-500 outline-none font-mono text-lg tracking-[0.3em] text-center dark:text-white"
              />
              <button
                type="submit"
                disabled={!codeInput.trim() || busy}
                className="px-5 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-bold transition-colors"
              >
                {t(uiLang, 'duelJoin')}
              </button>
            </form>
          </div>

          <div className="bg-white dark:bg-[#18161F] rounded-2xl border border-zinc-100 dark:border-[#2A2633] p-5 shadow-sm">
            <h2 className="font-bold text-zinc-800 dark:text-white mb-3 flex items-center gap-2">
              <Users size={16} className="text-purple-500" /> {t(uiLang, 'duelOpen')}
            </h2>
            {open.length === 0 ? (
              <p className="text-sm text-zinc-400 italic py-4">{t(uiLang, 'duelNoOpen')}</p>
            ) : (
              <div className="space-y-2">
                {open.map(d => (
                  <div key={d.id} className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-[#2A2633]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-800 dark:text-white truncate">{d.title}</p>
                      <p className="text-xs text-zinc-400">
                        {d.mine ? t(uiLang, 'duelYourLobby') : d.host} · {d.questionCount} {t(uiLang, 'questions')}
                      </p>
                    </div>
                    {d.mine ? (
                      <button
                        onClick={() => copyCode(d.code)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-[#23202B] text-zinc-500 dark:text-[#9D99A8] font-mono text-sm hover:text-purple-600 transition-colors"
                      >
                        {copied === d.code ? <Check size={14} /> : <Copy size={14} />} {d.code}
                      </button>
                    ) : (
                      <button
                        onClick={() => join({ id: d.id })}
                        disabled={busy}
                        className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-sm font-bold transition-colors"
                      >
                        {t(uiLang, 'duelJoin')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- Past duels --- */}
      <h2 className="font-bold text-zinc-800 dark:text-white mt-10 mb-3">{t(uiLang, 'duelHistory')}</h2>
      {history.length === 0 ? (
        <p className="text-sm text-zinc-400 italic">{t(uiLang, 'duelNoHistory')}</p>
      ) : (
        <div className="space-y-2">
          {history.map(h => {
            const style = outcomeStyle[h.outcome];
            return (
              <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-[#18161F] border border-zinc-100 dark:border-[#2A2633]">
                <span className={`shrink-0 ${style.cls}`}>{style.icon}</span>
                <span className={`text-sm font-bold w-28 shrink-0 ${style.cls}`}>{style.label}</span>
                <span className="flex-1 min-w-0 truncate text-sm text-zinc-600 dark:text-[#9D99A8]">
                  {h.title} · {t(uiLang, 'duelVs')} {h.opponent || '—'}
                </span>
                <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">{h.myHp}–{h.opponentHp} HP</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
