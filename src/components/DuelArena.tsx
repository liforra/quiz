// The fight itself: two health bars, one question at a time, and damage that
// lands the moment somebody answers.
//
// Two things drive the whole component:
//
// * A 1s poll is the only channel — there is no socket. Every render is
//   therefore written to survive a state object that jumped forward without
//   warning (the opponent may have taken 40 HP off you between two frames).
// * The question on screen is *frozen* while feedback is showing. The polled
//   state already points at the next question by then, so rendering
//   `duel.question` directly would swap the card out from under the answer
//   the player is still looking at.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Swords, Copy, Check, Loader2, Crown, Skull, Minus,
  CheckCircle, XCircle, ChevronRight, HelpCircle, LogOut, Wifi, CheckSquare, Square
} from 'lucide-react';
import * as duels from '../duels';
import DuelStage, { DuelStageHandle } from './DuelStage';
import { t, Lang } from '../i18n';

interface DuelArenaProps {
  uiLang: Lang;
  initialDuel: duels.DuelState;
  onExit: () => void;
  // Fired once per answered question so the duel still feeds the normal
  // per-question statistics — a duel is practice like any other session.
  onAnswered: (info: { questionId: string; category: string; quizId: string | null; correct: boolean; skipped: boolean }) => void;
  onDuelStart: (duel: duels.DuelState) => void;
  onDuelFinish: (duel: duels.DuelState) => void;
}

const POLL_MS = 1000;
const NEXT_DELAY_CORRECT_MS = 1200;
const NEXT_DELAY_WRONG_MS = 2600;

interface Feedback {
  question: duels.DuelQuestion;
  picked: number[];
  correct: boolean;
  damage: number;
  correctIndexes: number[];
  explanation: string | null;
}

function shuffledIndices(n: number): number[] {
  const out = [...Array(n).keys()];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- Arena ---------------------------------------------------------------

export default function DuelArena({ uiLang, initialDuel, onExit, onAnswered, onDuelStart, onDuelFinish }: DuelArenaProps) {
  const [duel, setDuel] = useState<duels.DuelState>(initialDuel);
  const [selection, setSelection] = useState<number[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const stage = useRef<DuelStageHandle>(null);

  const correctSound = useRef<HTMLAudioElement | null>(null);
  const wrongSound = useRef<HTMLAudioElement | null>(null);
  const play = (ref: React.MutableRefObject<HTMLAudioElement | null>, src: string) => {
    if (!ref.current) ref.current = new Audio(src);
    ref.current.currentTime = 0;
    ref.current.play().catch(() => {}); // autoplay policy — never worth an error
  };

  // Polling can deliver an older snapshot than a just-returned answer
  // response (two requests, no ordering guarantee), so state only ever moves
  // forward: never back to an earlier question, never out of "finished".
  const applyState = useCallback((next: duels.DuelState) => {
    setDuel(prev => {
      if (!prev) return next;
      if ((next.me?.questionIndex ?? 0) < (prev.me?.questionIndex ?? 0)) return prev;
      if (prev.status === 'finished' && next.status !== 'finished') return prev;
      return next;
    });
  }, []);

  useEffect(() => {
    if (duel.status === 'finished' || duel.status === 'cancelled') return;
    const id = setInterval(() => {
      duels.fetchDuel(duel.id).then(applyState).catch(e => {
        console.error('Duel poll failed', e);
        // A duel that is *gone* (the other account was deleted, which cascades
        // the row away) can never come back, so stop polling a 404 forever.
        // Anything else — a dropped connection, a restarting server — is worth
        // retrying on the next tick.
        if (e instanceof Error && e.message === 'not_found') onExit();
      });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [duel.id, duel.status, applyState, onExit]);

  // --- Reacting to the opponent -------------------------------------------
  //
  // Incoming shots are driven by the battle log rather than by watching HP
  // drop: the log carries the exact damage of each hit *and* records misses
  // (which change no HP at all), and its ids make it impossible to animate
  // the same hit twice across two polls. Everything already seen at mount is
  // marked off, so rejoining a duel doesn't replay the whole fight at once.
  const seenEvent = useRef(Math.max(0, ...initialDuel.events.map(e => e.id), 0));
  useEffect(() => {
    const fresh = duel.events.filter(e => e.id > seenEvent.current && (e.kind === 'hit' || e.kind === 'miss'));
    if (fresh.length === 0) return;
    seenEvent.current = Math.max(seenEvent.current, ...duel.events.map(e => e.id));

    // My own shots were already fired the moment the answer came back — much
    // more responsive than waiting for the next poll to tell me what I did.
    const theirs = fresh.filter(e => e.uid !== duel.me?.uid).reverse();
    const timers = theirs.map((e, i) => window.setTimeout(() => {
      const flight = stage.current?.fire('opponent', e.damage ?? 0) ?? 0;
      // The thud belongs to the impact, not to the launch.
      if (e.kind === 'hit') window.setTimeout(() => play(wrongSound, '/sounds/wrong.mp3'), flight);
    }, i * 320)); // staggered: a poll can carry two hits at once
    return () => timers.forEach(clearTimeout);
  }, [duel.events, duel.me?.uid]);

  // Logbook: one entry when the match actually starts, one when it ends.
  const loggedStart = useRef(false);
  const loggedFinish = useRef(false);
  useEffect(() => {
    if (duel.status === 'active' && !loggedStart.current) {
      loggedStart.current = true;
      onDuelStart(duel);
    }
    if (duel.status === 'finished' && !loggedFinish.current) {
      loggedFinish.current = true;
      onDuelFinish(duel);
    }
  }, [duel, onDuelStart, onDuelFinish]);

  // --- The question on screen ---------------------------------------------

  const shown = feedback ? feedback.question : duel.question;
  // Deliberately keyed on the question index even though the body only reads
  // the option count: two questions with four options each must still get
  // their own draw, or the layout of the previous answer would carry over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const order = useMemo(() => shuffledIndices(shown?.options.length ?? 0), [shown?.index, shown?.options.length]);

  // Translated options must stay parallel to the originals — the index is
  // what gets submitted, so a differently-sized translation is dropped rather
  // than silently shifting every answer by one.
  const localized = useMemo(() => {
    if (!shown) return null;
    const tr = shown.translations?.[uiLang];
    if (!tr) return shown;
    return {
      ...shown,
      question: tr.question ?? shown.question,
      options: tr.options?.length === shown.options.length ? tr.options : shown.options
    };
  }, [shown, uiLang]);

  useEffect(() => { setSelection([]); }, [shown?.index]);

  const submit = useCallback(async (picked: number[]) => {
    if (!shown || feedback || submitting) return;
    setSubmitting(true);
    try {
      const result = await duels.answerDuel(duel.id, shown.index, picked);
      setFeedback({
        question: shown,
        picked,
        correct: result.correct,
        damage: result.damage,
        correctIndexes: result.correctIndexes,
        explanation: result.explanation
      });
      // Fire before applying the state so the shot leaves in the same frame
      // as the click; the health bars wait for it to land (see DuelStage).
      stage.current?.fire('me', result.damage);
      if (result.correct) play(correctSound, '/sounds/correct.mp3');
      applyState(result.duel);
      onAnswered({
        questionId: shown.id,
        category: shown.category,
        quizId: duel.quizId,
        correct: result.correct,
        skipped: picked.length === 0
      });
    } catch (e) {
      // out_of_sync means the server already moved us on (a double submit, or
      // a reload mid-question) — the next poll shows the truth either way.
      console.error('Duel answer failed', e);
      duels.fetchDuel(duel.id).then(applyState).catch(() => {});
    } finally {
      setSubmitting(false);
    }
  }, [shown, feedback, submitting, duel.id, duel.quizId, applyState, onAnswered]);

  const next = useCallback(() => setFeedback(null), []);

  // Auto-advance keeps the pace of a race; the button (and Space/Enter) skips
  // the wait for anyone faster than that.
  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(next, feedback.correct ? NEXT_DELAY_CORRECT_MS : NEXT_DELAY_WRONG_MS);
    return () => clearTimeout(id);
  }, [feedback, next]);

  const toggle = (index: number) =>
    setSelection(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);

  // --- Keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (duel.status !== 'active') return;

      if (feedback) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
        return;
      }
      if (!localized) return;

      if (e.key === '0') { e.preventDefault(); submit([]); return; }
      if (e.key === 'Enter' && localized.type === 'multiple') { e.preventDefault(); submit(selection); return; }

      const num = parseInt(e.key, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= order.length) {
        // Positions on screen are shuffled, so key "2" means "the option
        // drawn second", not option index 2 in the stored question.
        const optionIndex = order[num - 1];
        if (localized.type === 'multiple') toggle(optionIndex);
        else submit([optionIndex]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duel.status, feedback, localized, order, selection, submit, next]);

  const copyCode = () => {
    navigator.clipboard?.writeText(duel.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const leave = async () => {
    if (duel.status === 'active' && !window.confirm(t(uiLang, 'duelForfeitConfirm'))) return;
    try {
      await duels.forfeitDuel(duel.id);
    } catch (e) {
      console.error('Leaving the duel failed', e);
    }
    onExit();
  };

  // --- Waiting for an opponent --------------------------------------------

  if (duel.status === 'waiting') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-red-500 to-purple-600 flex items-center justify-center text-white shadow-xl shadow-purple-500/20 mb-6">
          <Swords size={36} />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-1">{duel.title}</h1>
        <p className="text-sm text-zinc-400 mb-8">{duel.questionCount} {t(uiLang, 'questions')} · {duel.maxHp} HP</p>

        <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400 mb-3">{t(uiLang, 'duelShareCode')}</p>
        <button
          onClick={copyCode}
          className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-white dark:bg-[#18161F] border-2 border-dashed border-purple-300 dark:border-purple-800 hover:border-purple-500 transition-colors mb-8 group"
        >
          <span className="font-mono text-4xl font-bold tracking-[0.3em] text-purple-600 dark:text-purple-400">{duel.code}</span>
          <span className="text-zinc-300 group-hover:text-purple-500 transition-colors">
            {copied ? <Check size={20} /> : <Copy size={20} />}
          </span>
        </button>

        <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-[#9D99A8] mb-10">
          <Loader2 size={16} className="animate-spin" /> {t(uiLang, 'duelWaiting')}
        </p>

        <button onClick={leave} className="text-sm font-semibold text-zinc-400 hover:text-red-500 transition-colors">
          {t(uiLang, 'duelCancel')}
        </button>
      </div>
    );
  }

  // --- Result -------------------------------------------------------------

  if (duel.status === 'finished' || duel.status === 'cancelled') {
    const won = duel.winnerUid && duel.winnerUid === duel.me?.uid;
    const lost = duel.winnerUid && duel.winnerUid !== duel.me?.uid;
    const banner = won
      ? { cls: 'from-green-500 to-emerald-600', icon: <Crown size={44} />, title: t(uiLang, 'duelVictory') }
      : lost
        ? { cls: 'from-red-500 to-rose-700', icon: <Skull size={44} />, title: t(uiLang, 'duelDefeat') }
        : { cls: 'from-zinc-500 to-zinc-700', icon: <Minus size={44} />, title: t(uiLang, 'duelDrawTitle') };

    const reasonKey = duel.endReason ? `duelEnd_${duel.endReason}` : 'duelEnd_cancelled';

    return (
      <div className="min-h-screen flex items-start justify-center p-4 py-12">
        <div className="max-w-2xl w-full bg-white dark:bg-[#18161F] rounded-3xl shadow-2xl overflow-hidden border border-zinc-100 dark:border-[#2A2633]">
          <div className={`bg-gradient-to-br ${banner.cls} p-10 text-center text-white`}>
            <div className="flex justify-center mb-3 opacity-90">{banner.icon}</div>
            <h2 className="text-3xl font-bold mb-1">{banner.title}</h2>
            <p className="opacity-80 text-sm">{t(uiLang, reasonKey)}</p>
          </div>

          <div className="p-6 space-y-6">
            <DuelStage
              me={duel.me} opponent={duel.opponent} maxHp={duel.maxHp}
              uiLang={uiLang} youLabel={t(uiLang, 'duelYou')}
            />

            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: t(uiLang, 'duelStatCorrect'), me: duel.me?.correct ?? 0, them: duel.opponent?.correct ?? 0 },
                { label: t(uiLang, 'duelStatWrong'), me: duel.me?.wrong ?? 0, them: duel.opponent?.wrong ?? 0 },
                { label: t(uiLang, 'duelStatDamage'), me: duel.me?.damageDealt ?? 0, them: duel.opponent?.damageDealt ?? 0 }
              ].map(row => (
                <div key={row.label} className="p-3 rounded-xl bg-zinc-50 dark:bg-[#23202B]">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">{row.label}</p>
                  <p className="font-bold text-zinc-800 dark:text-white tabular-nums">
                    {row.me} <span className="text-zinc-300 dark:text-zinc-600 font-normal">:</span> {row.them}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={onExit}
              className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition-colors"
            >
              {t(uiLang, 'duelBackToHub')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Fighting -----------------------------------------------------------

  const myIndex = duel.me?.questionIndex ?? 0;
  const outOfQuestions = !shown && duel.status === 'active';

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-3xl mx-auto w-full">
      {/* The fighters stay on screen the whole time — this is the mode's
          entire point, and the projectiles need something to fly between. */}
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-2 pb-3 bg-purple-50/90 dark:bg-[#0F0E13]/90 backdrop-blur-sm">
        <DuelStage
          ref={stage}
          me={duel.me} opponent={duel.opponent} maxHp={duel.maxHp}
          uiLang={uiLang} youLabel={t(uiLang, 'duelYou')}
        />
        <div className="flex justify-between items-center mt-2 text-[11px] text-zinc-400">
          <span>{t(uiLang, 'duelProgress').replace('{i}', String(Math.min(myIndex + 1, duel.questionCount))).replace('{n}', String(duel.questionCount))}</span>
          <button onClick={leave} className="flex items-center gap-1 font-semibold hover:text-red-500 transition-colors">
            <LogOut size={12} /> {t(uiLang, 'duelForfeit')}
          </button>
        </div>
      </div>

      {outOfQuestions ? (
        <div className="mt-16 text-center">
          <Loader2 size={28} className="animate-spin text-purple-500 mx-auto mb-4" />
          <p className="text-zinc-500 dark:text-[#9D99A8] max-w-sm mx-auto">{t(uiLang, 'duelOutOfQuestions')}</p>
        </div>
      ) : localized && (
        <div className="mt-4 bg-white dark:bg-[#18161F] rounded-2xl shadow-xl p-5 sm:p-8 border border-zinc-100 dark:border-[#2A2633]">
          {localized.category && (
            <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-800/40 text-purple-600 dark:text-purple-400 mb-3">
              {localized.category}
            </span>
          )}
          <h3 className="text-xl md:text-2xl font-bold text-zinc-800 dark:text-white mb-6 leading-snug">{localized.question}</h3>

          <div className="space-y-2.5">
            {order.map((optionIndex, position) => {
              const label = localized.options[optionIndex];
              const isPicked = feedback ? feedback.picked.includes(optionIndex) : selection.includes(optionIndex);
              const isCorrect = feedback?.correctIndexes.includes(optionIndex);

              let style = 'border-zinc-200 dark:border-[#2A2633] hover:bg-zinc-50 dark:hover:bg-[#23202B]';
              if (feedback) {
                if (isCorrect) style = 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400';
                else if (isPicked) style = 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400';
                else style = 'opacity-40 border-zinc-200 dark:border-[#2A2633]';
              } else if (isPicked) {
                style = 'border-purple-500 bg-purple-50 dark:bg-purple-900/20';
              }

              return (
                <button
                  key={optionIndex}
                  disabled={!!feedback || submitting}
                  onClick={() => localized.type === 'multiple' ? toggle(optionIndex) : submit([optionIndex])}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all font-medium flex items-center gap-3 ${style}`}
                >
                  <span className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-xs font-mono border border-zinc-200 dark:border-[#2A2633] bg-zinc-100 dark:bg-[#2A2633] text-zinc-500 dark:text-[#9D99A8]">
                    {position + 1}
                  </span>
                  {localized.type === 'multiple' && !feedback && (
                    isPicked
                      ? <CheckSquare size={20} className="text-purple-600 dark:text-purple-400 shrink-0" />
                      : <Square size={20} className="text-zinc-300 dark:text-[#4A4555] shrink-0" />
                  )}
                  <span className="flex-1 dark:text-[#EBE9F0]">{label}</span>
                  {feedback && isCorrect && <CheckCircle size={18} className="shrink-0" />}
                  {feedback && isPicked && !isCorrect && <XCircle size={18} className="shrink-0" />}
                </button>
              );
            })}
          </div>

          {!feedback && localized.type === 'multiple' && (
            <button
              onClick={() => submit(selection)}
              disabled={submitting}
              className="w-full mt-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
              {t(uiLang, 'duelSubmit')}
              <span className="text-xs bg-purple-500 px-2 py-0.5 rounded font-mono">Enter</span>
            </button>
          )}

          {!feedback && (
            <button
              onClick={() => submit([])}
              disabled={submitting}
              className="w-full mt-2.5 py-2.5 text-sm font-semibold text-zinc-500 dark:text-[#9D99A8] border border-dashed border-zinc-300 dark:border-[#3A3544] rounded-xl hover:border-purple-400 hover:text-purple-600 transition-colors flex items-center justify-center gap-2"
            >
              <HelpCircle size={15} /> {t(uiLang, 'iDontKnow')}
              <span className="text-xs bg-zinc-100 dark:bg-[#2A2633] px-2 py-0.5 rounded font-mono">0</span>
            </button>
          )}

          {feedback && (
            <div className="mt-6 pt-5 border-t border-zinc-100 dark:border-[#2A2633] flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="min-w-0">
                {feedback.correct ? (
                  <p className="font-bold text-green-600 dark:text-green-400 flex items-center gap-2">
                    <CheckCircle size={18} /> {t(uiLang, 'duelCorrect')}
                    <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-xs">
                      −{feedback.damage} HP
                    </span>
                  </p>
                ) : (
                  <p className="font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
                    <XCircle size={18} /> {t(uiLang, 'duelWrong')}
                  </p>
                )}
                {feedback.explanation && (
                  <p className="text-xs text-zinc-400 mt-2 italic max-w-md">{feedback.explanation}</p>
                )}
              </div>
              <button
                onClick={next}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold flex items-center gap-2 shrink-0 transition-colors"
              >
                {t(uiLang, 'duelNext')} <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Battle log — who hit whom, newest first */}
      <div className="mt-6 space-y-1">
        {duel.events.filter(e => e.kind === 'hit' || e.kind === 'miss').slice(0, 6).map(e => {
          const mine = e.uid === duel.me?.uid;
          const who = mine ? t(uiLang, 'duelYou') : (duel.opponent?.username || '—');
          return (
            <p key={e.id} className={`text-xs flex items-center gap-2 ${mine ? 'text-zinc-500 dark:text-[#9D99A8]' : 'text-red-500'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0" />
              {e.kind === 'hit'
                ? `${who} · −${e.damage} HP`
                : `${who} · ${t(uiLang, 'duelWrong')}`}
            </p>
          );
        })}
      </div>

      {duel.opponent && !duel.opponent.connected && (
        <p className="mt-6 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2 justify-center">
          <Wifi size={13} /> {t(uiLang, 'duelOpponentAway')}
        </p>
      )}
    </div>
  );
}
