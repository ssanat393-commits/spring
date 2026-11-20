import {
  Activity,
  ArrowRight,
  BatteryCharging,
  Download,
  Laptop,
  Link2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wifi,
} from 'lucide-react';
import type {
  AlertIncident,
  EgressAuditRecord,
  HostRecord,
  MetricPoint,
  NavPageId,
} from '../../../shared/types';
import { isPersonalDeviceHost } from '../../../shared/personal/insights';
import { formatBytes, formatDateTime, formatThroughput, formatUptime } from '../../utils/format';
import { aggregateMetricsByTimestamp } from '../../utils/telemetry';
import { TelemetryChart } from '../charts/TelemetryChart';

interface OverviewViewProps {
  hosts: HostRecord[];
  alerts: AlertIncident[];
  audits: EgressAuditRecord[];
  fleetHistory: MetricPoint[];
  demoModeEnabled: boolean;
  onToggleDemoMode: (enabled: boolean) => Promise<void>;
  onNavigate: (page: NavPageId) => void;
  onSelectHostForMonitoring: (hostId: string) => void;
  onAcknowledgeAlert: (id: string) => void;
  onResolveAlert: (id: string) => void;
}

export function OverviewView({
  hosts,
  alerts,
  audits,
  fleetHistory,
  demoModeEnabled,
  onToggleDemoMode,
  onNavigate,
  onSelectHostForMonitoring,
  onAcknowledgeAlert,
  onResolveAlert,
}: OverviewViewProps) {
  const realCollectorsCount = hosts.filter((h) => !h.isDemo).length;
  const demoHostsCount = hosts.filter((h) => h.isDemo).length;
  const onlineCount = hosts.filter((h) => h.status !== 'offline').length;
  const avgCpu =
    hosts.length > 0 ? hosts.reduce((sum, h) => sum + h.cpuPct, 0) / hosts.length : 0;
  const avgRam =
    hosts.length > 0 ? hosts.reduce((sum, h) => sum + h.ramPct, 0) / hosts.length : 0;
  const openAlerts = alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged');
  const criticalCount = openAlerts.filter((a) => a.severity === 'critical').length;
  const totalSanitizedFields = audits.reduce((sum, a) => sum + a.fieldsSanitized + a.fieldsBlocked, 0);

  const chartSlice = aggregateMetricsByTimestamp(fleetHistory).slice(-24);
  const timestamps = chartSlice.map((m) => m.timestamp);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-cyan-500/25 bg-white dark:bg-[#0D1424] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-200">
          <Link2 className="w-4 h-4 text-cyan-500 shrink-0" />
          <div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Two-Tier Collector + SaaS Plane:
            </span>{' '}
            <span className="font-mono tabular-nums text-cyan-600 dark:text-cyan-400 font-semibold">
              {realCollectorsCount} Real Authenticated Collector{realCollectorsCount === 1 ? '' : 's'}
            </span>
            {demoModeEnabled && (
              <span className="text-slate-500 dark:text-slate-400">
                {' '}
                · {demoHostsCount} Synthetic <span className="font-mono text-purple-500">DEMO DATA</span> hosts active
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('tier2-saas')}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 transition-colors whitespace-nowrap"
          >
            Open Tier 2 SaaS
          </button>
          <button
            type="button"
            onClick={() => onNavigate('connect-devices')}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors whitespace-nowrap"
          >
            Connect Real Device
          </button>
          {demoModeEnabled ? (
            <button
              type="button"
              onClick={() => onToggleDemoMode(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Real Devices Only
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('demo-mode')}
              className="text-xs font-semibold text-purple-600 dark:text-purple-300 hover:underline whitespace-nowrap"
            >
              Open Demo Controls
            </button>
          )}
        </div>
      </div>

      {demoModeEnabled && (
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/8 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-700 dark:text-slate-200">
            <span className="font-mono font-semibold text-purple-600 dark:text-purple-400 mr-2">
              DEMO DATA
            </span>
            Simulated fleet telemetry is active so every chart, incident workflow, and Egress Proof pipeline works immediately without installing an agent.
          </div>
          <button
            type="button"
            onClick={() => onNavigate('demo-mode')}
            className="text-xs font-semibold text-purple-600 dark:text-purple-300 hover:underline whitespace-nowrap"
          >
            Open Demo Controls
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Monitored Hosts</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-display font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {onlineCount}/{hosts.length}
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {hosts.length === 0 ? 'No hosts' : 'Online'}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Fleet CPU / RAM Mean</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-display font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {avgCpu.toFixed(1)}%
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              RAM {avgRam.toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Incidents</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-display font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {openAlerts.length}
            </span>
            <span
              className={`text-xs font-medium ${
                criticalCount > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {criticalCount} critical
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Sensitive Fields Redacted
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-display font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
              {totalSanitizedFields}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {audits.length} audits logged
            </span>
          </div>
        </div>
      </div>

      {/* Personal & Mobile Devices Live Telemetry Strip */}
      {(() => {
        const personalHosts = hosts.filter(isPersonalDeviceHost);
        return (
          <section className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Personal Devices Live Telemetry ({personalHosts.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Monitor live load, memory pressure, battery, and SaaS latency from your paired laptops and phones, export CSV logs, or inspect full charts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('connect-devices')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 transition-colors whitespace-nowrap"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Pair Another Device</span>
              </button>
            </div>

            {personalHosts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {personalHosts.map((device) => {
                  const isMobile =
                    device.deviceMeta?.deviceKind === 'phone' ||
                    device.deviceMeta?.deviceKind === 'tablet' ||
                    device.agentVersion.includes('mobile-probe');
                  const Icon = isMobile ? Smartphone : Laptop;
                  return (
                    <div
                      key={device.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-cyan-500/12 border border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-cyan-400 shrink-0">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {device.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {device.os}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-semibold capitalize shrink-0 ${
                            device.status === 'online'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : device.status === 'degraded'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {device.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-xs pt-2 border-t border-slate-200 dark:border-slate-800/70">
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Load</div>
                          <div className="font-mono tabular-nums font-semibold text-cyan-600 dark:text-cyan-400">
                            {device.cpuPct.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Heap</div>
                          <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                            {device.ramPct.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Battery</div>
                          <div className="font-mono tabular-nums text-slate-800 dark:text-slate-200 inline-flex items-center gap-1">
                            {device.deviceMeta?.batteryPct !== null &&
                            device.deviceMeta?.batteryPct !== undefined ? (
                              <>
                                <BatteryCharging className="w-3 h-3 text-emerald-500" />
                                {device.deviceMeta.batteryPct}%
                              </>
                            ) : (
                              'AC'
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">RTT</div>
                          <div className="font-mono tabular-nums text-slate-800 dark:text-slate-200 inline-flex items-center gap-1">
                            <Wifi className="w-3 h-3 text-blue-500" />
                            {device.deviceMeta?.rttMs ? `${device.deviceMeta.rttMs}ms` : '—'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/70 text-[11px]">
                        <button
                          type="button"
                          onClick={() => onSelectHostForMonitoring(device.id)}
                          className="inline-flex items-center gap-1 font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
                        >
                          <Activity className="w-3 h-3" />
                          <span>Live Telemetry</span>
                        </button>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              window.location.href = `/api/reports/export?type=metrics&format=csv&hostId=${encodeURIComponent(device.id)}`;
                            }}
                            className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                          >
                            <Download className="w-3 h-3" />
                            <span>CSV</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigate('ai-insights')}
                            className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:underline"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>AI Check</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center text-xs text-slate-500 dark:text-slate-400">
                No personal devices streaming yet. Open <span className="font-semibold">Connect Devices</span> to stream this browser workstation or pair your phone via QR/code.
              </div>
            )}
          </section>
        );
      })()}

      {/* Main Chart + Privacy Proof Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <TelemetryChart
            title="Live Fleet Telemetry Stream"
            subtitle="Sanitized CPU and Memory utilization across recent samples"
            timestamps={timestamps}
            series={[
              {
                id: 'fleet-cpu',
                label: 'CPU %',
                color: '#22D3EE',
                values: chartSlice.map((m) => m.cpuPct),
              },
              {
                id: 'fleet-ram',
                label: 'RAM %',
                color: '#8B5CF6',
                values: chartSlice.map((m) => m.ramPct),
              },
              {
                id: 'fleet-disk',
                label: 'Disk %',
                color: '#3B82F6',
                values: chartSlice.map((m) => m.diskPct),
              },
            ]}
            unit="%"
            maxValue={100}
            height={235}
          />
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Egress Proof Firewall
              </h3>
              <ShieldCheck className="w-4 h-4 text-cyan-500" />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Recent cloud transmissions verified against local sanitization rules.
            </p>

            <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800/80">
              {audits.slice(0, 4).map((audit) => (
                <div key={audit.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {audit.hostName}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {audit.fieldsSanitized} sanitized · {audit.fieldsBlocked} blocked ·{' '}
                      {formatBytes(audit.payloadBytes)}
                    </div>
                  </div>
                  <span
                    className={`font-medium shrink-0 ${
                      audit.status === 'transmitted'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {audit.status === 'transmitted' ? 'Verified' : 'Blocked'}
                  </span>
                </div>
              ))}
              {audits.length === 0 && (
                <div className="py-6 text-xs text-slate-500 dark:text-slate-400">
                  No egress transmissions logged yet.
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('egress-proof')}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white transition-colors"
          >
            <span>Inspect Raw vs. Sanitized Diff</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Host Fleet Table + Active Incidents */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Fleet Health Matrix
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('hosts')}
              className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:underline whitespace-nowrap"
            >
              Manage Hosts
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Host</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium text-right">CPU</th>
                  <th className="py-2.5 px-3 font-medium text-right">RAM</th>
                  <th className="py-2.5 px-3 font-medium text-right">Disk</th>
                  <th className="py-2.5 px-3 font-medium text-right">Net RX/TX</th>
                  <th className="py-2.5 px-4 font-medium text-right">Uptime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {hosts.map((host) => (
                  <tr
                    key={host.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/35 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => onSelectHostForMonitoring(host.id)}
                        className="text-left font-semibold text-slate-900 dark:text-slate-100 hover:text-cyan-500 transition-colors"
                      >
                        {host.name}
                      </button>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {host.os} · {host.isDemo ? 'DEMO DATA' : 'Agent'}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`font-medium capitalize ${
                          host.status === 'online'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : host.status === 'degraded'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {host.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {host.cpuPct.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {host.ramPct.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {host.diskPct.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatThroughput(host.netRxKbps)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatUptime(host.uptimeSeconds)}
                    </td>
                  </tr>
                ))}
                {hosts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      No hosts registered. Register a Python agent or enable Demo Mode.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Open Incidents
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('alerts')}
              className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
            >
              View All
            </button>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800/80 flex-1">
            {openAlerts.slice(0, 4).map((alert) => (
              <div key={alert.id} className="py-3 first:pt-0">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span
                    className={`font-semibold uppercase tracking-wide ${
                      alert.severity === 'critical'
                        ? 'text-red-600 dark:text-red-400'
                        : alert.severity === 'high'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-cyan-600 dark:text-cyan-400'
                    }`}
                  >
                    {alert.severity}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {formatDateTime(alert.createdAt)}
                  </span>
                </div>
                <div className="text-xs font-medium text-slate-900 dark:text-slate-100 mt-1">
                  {alert.title}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {alert.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="px-2.5 py-1 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onResolveAlert(alert.id)}
                    className="px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                  >
                    Resolve
                  </button>
                </div>
              </div>
            ))}
            {openAlerts.length === 0 && (
              <div className="py-8 text-xs text-slate-500 dark:text-slate-400 text-center">
                All systems nominal. No open incidents.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
