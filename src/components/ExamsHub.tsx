import React from 'react';
import { FileText, ChevronRight, ChevronLeft, Timer, Settings } from 'lucide-react';
import { t, Lang } from '../i18n';
import { Exam } from '../defaultExams';

interface ExamsHubProps {
  exams: Exam[];
  uiLang: Lang;
  activeMode: string | null;
  onStart: (exam: Exam) => void;
  onBack: () => void;
  onManageSources?: () => void;
}

export default function ExamsHub({ exams, uiLang, activeMode, onStart, onBack, onManageSources }: ExamsHubProps) {
  const filtered = exams
    .filter(e => activeMode == null || e.examPart === activeMode)
    .sort((a, b) => (b.period.year - a.period.year) || a.profession.localeCompare(b.profession));

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-zinc-500 dark:text-[#9D99A8] hover:text-purple-600 dark:hover:text-purple-400 mb-6">
        <ChevronLeft size={16} /> {t(uiLang, 'back')}
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20 shrink-0">
          <FileText size={26} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{t(uiLang, 'apExams')}</h1>
          <p className="text-sm text-zinc-400">{t(uiLang, 'apExamsDesc')}</p>
        </div>
        {onManageSources && (
          <button onClick={onManageSources} className="p-2 rounded-lg text-zinc-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20" title="Manage source PDFs">
            <Settings size={20} />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-400 italic text-center py-16">{t(uiLang, 'noExamsInMode')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map(exam => (
            <button
              key={exam.id}
              onClick={() => onStart(exam)}
              className="group flex items-start gap-4 p-5 bg-white dark:bg-[#18161F] rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633] hover:border-purple-500 dark:hover:border-purple-400 hover:shadow-md transition-all text-left"
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">
                <FileText size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-zinc-800 dark:text-white truncate">{exam.title}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] font-semibold">
                  <span className="px-2 py-0.5 rounded-full border border-purple-200 text-purple-600 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300">
                    {exam.examPart.toUpperCase()}
                  </span>
                  <span className="px-2 py-0.5 rounded-full border border-zinc-200 text-zinc-500 bg-zinc-50 dark:border-[#2A2633] dark:bg-[#23202B] dark:text-zinc-400">
                    {exam.profession}
                  </span>
                  <span className="flex items-center gap-1 text-zinc-400">
                    <Timer size={12} /> {exam.durationMinutes} min
                  </span>
                  <span className="text-zinc-400">{exam.totalPoints ?? exam.tasks.reduce((n, tk) => n + tk.points, 0)} {t(uiLang, 'totalPoints')}</span>
                </div>
              </div>
              <ChevronRight size={18} className="text-zinc-300 dark:text-zinc-600 group-hover:text-purple-500 transition-colors shrink-0 mt-1" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
