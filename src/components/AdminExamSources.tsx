import React, { useEffect, useState } from 'react';
import { ChevronLeft, Folder, FileText, Check, X } from 'lucide-react';
import { t, Lang } from '../i18n';
import { Exam } from '../defaultExams';
import { BrowseEntry, browsePruefungen, listExamSources, setExamSource, clearExamSource } from '../api';

interface AdminExamSourcesProps {
  exams: Exam[];
  uiLang: Lang;
  onBack: () => void;
}

// Lets you assign, per digitized exam, which real PDF in the private
// Prüfungen/ archive (symlinked at the repo root) is the "source of truth"
// for that exam — the export pipeline overlays answers onto this exact file.
// Personal tooling, not exposed in the main nav.
export default function AdminExamSources({ exams, uiLang, onBack }: AdminExamSourcesProps) {
  const [sources, setSources] = useState<Record<string, string | null>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [dir, setDir] = useState('.');
  const [items, setItems] = useState<BrowseEntry[]>([]);
  const [error, setError] = useState('');

  const refreshSources = () => listExamSources().then(setSources).catch(() => {});
  useEffect(() => { refreshSources(); }, []);

  useEffect(() => {
    if (pickerFor == null) return;
    browsePruefungen(dir).then(res => { setDir(res.dir); setItems(res.items); setError(''); }).catch(e => setError(e.message));
  }, [pickerFor, dir]);

  const openPicker = (examId: string) => { setPickerFor(examId); setDir('.'); };

  const choosePdf = async (name: string) => {
    if (!pickerFor) return;
    const relativePath = dir === '.' ? name : `${dir}/${name}`;
    try {
      await setExamSource(pickerFor, relativePath);
      setPickerFor(null);
      refreshSources();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-zinc-500 dark:text-[#9D99A8] hover:text-purple-600 dark:hover:text-purple-400 mb-6">
        <ChevronLeft size={16} /> {t(uiLang, 'back')}
      </button>

      <h1 className="text-xl font-bold text-zinc-900 dark:text-white mb-1">Exam source PDFs</h1>
      <p className="text-sm text-zinc-400 mb-6">Link each digitized exam to the real PDF it was transcribed from, so the export pipeline can write answers onto the actual paper.</p>

      <div className="space-y-2">
        {exams.map(exam => {
          const source = sources[exam.id];
          return (
            <div key={exam.id} className="flex items-center gap-3 p-3 bg-white dark:bg-[#18161F] rounded-xl border border-zinc-100 dark:border-[#2A2633]">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-zinc-800 dark:text-white truncate">{exam.title}</p>
                <p className={`text-xs truncate ${source ? 'text-green-600 dark:text-green-400' : 'text-zinc-400 italic'}`}>
                  {source || 'No source PDF linked'}
                </p>
              </div>
              {source && (
                <button onClick={() => clearExamSource(exam.id).then(refreshSources)} className="p-1.5 text-zinc-400 hover:text-red-500" title="Unlink">
                  <X size={16} />
                </button>
              )}
              <button
                onClick={() => openPicker(exam.id)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-300 hover:bg-purple-100"
              >
                {source ? 'Change' : 'Link'}
              </button>
            </div>
          );
        })}
      </div>

      {pickerFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setPickerFor(null)}>
          <div className="bg-white dark:bg-[#18161F] rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-100 dark:border-[#2A2633]">
              <p className="font-bold text-sm text-zinc-800 dark:text-white">Choose source PDF</p>
              <p className="text-xs text-zinc-400 font-mono truncate">Prüfungen/{dir === '.' ? '' : dir}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {error && <p className="text-xs text-red-500 p-2">{error}</p>}
              {dir !== '.' && (
                <button onClick={() => setDir(dir.split('/').slice(0, -1).join('/') || '.')} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-[#23202B] text-sm text-zinc-500">
                  <Folder size={16} /> ..
                </button>
              )}
              {items.map(item => (
                <button
                  key={item.name}
                  onClick={() => (item.isDirectory ? setDir(dir === '.' ? item.name : `${dir}/${item.name}`) : choosePdf(item.name))}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-[#23202B] text-sm text-zinc-700 dark:text-zinc-200 text-left"
                >
                  {item.isDirectory ? <Folder size={16} className="text-purple-400 shrink-0" /> : <FileText size={16} className="text-zinc-400 shrink-0" />}
                  <span className="truncate">{item.name}</span>
                  {item.isPdf && <Check size={14} className="text-green-500 ml-auto shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
