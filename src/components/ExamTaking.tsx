import React, { useState } from 'react';
import { ChevronLeft, Send, ExternalLink } from 'lucide-react';
import { t, Lang } from '../i18n';
import { Exam, ExamPart, ExternalReference } from '../defaultExams';

// Links to background/explainer material (e.g. a chmod permissions primer,
// a syntax-rules appendix) at its exact page in the real source PDF, instead
// of transcribing it — see ExternalReference in src/exams/types.ts.
function ExternalReferenceLink({ examId, reference }: { examId: string; reference: ExternalReference }) {
  return (
    <a
      href={`/exam-sources/${examId}.pdf#page=${reference.page}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline mb-3"
    >
      <ExternalLink size={13} />
      {reference.label || `Open reference material (PDF, page ${reference.page})`}
    </a>
  );
}

// Answer shapes per part.type: 'choice' -> number[] (selected option indices),
// 'number' -> string (raw input, parsed on submit), 'text' -> string.
export type ExamAnswers = Record<string, number[] | string>;

interface ExamTakingProps {
  exam: Exam;
  uiLang: Lang;
  onSubmit: (answers: ExamAnswers) => void;
  onExit: () => void;
}

function isAnswered(part: ExamPart, value: number[] | string | undefined): boolean {
  if (part.type === 'choice') return Array.isArray(value) && value.length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

export default function ExamTaking({ exam, uiLang, onSubmit, onExit }: ExamTakingProps) {
  const [answers, setAnswers] = useState<ExamAnswers>({});

  const allParts = exam.tasks.flatMap(task => task.parts);
  const answeredCount = allParts.filter(p => isAnswered(p, answers[p.id])).length;

  const setChoice = (part: ExamPart, index: number) => {
    const pickCount = part.pickCount || 1;
    setAnswers(prev => {
      const current = (prev[part.id] as number[]) || [];
      if (pickCount === 1) return { ...prev, [part.id]: [index] };
      const next = current.includes(index) ? current.filter(i => i !== index) : [...current, index];
      return { ...prev, [part.id]: next.slice(-pickCount) };
    });
  };

  const setText = (part: ExamPart, value: string) => {
    setAnswers(prev => ({ ...prev, [part.id]: value }));
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto pb-32">
      <div className="sticky top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 py-3 mb-6 bg-zinc-50/95 dark:bg-[#0F0E13]/95 backdrop-blur border-b border-zinc-200 dark:border-[#2A2633]">
        <div className="flex items-center justify-between gap-4">
          <button onClick={onExit} className="flex items-center gap-1 text-sm font-semibold text-zinc-500 dark:text-[#9D99A8] hover:text-red-500 shrink-0">
            <ChevronLeft size={16} /> {t(uiLang, 'exit')}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-800 dark:text-white truncate text-right">{exam.title}</p>
            <p className="text-[11px] text-zinc-400 text-right">{answeredCount} / {allParts.length} {t(uiLang, 'partsAnswered')}</p>
          </div>
        </div>
        <div className="w-full bg-purple-200 dark:bg-[#23202B] h-1.5 rounded-full mt-2 overflow-hidden">
          <div className="bg-purple-600 dark:bg-purple-500 h-full transition-all duration-300 ease-out" style={{ width: `${(answeredCount / Math.max(1, allParts.length)) * 100}%` }} />
        </div>
      </div>

      <div className="space-y-8">
        {exam.tasks.map(task => (
          <div key={task.number} className="bg-white dark:bg-[#18161F] rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633] p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h2 className="text-lg font-bold text-zinc-800 dark:text-white">{task.title}</h2>
              <span className="text-xs font-semibold text-zinc-400 shrink-0">{task.points} {t(uiLang, 'points')}</span>
            </div>
            {task.intro && (
              <p className="text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-line mb-4 bg-zinc-50 dark:bg-[#23202B] rounded-xl p-3">{task.intro}</p>
            )}
            {task.externalReference && (
              <div><ExternalReferenceLink examId={exam.id} reference={task.externalReference} /></div>
            )}
            {task.referenceImage && (
              <img src={task.referenceImage} alt="" className="max-w-full rounded-xl border border-zinc-200 dark:border-[#2A2633] mb-4" />
            )}
            {task.referenceTable && (
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      {task.referenceTable.headers.map((h, i) => (
                        <th key={i} className="border border-zinc-200 dark:border-[#2A2633] bg-zinc-50 dark:bg-[#23202B] px-2 py-1.5 text-left font-semibold text-zinc-600 dark:text-zinc-300">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {task.referenceTable.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="border border-zinc-200 dark:border-[#2A2633] px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="space-y-5">
              {task.parts.map(part => (
                <div key={part.id}>
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                      {part.label && <span className="text-purple-600 dark:text-purple-400 mr-1">{part.label}</span>}
                      {part.prompt}
                    </p>
                    <span className="text-[11px] text-zinc-400 shrink-0">{part.points} {t(uiLang, 'points')}</span>
                  </div>
                  {part.externalReference && (
                    <div><ExternalReferenceLink examId={exam.id} reference={part.externalReference} /></div>
                  )}
                  {part.referenceImage && (
                    <img src={part.referenceImage} alt="" className="max-w-full rounded-xl border border-zinc-200 dark:border-[#2A2633] mb-3" />
                  )}

                  {part.type === 'choice' && (
                    <div className="space-y-1.5">
                      {(part.pickCount || 1) > 1 && (
                        <p className="text-[11px] text-purple-500 font-semibold mb-1">{t(uiLang, 'pickN').replace('{n}', String(part.pickCount))}</p>
                      )}
                      {part.options?.map((opt, i) => {
                        const selected = ((answers[part.id] as number[]) || []).includes(i);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setChoice(part, i)}
                            className={`w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                              selected
                                ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300'
                                : 'border-zinc-200 dark:border-[#2A2633] text-zinc-600 dark:text-zinc-300 hover:border-purple-300'
                            }`}
                          >
                            <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 ${selected ? 'border-purple-500 bg-purple-500 text-white' : 'border-zinc-300 dark:border-zinc-600 text-zinc-400'}`}>
                              {i + 1}
                            </span>
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {part.type === 'number' && (
                    <input
                      type="number"
                      value={(answers[part.id] as string) ?? ''}
                      onChange={e => setText(part, e.target.value)}
                      className="w-40 px-3 py-2 rounded-lg border border-zinc-200 dark:border-[#2A2633] bg-white dark:bg-[#0F0E13] text-sm text-zinc-800 dark:text-white focus:border-purple-500 outline-none"
                    />
                  )}

                  {part.type === 'text' && (
                    <textarea
                      value={(answers[part.id] as string) ?? ''}
                      onChange={e => setText(part, e.target.value)}
                      rows={4}
                      placeholder={t(uiLang, 'typeYourAnswer')}
                      className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-[#2A2633] bg-white dark:bg-[#0F0E13] text-sm text-zinc-800 dark:text-white focus:border-purple-500 outline-none resize-y"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 md:left-64 z-20 p-4 bg-gradient-to-t from-zinc-50 dark:from-[#0F0E13] via-zinc-50/95 dark:via-[#0F0E13]/95 to-transparent">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => onSubmit(answers)}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold shadow-xl shadow-purple-500/20 transition-colors"
          >
            <Send size={18} /> {t(uiLang, 'submitExam')}
          </button>
        </div>
      </div>
    </div>
  );
}
