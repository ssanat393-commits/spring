interface GaugeRingProps {
  label: string;
  value: number;
  detail: string;
  warningThreshold?: number;
  criticalThreshold?: number;
  invertThresholds?: boolean;
}

export function GaugeRing({
  label,
  value,
  detail,
  warningThreshold = 80,
  criticalThreshold = 90,
  invertThresholds = false,
}: GaugeRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  let strokeColor = '#22D3EE';
  let statusText = invertThresholds ? 'Healthy' : 'Nominal';
  let statusClass = 'text-cyan-600 dark:text-cyan-400';

  if (invertThresholds) {
    if (clamped <= criticalThreshold) {
      strokeColor = '#EF4444';
      statusText = 'Critical';
      statusClass = 'text-red-600 dark:text-red-400';
    } else if (clamped <= warningThreshold) {
      strokeColor = '#F59E0B';
      statusText = 'Degraded';
      statusClass = 'text-amber-600 dark:text-amber-400';
    }
  } else if (clamped >= criticalThreshold) {
    strokeColor = '#EF4444';
    statusText = 'Critical';
    statusClass = 'text-red-600 dark:text-red-400';
  } else if (clamped >= warningThreshold) {
    strokeColor = '#F59E0B';
    statusText = 'Elevated';
    statusClass = 'text-amber-600 dark:text-amber-400';
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4 flex items-center gap-4">
      <div className="relative w-22 h-22 shrink-0 flex items-center justify-center">
        <svg className="w-22 h-22 -rotate-90" viewBox="0 0 96 96" aria-hidden="true">
          <circle
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            stroke="currentColor"
            className="text-slate-200 dark:text-slate-800"
            strokeWidth="7"
          />
          <circle
            cx="48"
            cy="48"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 220ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </svg>
        <span className="absolute text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {clamped.toFixed(0)}%
        </span>
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
        <div className={`text-sm font-semibold mt-0.5 ${statusClass}`}>{statusText}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate font-mono tabular-nums">
          {detail}
        </div>
      </div>
    </div>
  );
}
