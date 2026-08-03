import React, { useEffect, useState, useCallback } from 'react';
import { Award, ChevronLeft, Loader2, RotateCcw, Sparkles, FileDown, CheckCircle, XCircle, Clock } from 'lucide-react';
import { t, Lang } from '../i18n';
import { Exam, ExamPart, ExamTask } from '../defaultExams';
import { ExamAnswers } from './ExamTaking';
import { checkAiStatus, gradeExamTask } from '../api';

export interface PartGrade {
  score: number;
  maxScore: number;
  reasoning: string;
  status: 'graded' | 'pending' | 'error';
}

export type ExamGrading = Record<string, PartGrade>;

function gradeObjectivePart(part: ExamPart, answer: number[] | string | undefined): PartGrade | null {
  if (part.type === 'choice') {
    const selected = new Set((answer as number[]) || []);
    const correct = new Set(part.correctIndices || []);
    const match = selected.size === correct.size && [...correct].every(i => selected.has(i));
    return { score: match ? part.points : 0, maxScore: part.points, reasoning: '', status: 'graded' };
  }
  if (part.type === 'number') {
    const value = parseFloat((answer as string) || '');
    const tolerance = part.tolerance ?? 0;
    const match = !Number.isNaN(value) && part.correctValue != null && Math.abs(value - part.correctValue) <= tolerance;
    return { score: match ? part.points : 0, maxScore: part.points, reasoning: '', status: 'graded' };
  }
  return null; // 'text' needs AI grading
}

interface ExamResultsProps {
  exam: Exam;
  answers: ExamAnswers;
  uiLang: Lang;
  onExit: () => void;
  onExportPdf: (grading: ExamGrading) => void;
}

export default function ExamResults({ exam, answers, uiLang, onExit, onExportPdf }: ExamResultsProps) {
  const [grading, setGrading] = useState<ExamGrading>(() => {
    const initial: ExamGrading = {};
    for (const task of exam.tasks) {
      for (const part of task.parts) {
        const objective = gradeObjectivePart(part, answers[part.id]);
        if (objective) initial[part.id] = objective;
      }
    }
    return initial;
  });
  const [aiEnabled, setAiEnabled] = useState(false);
  const [gradingTaskIds, setGradingTaskIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    checkAiStatus().then(s => setAiEnabled(s.enabled && !s.rateLimited));
  }, []);

  const gradeTaskWithAi = useCallback(async (task: ExamTask) => {
    const textParts = task.parts.filter(p => p.type === 'text');
    if (textParts.length === 0) return;
    setGradingTaskIds(prev => new Set(prev).add(task.number));
    setGrading(prev => {
      const next = { ...prev };
      for (const p of textParts) next[p.id] = { score: 0, maxScore: p.points, reasoning: '', status: 'pending' };
      return next;
    });
    try {
      const results = await gradeExamTask(
        textParts.map(p => ({ id: p.id, prompt: p.prompt, modelAnswer: p.modelAnswer || '', userAnswer: (answers[p.id] as string) || '', maxPoints: p.points })),
        uiLang
      );
      setGrading(prev => {
        const next = { ...prev };
        for (const r of results) next[r.id] = { score: r.score, maxScore: r.maxScore, reasoning: r.reasoning, status: 'graded' };
        return next;
      });
    } catch {
      setGrading(prev => {
        const next = { ...prev };
        for (const p of textParts) next[p.id] = { score: 0, maxScore: p.points, reasoning: '', status: 'error' };
        return next;
      });
    } finally {
      setGradingTaskIds(prev => { const next = new Set(prev); next.delete(task.number); return next; });
    }
  }, [answers, uiLang]);

  // Auto-grade every task that has text parts, once, when AI is available.
  useEffect(() => {
    if (!aiEnabled) return;
    for (const task of exam.tasks) {
      if (task.parts.some(p => p.type === 'text')) gradeTaskWithAi(task);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnabled]);

  const allParts = exam.tasks.flatMap(t => t.parts);
  const gradedParts = allParts.filter(p => grading[p.id]?.status === 'graded');
  const pendingParts = allParts.filter(p => !grading[p.id] || grading[p.id]?.status !== 'graded');
  const totalScore = gradedParts.reduce((n, p) => n + (grading[p.id]?.score || 0), 0);
  const totalMax = exam.totalPoints ?? allParts.reduce((n, p) => n + p.points, 0);
  const fullyGraded = pendingParts.length === 0;
  const percentage = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto pb-16">
      <button onClick={onExit} className="flex items-center gap-1 text-sm font-semibold text-zinc-500 dark:text-[#9D99A8] hover:text-purple-600 dark:hover:text-purple-400 mb-6">
        <ChevronLeft size={16} /> {t(uiLang, 'back')}
      </button>

      <div className="bg-white dark:bg-[#18161F] rounded-3xl shadow-xl overflow-hidden border border-zinc-100 dark:border-[#2A2633] mb-6">
        <div className="bg-purple-600 dark:bg-purple-700 p-6 sm:p-10 text-center text-white">
          <Award className="mx-auto mb-4 opacity-90" size={44} />
          <h2 className="text-3xl font-bold mb-1">
            {totalScore.toFixed(1)} / {totalMax.toFixed(2)} {t(uiLang, 'points')}
            {fullyGraded && <span className="text-purple-200 text-xl"> ({percentage}%)</span>}
          </h2>
          <p className="text-purple-200 font-medium text-sm">{exam.title}</p>
          {!fullyGraded && (
            <p className="mt-3 text-xs bg-purple-800/50 inline-flex items-center gap-1.5 px-3 py-1 rounded-full">
              <Clock size={12} /> {pendingParts.length} {t(uiLang, 'partsPendingGrading')}
            </p>
          )}
        </div>

        {!aiEnabled && pendingParts.some(p => allParts.find(ap => ap.id === p.id)?.type === 'text') && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-100 dark:border-amber-900/20 text-amber-700 dark:text-amber-400 text-sm flex items-center justify-between gap-3">
            <span>{t(uiLang, 'aiUnavailableExam')}</span>
          </div>
        )}

        <div className="p-4 sm:p-8 bg-purple-50 dark:bg-[#23202B] space-y-6">
          {exam.tasks.map(task => {
            const taskGrading = task.parts.every(p => grading[p.id]?.status === 'graded');
            const hasText = task.parts.some(p => p.type === 'text');
            const isGradingNow = gradingTaskIds.has(task.number);
            return (
              <div key={task.number} className="bg-white dark:bg-[#18161F] rounded-xl border border-zinc-200 dark:border-[#2A2633] shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-[#2A2633]">
                  <h3 className="font-bold text-sm text-zinc-800 dark:text-white">{task.title}</h3>
                  <div className="flex items-center gap-2">
                    {hasText && !taskGrading && !isGradingNow && (
                      <button
                        onClick={() => gradeTaskWithAi(task)}
                        className="flex items-center gap-1 text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:underline"
                      >
                        <Sparkles size={12} /> {t(uiLang, 'gradeWithAi')}
                      </button>
                    )}
                    {isGradingNow && <Loader2 size={14} className="animate-spin text-purple-500" />}
                    <span className="text-xs font-semibold text-zinc-400">
                      {task.parts.reduce((n, p) => n + (grading[p.id]?.score || 0), 0).toFixed(1)} / {task.points.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-[#2A2633]">
                  {task.parts.map(part => {
                    const g = grading[part.id];
                    const userAnswer = part.type === 'choice'
                      ? ((answers[part.id] as number[]) || []).map(i => part.options?.[i]).join(', ') || t(uiLang, 'skipped')
                      : ((answers[part.id] as string) || t(uiLang, 'skipped'));
                    return (
                      <div key={part.id} className="px-4 py-3 flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">
                          {g?.status === 'graded' ? (
                            g.score >= g.maxScore * 0.999 ? <CheckCircle size={16} className="text-green-500" /> :
                            g.score <= 0 ? <XCircle size={16} className="text-red-500" /> : <Award size={16} className="text-amber-500" />
                          ) : g?.status === 'error' ? <XCircle size={16} className="text-zinc-400" /> : <Clock size={16} className="text-zinc-300" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{part.label && <span className="text-purple-500 mr-1">{part.label}</span>}{part.prompt}</p>
                          <p className="text-xs text-zinc-500 mt-1 whitespace-pre-line">{userAnswer}</p>
                          {g?.reasoning && <p className="text-[11px] text-zinc-400 mt-1 italic">{g.reasoning}</p>}
                        </div>
                        <span className="text-xs font-bold text-zinc-500 shrink-0">
                          {g?.status === 'graded' ? `${g.score.toFixed(1)}/${g.maxScore.toFixed(2)}` : `–/${part.points.toFixed(2)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-6 bg-white dark:bg-[#18161F] border-t border-zinc-100 dark:border-[#2A2633] flex flex-wrap justify-center gap-3">
          <button onClick={onExit} className="flex items-center gap-2 px-8 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-colors">
            <RotateCcw size={18} /> {t(uiLang, 'backToDashboard')}
          </button>
          <button onClick={() => onExportPdf(grading)} className="flex items-center gap-2 px-8 py-3 bg-zinc-100 dark:bg-[#23202B] text-zinc-700 dark:text-white rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-[#2A2633] transition-colors">
            <FileDown size={18} /> {t(uiLang, 'exportPdf')}
          </button>
        </div>
      </div>
    </div>
  );
}
