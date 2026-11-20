import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { AlertIncident, EgressAuditRecord, HostRecord, MetricPoint } from '../../../shared/types';
import { api } from '../../services/api';
import { formatBytes, formatDateTime, formatUptime } from '../../utils/format';
import { aggregateMetricsByTimestamp } from '../../utils/telemetry';
import { TelemetryChart } from '../charts/TelemetryChart';

interface ReportsViewProps {
  hosts: HostRecord[];
  alerts: AlertIncident[];
  audits: EgressAuditRecord[];
  onRefreshLogs: () => void;
}

export function ReportsView({ hosts, alerts, audits, onRefreshLogs }: ReportsViewProps) {
  const [reportTab, setReportTab] = useState<'metrics' | 'uptime' | 'alerts' | 'privacy'>('metrics');
  const [hostFilter, setHostFilter] = useState<string>('all');
  const [windowFilter, setWindowFilter] = useState<'15m' | '1h' | 'all'>('all');
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);

  useEffect(() => {
    api
      .getMetricsHistory(hostFilter === 'all' ? undefined : hostFilter, 180)
      .then((res) => setMetrics(res.metrics))
      .catch(() => setMetrics([]));
  }, [hostFilter]);

  const nowMs = Date.now();
  const windowCutoff =
    windowFilter === '15m'
      ? nowMs - 15 * 60 * 1000
      : windowFilter === '1h'
        ? nowMs - 60 * 60 * 1000
        : 0;

  const filteredMetrics = metrics.filter((m) => Date.parse(m.timestamp) >= windowCutoff);
  const chartMetrics =
    hostFilter === 'all'
      ? aggregateMetricsByTimestamp(filteredMetrics).slice(-40)
      : filteredMetrics.slice(-40);
  const filteredAlerts = alerts.filter(
    (a) =>
      (hostFilter === 'all' || a.hostId === hostFilter) &&
      Date.parse(a.createdAt) >= windowCutoff
  );
  const filteredAudits = audits.filter(
    (a) =>
      (hostFilter === 'all' || a.hostId === hostFilter) &&
      Date.parse(a.timestamp) >= windowCutoff
  );

  const exportTypeMap = {
    metrics: 'metrics',
    uptime: 'hosts',
    alerts: 'alerts',
    privacy: 'egress',
  } as const;

  const handleExport = (format: 'csv' | 'json') => {
    const type = exportTypeMap[reportTab];
    const qs = new URLSearchParams({ type, format });
    if (hostFilter !== 'all') qs.set('hostId', hostFilter);
    window.location.href = `/api/reports/export?${qs.toString()}`;
    setTimeout(onRefreshLogs, 600);
  };

  return (
    <div className="space-y-6">
      {/* Filter & Export Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/70">
            {(
              [
                { id: 'metrics', label: 'Metrics History' },
                { id: 'uptime', label: 'Host Uptime' },
                { id: 'alerts', label: 'Alert & Incident' },
                { id: 'privacy', label: 'Privacy Audit' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setReportTab(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  reportTab === tab.id
                    ? 'bg-white dark:bg-[#0D1424] text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter report by host"
            value={hostFilter}
            onChange={(e) => setHostFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="all">All Hosts</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter report by date window"
            value={windowFilter}
            onChange={(e) => setWindowFilter(e.target.value as '15m' | '1h' | 'all')}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="15m">Last 15 minutes</option>
            <option value="1h">Last 1 hour</option>
            <option value="all">All retained data</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport('json')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {reportTab === 'metrics' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <TelemetryChart
            title="Historical CPU, RAM & Disk Utilization"
            timestamps={chartMetrics.map((m) => m.timestamp)}
            series={[
              { id: 'r-cpu', label: 'CPU %', color: '#22D3EE', values: chartMetrics.map((m) => m.cpuPct) },
              { id: 'r-ram', label: 'RAM %', color: '#8B5CF6', values: chartMetrics.map((m) => m.ramPct) },
              { id: 'r-disk', label: 'Disk %', color: '#3B82F6', values: chartMetrics.map((m) => m.diskPct) },
            ]}
            maxValue={100}
          />
          <TelemetryChart
            title="Historical Network Traffic"
            timestamps={chartMetrics.map((m) => m.timestamp)}
            series={[
              { id: 'r-rx', label: 'RX Kbps', color: '#06B6D4', values: chartMetrics.map((m) => m.netRxKbps) },
              { id: 'r-tx', label: 'TX Kbps', color: '#A855F7', values: chartMetrics.map((m) => m.netTxKbps) },
            ]}
            unit=" Kbps"
          />
        </div>
      )}

      {reportTab === 'uptime' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Host</th>
                <th className="py-3 px-3 font-medium">OS</th>
                <th className="py-3 px-3 font-medium">Status</th>
                <th className="py-3 px-3 font-medium text-right">Health Score</th>
                <th className="py-3 px-3 font-medium text-right">Uptime</th>
                <th className="py-3 px-4 font-medium text-right">Last Heartbeat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {hosts.map((h) => (
                <tr key={h.id}>
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">{h.name}</td>
                  <td className="py-3 px-3 text-slate-600 dark:text-slate-300">{h.os}</td>
                  <td className="py-3 px-3 capitalize">{h.status}</td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums">{h.healthScore}/100</td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums">{formatUptime(h.uptimeSeconds)}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                    {formatDateTime(h.lastHeartbeat)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportTab === 'alerts' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Created</th>
                <th className="py-3 px-3 font-medium">Host</th>
                <th className="py-3 px-3 font-medium">Severity</th>
                <th className="py-3 px-3 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredAlerts.map((a) => (
                <tr key={a.id}>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500">{formatDateTime(a.createdAt)}</td>
                  <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">{a.hostName}</td>
                  <td className="py-2.5 px-3 uppercase font-mono">{a.severity}</td>
                  <td className="py-2.5 px-3 capitalize">{a.status}</td>
                  <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{a.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportTab === 'privacy' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Timestamp</th>
                <th className="py-3 px-3 font-medium">Host</th>
                <th className="py-3 px-3 font-medium">Status</th>
                <th className="py-3 px-3 font-medium text-right">Fields Sanitized</th>
                <th className="py-3 px-3 font-medium text-right">Fields Blocked</th>
                <th className="py-3 px-4 font-medium text-right">Payload Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredAudits.map((a) => (
                <tr key={a.id}>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500">{formatDateTime(a.timestamp)}</td>
                  <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">{a.hostName}</td>
                  <td className="py-2.5 px-3">{a.status}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{a.fieldsSanitized}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{a.fieldsBlocked}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{formatBytes(a.payloadBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
