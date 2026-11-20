import { useState } from 'react';
import { formatTimeShort } from '../../utils/format';

export interface TelemetrySeries {
  id: string;
  label: string;
  color: string;
  values: number[];
}

interface TelemetryChartProps {
  title: string;
  subtitle?: string;
  timestamps: string[];
  series: TelemetrySeries[];
  unit?: string;
  maxValue?: number;
  height?: number;
}

export function TelemetryChart({
  title,
  subtitle,
  timestamps,
  series,
  unit = '%',
  maxValue,
  height = 220,
}: TelemetryChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 680;
  const padLeft = 44;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allValues = series.flatMap((s) => s.values);
  const computedMax = maxValue ?? Math.max(100, ...allValues, 10);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(r * computedMax));
  const count = Math.max(2, timestamps.length);

  const xAt = (idx: number) => padLeft + (idx / Math.max(1, count - 1)) * plotW;
  const yAt = (val: number) =>
    padTop + plotH - (Math.max(0, Math.min(computedMax, val)) / computedMax) * plotH;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {series.map((s) => {
            const latest =
              hoverIdx !== null && s.values[hoverIdx] !== undefined
                ? s.values[hoverIdx]
                : s.values[s.values.length - 1];
            return (
              <div key={s.id} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                <span>{s.label}</span>
                <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {latest !== undefined ? `${latest.toFixed(1)}${unit}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {timestamps.length < 2 ? (
        <div
          className="flex items-center justify-center text-xs text-slate-500 dark:text-slate-400"
          style={{ height }}
        >
          Waiting for at least two telemetry samples to render chart.
        </div>
      ) : (
        <div className="relative w-full">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto overflow-visible select-none"
            role="img"
            aria-label={title}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <defs>
              {series.map((s) => (
                <linearGradient key={s.id} id={`grad-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0.0" />
                </linearGradient>
              ))}
            </defs>

            {yTicks.map((tick) => {
              const y = yAt(tick);
              return (
                <g key={tick}>
                  <line
                    x1={padLeft}
                    x2={width - padRight}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800/80"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono tabular-nums"
                  >
                    {tick}
                    {unit === '%' ? '%' : ''}
                  </text>
                </g>
              );
            })}

            {series.map((s) => {
              if (s.values.length < 2) return null;
              const pts = s.values.map((v, idx) => `${xAt(idx).toFixed(1)},${yAt(v).toFixed(1)}`);
              const linePath = `M ${pts.join(' L ')}`;
              const areaPath = `${linePath} L ${xAt(s.values.length - 1).toFixed(1)},${(
                padTop + plotH
              ).toFixed(1)} L ${xAt(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

              return (
                <g key={s.id}>
                  <path d={areaPath} fill={`url(#grad-${s.id})`} />
                  <path
                    d={linePath}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

            {hoverIdx !== null && timestamps[hoverIdx] && (
              <g>
                <line
                  x1={xAt(hoverIdx)}
                  x2={xAt(hoverIdx)}
                  y1={padTop}
                  y2={padTop + plotH}
                  stroke="#38BDF8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                {series.map((s) => {
                  const val = s.values[hoverIdx];
                  if (val === undefined) return null;
                  return (
                    <circle
                      key={s.id}
                      cx={xAt(hoverIdx)}
                      cy={yAt(val)}
                      r="3.5"
                      fill={s.color}
                      stroke="#070B14"
                      strokeWidth="1.5"
                    />
                  );
                })}
              </g>
            )}

            {/* Invisible hover columns for crisp crosshair interaction */}
            {timestamps.map((_, idx) => {
              const colW = plotW / count;
              return (
                <rect
                  key={idx}
                  x={xAt(idx) - colW / 2}
                  y={padTop}
                  width={Math.max(4, colW)}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(idx)}
                />
              );
            })}

            {Array.from(
              new Set([0, Math.floor((timestamps.length - 1) / 2), timestamps.length - 1])
            ).map((idx) => (
              <text
                key={`tick-${idx}`}
                x={xAt(idx)}
                y={height - 6}
                textAnchor={
                  timestamps.length <= 1
                    ? 'start'
                    : idx === 0
                      ? 'start'
                      : idx === timestamps.length - 1
                        ? 'end'
                        : 'middle'
                }
                className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono tabular-nums"
              >
                {formatTimeShort(timestamps[idx])}
              </text>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
