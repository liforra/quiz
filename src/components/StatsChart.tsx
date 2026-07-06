import React, { useMemo, useState } from 'react';
import { DayBucket } from '../stats';
import { t, Lang } from '../i18n';

interface StatsChartProps {
  points: DayBucket[];
  label: string;
  uiLang: Lang;
}

const WIDTH = 600;
const HEIGHT = 200;
const PAD_LEFT = 34;
const PAD_RIGHT = 44;
const PAD_TOP = 16;
const PAD_BOTTOM = 26;

export default function StatsChart({ points, label, uiLang }: StatsChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const series = useMemo(() => points.map(p => ({
    ...p,
    total: p.correct + p.wrong,
    pct: p.correct / (p.correct + p.wrong || 1) * 100
  })), [points]);

  if (series.length < 2) {
    return (
      <div className="p-6 bg-zinc-50 dark:bg-[#1C1A24] rounded-xl border border-dashed border-zinc-200 dark:border-[#2A2633] text-center">
        <p className="text-sm text-zinc-400">{t(uiLang, 'keepPracticingForTrend')}</p>
      </div>
    );
  }

  const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xAt = (i: number) => PAD_LEFT + (i / (series.length - 1)) * innerW;
  const yAt = (pct: number) => PAD_TOP + innerH - (pct / 100) * innerH;

  const linePath = series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.pct)}`).join(' ');
  const areaPath = `${linePath} L ${xAt(series.length - 1)} ${PAD_TOP + innerH} L ${xAt(0)} ${PAD_TOP + innerH} Z`;

  const last = series[series.length - 1];
  const hovered = hoverIndex != null ? series[hoverIndex] : null;

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, (relX - PAD_LEFT) / innerW));
    const idx = Math.round(ratio * (series.length - 1));
    setHoverIndex(idx);
  };

  return (
    <div className="relative">
      <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 mb-2">{label}</p>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label={label}>
        {/* Gridlines: 0/50/100% */}
        {[0, 50, 100].map(pct => (
          <g key={pct}>
            <line
              x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yAt(pct)} y2={yAt(pct)}
              className="stroke-zinc-200 dark:stroke-zinc-700"
              strokeWidth={1}
            />
            <text x={4} y={yAt(pct) + 3} className="fill-zinc-400 dark:fill-zinc-500" fontSize={9}>
              {pct}%
            </text>
          </g>
        ))}

        {/* Area wash + line */}
        <path d={areaPath} className="fill-purple-600/10 dark:fill-purple-400/10" stroke="none" />
        <path d={linePath} className="stroke-purple-600 dark:stroke-purple-400" strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />

        {/* Endpoint marker + direct label */}
        <circle cx={xAt(series.length - 1)} cy={yAt(last.pct)} r={4} className="fill-purple-600 dark:fill-purple-400 stroke-white dark:stroke-[#18161F]" strokeWidth={2} />
        <text x={xAt(series.length - 1) + 6} y={yAt(last.pct) - 6} className="fill-zinc-700 dark:fill-zinc-200 font-bold" fontSize={11} textAnchor="start">
          {Math.round(last.pct)}%
        </text>

        {/* X-axis endpoints */}
        <text x={xAt(0)} y={HEIGHT - 6} className="fill-zinc-400 dark:fill-zinc-500" fontSize={9} textAnchor="start">{series[0].date}</text>
        <text x={xAt(series.length - 1)} y={HEIGHT - 6} className="fill-zinc-400 dark:fill-zinc-500" fontSize={9} textAnchor="end">{last.date}</text>

        {/* Crosshair */}
        {hovered && (
          <line x1={xAt(hoverIndex!)} x2={xAt(hoverIndex!)} y1={PAD_TOP} y2={PAD_TOP + innerH} className="stroke-zinc-300 dark:stroke-zinc-600" strokeWidth={1} />
        )}
        {hovered && (
          <circle cx={xAt(hoverIndex!)} cy={yAt(hovered.pct)} r={4} className="fill-purple-600 dark:fill-purple-400 stroke-white dark:stroke-[#18161F]" strokeWidth={2} />
        )}

        {/* Hover hit area */}
        <rect
          x={PAD_LEFT} y={0} width={innerW} height={HEIGHT}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        />
      </svg>

      {hovered && (
        <div
          className="absolute pointer-events-none bg-white dark:bg-[#18161F] border border-zinc-200 dark:border-[#2A2633] rounded-lg shadow-lg px-3 py-2 text-xs"
          style={{
            left: `${(xAt(hoverIndex!) / WIDTH) * 100}%`,
            top: 0,
            transform: 'translate(-50%, -110%)'
          }}
        >
          <p className="font-bold text-zinc-800 dark:text-white">{Math.round(hovered.pct)}%</p>
          <p className="text-zinc-400">{hovered.date} · {hovered.total} {t(uiLang, 'attempts')}</p>
        </div>
      )}
    </div>
  );
}
