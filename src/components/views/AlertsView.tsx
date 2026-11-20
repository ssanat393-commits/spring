import { useState } from 'react';
import type { AlertIncident, AlertSeverity, AlertStatus, AlertThresholds } from '../../../shared/types';
import { formatDateTime } from '../../utils/format';

interface AlertsViewProps {
  alerts: AlertIncident[];
  thresholds: AlertThresholds;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
  onOpenSettings: () => void;
}

export function AlertsView({
  alerts,
  thresholds,
  onAcknowledge,
  onResolve,
  onDismiss,
  onOpenSettings,
}: AlertsViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | AlertStatus>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | AlertSeverity>('all');

  const filtered = alerts.filter((a) => {
    const matchStatus = statusFilter === 'all' || a.status === statusFilter;
    const matchSev = severityFilter === 'all' || a.severity === severityFilter;
    return matchStatus && matchSev;
  });

  const countBySeverity = (sev: AlertSeverity) =>
    alerts.filter((a) => a.severity === sev && (a.status === 'open' || a.status === 'acknowledged')).length;

  return (
    <div className="space-y-6">
      {/* Severity Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(
          [
            { sev: 'critical', label: 'Critical Active', color: 'text-red-600 dark:text-red-400' },
            { sev: 'high', label: 'High Active', color: 'text-amber-600 dark:text-amber-400' },
            { sev: 'medium', label: 'Medium Active', color: 'text-cyan-600 dark:text-cyan-400' },
            { sev: 'low', label: 'Low Active', color: 'text-slate-600 dark:text-slate-300' },
          ] as const
        ).map((item) => (
          <button
            key={item.sev}
            type="button"
            onClick={() => setSeverityFilter(severityFilter === item.sev ? 'all' : item.sev)}
            className={`text-left rounded-xl border p-4 transition-colors ${
              severityFilter === item.sev
                ? 'border-cyan-500/50 bg-cyan-500/8'
                : 'border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424]'
            }`}
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">{item.label}</div>
            <div className={`text-2xl font-display font-bold tabular-nums mt-1 ${item.color}`}>
              {countBySeverity(item.sev)}
            </div>
          </button>
        ))}
      </div>

      {/* Filters & Threshold Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/70">
            {(['all', 'open', 'acknowledged', 'resolved', 'dismissed'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                  statusFilter === st
                    ? 'bg-white dark:bg-[#0D1424] text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono tabular-nums">
            Thresholds: CPU {thresholds.cpuWarning}%/{thresholds.cpuCritical}% · RAM{' '}
            {thresholds.ramWarning}%/{thresholds.ramCritical}% · Disk {thresholds.diskWarning}%/
            {thresholds.diskCritical}%
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-cyan-600 dark:text-cyan-400 font-semibold hover:underline whitespace-nowrap"
          >
            Configure Thresholds
          </button>
        </div>
      </div>

      {/* Alerts & Incidents Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Severity</th>
                <th className="py-3 px-3 font-medium">Incident</th>
                <th className="py-3 px-3 font-medium">Observed / Limit</th>
                <th className="py-3 px-3 font-medium">Status</th>
                <th className="py-3 px-3 font-medium">Timestamps</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filtered.map((alert) => (
                <tr key={alert.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/35">
                  <td className="py-3 px-4 uppercase font-mono font-semibold">
                    <span
                      className={
                        alert.severity === 'critical'
                          ? 'text-red-600 dark:text-red-400'
                          : alert.severity === 'high'
                            ? 'text-amber-600 dark:text-amber-400'
                            : alert.severity === 'medium'
                              ? 'text-cyan-600 dark:text-cyan-400'
                              : 'text-slate-500 dark:text-slate-400'
                      }
                    >
                      {alert.severity}
                    </span>
                  </td>
                  <td className="py-3 px-3 max-w-md">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {alert.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {alert.description} · {alert.isDemo ? 'DEMO DATA' : 'Live Host'}
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {alert.observedValue} / {alert.thresholdValue}
                  </td>
                  <td className="py-3 px-3 capitalize font-medium text-slate-800 dark:text-slate-200">
                    {alert.status}
                  </td>
                  <td className="py-3 px-3 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                    <div>Opened: {formatDateTime(alert.createdAt)}</div>
                    {alert.acknowledgedAt && <div>Ack: {formatDateTime(alert.acknowledgedAt)}</div>}
                    {alert.resolvedAt && <div>Resolved: {formatDateTime(alert.resolvedAt)}</div>}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                    {alert.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => onAcknowledge(alert.id)}
                        className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium"
                      >
                        Acknowledge
                      </button>
                    )}
                    {(alert.status === 'open' || alert.status === 'acknowledged') && (
                      <>
                        <button
                          type="button"
                          onClick={() => onResolve(alert.id)}
                          className="px-2.5 py-1 rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 font-medium"
                        >
                          Resolve
                        </button>
                        <button
                          type="button"
                          onClick={() => onDismiss(alert.id)}
                          className="px-2.5 py-1 rounded text-slate-500 hover:text-slate-300 font-medium"
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    No alerts match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
