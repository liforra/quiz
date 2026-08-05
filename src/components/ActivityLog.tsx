// The "Logbuch" view: when the user studied, meant to be shown to someone
// else as evidence. Deliberately plain and chronological — the point is that
// it reads like a record, not like a dashboard.
//
// Grouping happens here rather than in SQL because a day boundary is a
// *local* one: an 01:00 session belongs to the night it happened, and the
// stored timestamps are UTC. Doing the GROUP BY server-side would silently
// file late-evening sessions under the wrong date for anyone east of UTC.

import { useEffect, useMemo, useState } from 'react';
import { History, Download, Trash2, Play, CheckCircle, FileEdit, Clock, CalendarDays } from 'lucide-react';
import * as api from '../data';
import { t, Lang } from '../i18n';

interface ActivityLogProps {
  uiLang: Lang;
  onBack: () => void;
  // Owned by App so the sidebar/settings and this page can't disagree about
  // whether tracking is on.
  logActivity: boolean;
  setLogActivity: (on: boolean) => void;
}

const LIMIT = 500;

// 3725 -> "1h 2m", 95 -> "1m 35s". Seconds only matter for short sessions.
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const localDayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ActivityLog({ uiLang, onBack, logActivity, setLogActivity }: ActivityLogProps) {
  const [entries, setEntries] = useState<api.ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.fetchActivity(LIMIT)
      .then(({ entries, total }) => { setEntries(entries); setTotal(total); setError(''); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const locale = uiLang === 'de' ? 'de-DE' : 'en-GB';

  // One group per local day, newest first (the server already sorted
  // descending, so insertion order into the Map preserves that).
  const days = useMemo(() => {
    const byDay = new Map<string, api.ActivityEntry[]>();
    for (const e of entries) {
      const key = localDayKey(e.timestamp);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(e);
    }
    return [...byDay.entries()].map(([key, items]) => ({
      key,
      items,
      // Only finished sessions carry a duration, so "active time" is time
      // actually spent answering — an abandoned session counts as neither.
      seconds: items.reduce((sum, e) => sum + (e.durationSeconds || 0), 0),
      sessions: items.filter(e => e.kind === 'quiz_finish' || e.kind === 'exam_finish').length
    }));
  }, [entries]);

  const totals = useMemo(() => ({
    seconds: days.reduce((s, d) => s + d.seconds, 0),
    sessions: days.reduce((s, d) => s + d.sessions, 0),
    days: days.length
  }), [days]);

  const dayLabel = (key: string) => {
    const today = localDayKey(new Date().toISOString());
    if (key === today) return t(uiLang, 'logsToday');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === localDayKey(yesterday.toISOString())) return t(uiLang, 'logsYesterday');
    return new Date(key + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  };

  const kindLabel = (e: api.ActivityEntry) => {
    switch (e.kind) {
      case 'quiz_start': return `${e.title} — ${t(uiLang, 'logsStarted')}`;
      case 'quiz_finish': return `${e.title} — ${t(uiLang, 'logsFinished')}`;
      case 'exam_start': return `${e.title} — ${t(uiLang, 'logsExamStarted')}`;
      default: return `${e.title} — ${t(uiLang, 'logsExamFinished')}`;
    }
  };

  const KindIcon = ({ kind }: { kind: api.ActivityKind }) =>
    kind === 'quiz_start' ? <Play size={14} />
      : kind === 'quiz_finish' ? <CheckCircle size={14} />
        : <FileEdit size={14} />;

  const handleClear = async () => {
    if (!window.confirm(t(uiLang, 'logsClearConfirm'))) return;
    try {
      await api.clearActivity();
      setEntries([]);
      setTotal(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-zinc-800 dark:text-white flex items-center gap-2">
            <History size={22} className="text-purple-500" /> {t(uiLang, 'logs')}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-xl">{t(uiLang, 'logsIntro')}</p>
        </div>
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white text-sm font-medium">
          {t(uiLang, 'exit')}
        </button>
      </div>

      {/* Tracking switch — the opt-out lives next to what it produces, so
          turning it off doesn't mean hunting through a settings modal. */}
      <div className="bg-white dark:bg-[#18161F] rounded-2xl border border-zinc-100 dark:border-[#2A2633] p-5">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={logActivity}
            onChange={(e) => setLogActivity(e.target.checked)}
            className="mt-1 h-4 w-4 accent-purple-600"
          />
          <span>
            <span className="block text-sm font-semibold text-zinc-700 dark:text-white">{t(uiLang, 'logsTracking')}</span>
            <span className="block text-xs text-zinc-400 mt-0.5">{t(uiLang, 'logsTrackingHelp')}</span>
          </span>
        </label>
        {!logActivity && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">{t(uiLang, 'logsDisabled')}</p>
        )}
      </div>

      {/* Summary — the numbers you'd actually quote to someone */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: Clock, label: t(uiLang, 'logsTotalTime'), value: formatDuration(totals.seconds) },
          { icon: CheckCircle, label: t(uiLang, 'logsTotalSessions'), value: String(totals.sessions) },
          { icon: CalendarDays, label: t(uiLang, 'logsDaysActive'), value: String(totals.days) }
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-white dark:bg-[#18161F] rounded-2xl border border-zinc-100 dark:border-[#2A2633] p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"><Icon size={18} /></div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">{label}</div>
              <div className="text-lg font-bold text-zinc-800 dark:text-white">{value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={api.activityCsvUrl}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold transition-colors"
        >
          <Download size={16} /> {t(uiLang, 'logsExportCsv')}
        </a>
        <button
          onClick={handleClear}
          disabled={entries.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 text-sm font-bold hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 size={16} /> {t(uiLang, 'logsClear')}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-400 italic">…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-zinc-400 italic">{t(uiLang, 'logsEmpty')}</p>
      ) : (
        <div className="space-y-5">
          {days.map(day => (
            <div key={day.key} className="bg-white dark:bg-[#18161F] rounded-2xl border border-zinc-100 dark:border-[#2A2633] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 py-3 bg-zinc-50 dark:bg-[#1C1A24] border-b border-zinc-100 dark:border-[#2A2633]">
                <span className="font-bold text-sm text-zinc-800 dark:text-white">{dayLabel(day.key)}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {day.sessions} {t(uiLang, 'logsSessions')} · {t(uiLang, 'logsActiveTime')} {formatDuration(day.seconds)}
                </span>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-[#23202B]">
                {day.items.map(e => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="tabular-nums text-zinc-400 w-12 shrink-0">
                      {new Date(e.timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`shrink-0 ${e.kind.endsWith('_finish') ? 'text-green-500' : 'text-zinc-400'}`}>
                      <KindIcon kind={e.kind} />
                    </span>
                    <span className="flex-1 truncate text-zinc-700 dark:text-zinc-300">{kindLabel(e)}</span>
                    {e.total != null && e.score != null && (
                      <span className="shrink-0 text-xs font-bold text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {e.score}/{e.total}
                      </span>
                    )}
                    {e.durationSeconds != null && (
                      <span className="shrink-0 text-xs text-zinc-400 tabular-nums w-16 text-right">
                        {formatDuration(e.durationSeconds)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {total > entries.length && (
            <p className="text-xs text-zinc-400">
              {t(uiLang, 'logsShowingLast').replace('{n}', String(entries.length)).replace('{total}', String(total))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
