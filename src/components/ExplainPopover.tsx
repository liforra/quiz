import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, Lightbulb } from 'lucide-react';
import { explainAnswer } from '../api';
import { t, Lang } from '../i18n';

interface ExplainContext {
  id: string;
  question: string;
  options?: any;
  correctAnswer: any;
  userAnswer: any;
  wasCorrect: boolean;
}

interface ExplainPopoverProps {
  context: ExplainContext | null;
  onClose: () => void;
  uiLang: Lang;
  onAiError?: (e: any) => boolean;
}

export default function ExplainPopover({ context, onClose, uiLang, onAiError }: ExplainPopoverProps) {
  // Cached per question id so reopening within the session doesn't refire the request.
  const cache = useRef<Map<string, string>>(new Map());
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!context) return;
    const cached = cache.current.get(context.id);
    if (cached) {
      setText(cached);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    setText('');
    explainAnswer(context.question, context.options, context.correctAnswer, context.userAnswer, context.wasCorrect, uiLang)
      .then(result => {
        cache.current.set(context.id, result);
        setText(result);
      })
      .catch(e => {
        onAiError?.(e);
        setError(t(uiLang, 'explainUnavailable'));
      })
      .finally(() => setLoading(false));
  }, [context?.id]);

  if (!context) return null;

  return (
    <div className="absolute top-10 right-0 z-30 w-72 max-w-[calc(100vw-2.5rem)] bg-white dark:bg-[#18161F] rounded-xl shadow-2xl border border-zinc-200 dark:border-[#2A2633] p-4 animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wide">
          <Lightbulb size={14} /> {t(uiLang, 'explanation')}
        </div>
        <button onClick={onClose}><X size={14} className="text-zinc-400 hover:text-zinc-600" /></button>
      </div>
      {loading && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 size={14} className="animate-spin" /> {t(uiLang, 'thinking')}</div>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!loading && !error && <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{text}</p>}
    </div>
  );
}
