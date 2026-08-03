import React, { useState, useEffect, useRef } from 'react';
import { X, Send, MessageCircle, Loader2 } from 'lucide-react';
import { askHelp, ChatMessage } from '../api';
import { t, Lang } from '../i18n';

interface HelpChatProps {
  question: { id: string; question: string; options?: any } | null;
  onClose: () => void;
  uiLang: Lang;
  onAiError?: (e: any) => boolean;
  onAiUsage?: (totalTokens: number) => void;
}

export default function HelpChat({ question, onClose, uiLang, onAiError, onAiUsage }: HelpChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fresh conversation whenever the scoped question changes.
  useEffect(() => {
    setMessages([]);
    setInput('');
  }, [question?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  if (!question) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const result = await askHelp(question.question, question.options, next, uiLang);
      setMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
      onAiUsage?.(result.usage?.totalTokens);
    } catch (e) {
      onAiError?.(e);
      setMessages(prev => [...prev, { role: 'assistant', content: t(uiLang, 'helpUnavailable') }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[340px] max-w-[calc(100vw-3rem)] h-[440px] max-h-[calc(100vh-6rem)] bg-white dark:bg-[#18161F] rounded-2xl shadow-2xl border border-zinc-200 dark:border-[#2A2633] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-[#2A2633] bg-purple-600 text-white shrink-0">
        <div className="flex items-center gap-2 font-bold text-sm">
          <MessageCircle size={16} /> {t(uiLang, 'askForHelp')}
        </div>
        <button onClick={onClose}><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-[#23202B] p-2 rounded-lg">
          {t(uiLang, 'helpIntro')}
        </div>
        {messages.map((m, i) => (
          <div key={i} className={`text-sm px-3 py-2 rounded-xl max-w-[85%] ${m.role === 'user' ? 'ml-auto bg-purple-600 text-white' : 'bg-zinc-100 dark:bg-[#23202B] text-zinc-700 dark:text-zinc-300'}`}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 size={14} className="animate-spin" /> {t(uiLang, 'thinking')}</div>
        )}
      </div>

      <div className="p-3 border-t border-zinc-100 dark:border-[#2A2633] flex items-center gap-2 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder={t(uiLang, 'askAQuestion')}
          className="flex-1 px-3 py-2 text-sm bg-zinc-50 dark:bg-[#23202B] border border-zinc-200 dark:border-[#2A2633] rounded-lg outline-none focus:ring-2 focus:ring-purple-500 dark:text-white"
        />
        <button onClick={send} disabled={loading || !input.trim()} className="p-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-lg transition-colors">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
