import { useEffect, useState } from 'react';
import {
  Activity,
  BatteryCharging,
  Cpu,
  Download,
  Laptop,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wifi,
} from 'lucide-react';
import type { HostRecord, MetricPoint, NavPageId, RawLocalTelemetry } from '../../../shared/types';
import {
  analyzePersonalDeviceTelemetry,
  isPersonalDeviceHost,
} from '../../../shared/personal/insights';
import { api } from '../../services/api';
import { formatThroughput, formatUptime } from '../../utils/format';
import { GaugeRing } from '../charts/GaugeRing';
import { TelemetryChart } from '../charts/TelemetryChart';

interface LiveMonitoringViewProps {
  hosts: HostRecord[];
  selectedHostId: string;
  onSelectHostId: (hostId: string) => void;
  onNavigate?: (page: NavPageId) => void;
}

export function LiveMonitoringView({
  hosts,
  selectedHostId,
  onSelectHostId,
  onNavigate,
}: LiveMonitoringViewProps) {
  const [history, setHistory] = useState<MetricPoint[]>([]);
  const [rawSnapshot, setRawSnapshot] = useState<RawLocalTelemetry | null>(null);
  const [showRawLocalArgs, setShowRawLocalArgs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeHost = hosts.find((h) => h.id === selectedHostId) ?? hosts[0] ?? null;

  useEffect(() => {
    if (!activeHost) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getHostDetail(activeHost.id, 60)
      .then((res) => {
        if (cancelled) return;
        setHistory(res.history);
        setRawSnapshot(res.rawSnapshot);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load telemetry');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeHost?.id, activeHost?.lastHeartbeat]);

  if (!activeHost) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        No hosts available to monitor. Pair a device in Connect Devices or enable Demo Mode.
      </div>
    );
  }

  const realPersonalHosts = hosts.filter(isPersonalDeviceHost);
  const otherRealHosts = hosts.filter((h) => !h.isDemo && !isPersonalDeviceHost(h));
  const demoHosts = hosts.filter((h) => h.isDemo);
  const isPersonal = isPersonalDeviceHost(activeHost);
  const personalAnalytics = isPersonal
    ? analyzePersonalDeviceTelemetry(activeHost, history)
    : null;
  const timestamps = history.map((h) => h.timestamp);

  return (
    <div className="space-y-6">
      {/* Host Selector & Quick-Switch Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="live-host-select" className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Target Device
            </label>
            <select
              id="live-host-select"
              value={activeHost.id}
              onChange={(e) => onSelectHostId(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-1.5 text-sm font-medium text-slate-900 dark:text-slate-100"
            >
              {realPersonalHosts.length > 0 && (
                <optgroup label="Personal & Mobile Devices">
                  {realPersonalHosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.status} · {h.os})
                    </option>
                  ))}
                </optgroup>
              )}
              {otherRealHosts.length > 0 && (
                <optgroup label="Servers & Local Runtime">
                  {otherRealHosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.status} · {h.agentVersion})
                    </option>
                  ))}
                </optgroup>
              )}
              {demoHosts.length > 0 && (
                <optgroup label="Simulated Fleet (DEMO DATA)">
                  {demoHosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} (DEMO DATA)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {activeHost.os} · {activeHost.kernel} · Uptime{' '}
              <span className="font-mono tabular-nums">{formatUptime(activeHost.uptimeSeconds)}</span>
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
            <span className={activeHost.isDemo ? 'text-purple-500' : 'text-emerald-500'}>
              {activeHost.isDemo ? 'DEMO DATA' : 'TIER 1 -> TIER 2 VERIFIED'}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {loading ? 'Refreshing…' : `Status: ${activeHost.status.toUpperCase()}`}
            </span>
          </div>
        </div>

        {(realPersonalHosts.length > 0 || otherRealHosts.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/70 text-xs">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Quick Switch:
            </span>
            {[...realPersonalHosts, ...otherRealHosts].slice(0, 8).map((h) => {
              const selected = h.id === activeHost.id;
              const isMobile =
                h.deviceMeta?.deviceKind === 'phone' ||
                h.deviceMeta?.deviceKind === 'tablet';
              const Icon = isPersonalDeviceHost(h)
                ? isMobile
                  ? Smartphone
                  : Laptop
                : Cpu;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onSelectHostId(h.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                    selected
                      ? 'border-cyan-500 bg-cyan-500/12 text-cyan-700 dark:text-cyan-300'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span>{h.name}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      h.status === 'online'
                        ? 'bg-emerald-500'
                        : h.status === 'degraded'
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Radial Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GaugeRing
          label={isPersonal ? 'Event-Loop / CPU Load' : 'CPU Utilization'}
          value={activeHost.cpuPct}
          detail={`Load ${rawSnapshot ? rawSnapshot.loadAvg.join(' / ') : '—'}`}
          warningThreshold={80}
          criticalThreshold={92}
        />
        <GaugeRing
          label={isPersonal ? 'Active Memory / Heap' : 'Memory Usage'}
          value={activeHost.ramPct}
          detail={`${activeHost.ramUsedGb} / ${activeHost.ramTotalGb} GB`}
          warningThreshold={82}
          criticalThreshold={94}
        />
        <GaugeRing
          label={isPersonal ? 'Storage Quota Used' : 'Disk Capacity'}
          value={activeHost.diskPct}
          detail={`${activeHost.diskUsedGb} / ${activeHost.diskTotalGb} GB`}
          warningThreshold={80}
          criticalThreshold={90}
        />
        <GaugeRing
          label="Device Health Score"
          value={activeHost.healthScore}
          detail={`Net RX ${formatThroughput(activeHost.netRxKbps)}`}
          warningThreshold={75}
          criticalThreshold={50}
          invertThresholds
        />
      </div>

      {/* Personal Device Sensors, Usage Analytics & Export Actions */}
      {isPersonal && personalAnalytics && (
        <section className="rounded-xl border border-cyan-500/25 bg-white dark:bg-[#0D1424] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                <Activity className="w-4 h-4" />
                <span>Personal Device Sensors &amp; Diagnostics</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {activeHost.name} · {personalAnalytics.sampleCount} Recorded Samples
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  window.location.href = `/api/reports/export?type=metrics&format=csv&hostId=${encodeURIComponent(activeHost.id)}`;
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.href = `/api/reports/export?type=metrics&format=json&hostId=${encodeURIComponent(activeHost.id)}`;
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <span>Export JSON</span>
              </button>
              {onNavigate && (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate('ai-insights')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI Insights</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('egress-proof')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-500" />
                    <span>Egress Proof</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-3.5 space-y-1">
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-500" />
                <span>Power &amp; Battery</span>
              </div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {personalAnalytics.powerSummary}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Browser Power Telemetry
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-3.5 space-y-1">
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <Wifi className="w-3.5 h-3.5 text-blue-500" />
                <span>SaaS Link &amp; Latency</span>
              </div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {personalAnalytics.currentRttMs !== null
                  ? `${personalAnalytics.currentRttMs} ms · ${personalAnalytics.networkQuality}`
                  : 'Measuring…'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                {activeHost.deviceMeta?.networkType || 'https'}
                {activeHost.deviceMeta?.downlinkMbps
                  ? ` · ${activeHost.deviceMeta.downlinkMbps} Mbps`
                  : ''}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-3.5 space-y-1">
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <Cpu className="w-3.5 h-3.5 text-cyan-500" />
                <span>Window Mean / Peak</span>
              </div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                CPU {personalAnalytics.avgCpuPct}% avg ({personalAnalytics.peakCpuPct}% peak)
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Heap {personalAnalytics.avgRamPct}% avg · RX {formatThroughput(personalAnalytics.avgNetRxKbps)}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-3.5 space-y-1">
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <Laptop className="w-3.5 h-3.5 text-purple-500" />
                <span>Hardware &amp; Display</span>
              </div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {activeHost.deviceMeta?.cores ?? '—'} cores · {activeHost.ramTotalGb} GB RAM tier
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Screen {activeHost.deviceMeta?.screen || '—'} · {activeHost.deviceMeta?.deviceKind || 'device'}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-3.5 space-y-1.5 text-xs">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Observed Health &amp; Actionable Recommendations
            </div>
            <ul className="space-y-1 text-slate-600 dark:text-slate-300 list-disc pl-4">
              {personalAnalytics.recommendations.map((rec, idx) => (
                <li key={idx}>{rec}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Live Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <TelemetryChart
          title="Compute & Memory History"
          subtitle={`Live sample stream for ${activeHost.name}`}
          timestamps={timestamps}
          series={[
            { id: 'host-cpu', label: 'CPU / Load %', color: '#22D3EE', values: history.map((m) => m.cpuPct) },
            { id: 'host-ram', label: 'Memory / Heap %', color: '#8B5CF6', values: history.map((m) => m.ramPct) },
            { id: 'host-disk', label: 'Storage %', color: '#3B82F6', values: history.map((m) => m.diskPct) },
          ]}
          unit="%"
          maxValue={100}
        />

        <TelemetryChart
          title="Network Ingress & Egress Throughput"
          subtitle="Measured bandwidth rates in Kbps"
          timestamps={timestamps}
          series={[
            {
              id: 'host-rx',
              label: 'Download (RX)',
              color: '#06B6D4',
              values: history.map((m) => m.netRxKbps),
            },
            {
              id: 'host-tx',
              label: 'Upload (TX)',
              color: '#A855F7',
              values: history.map((m) => m.netTxKbps),
            },
          ]}
          unit=" Kbps"
        />
      </div>

      {/* Running Processes / Browser Sensors Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isPersonal
                ? 'Active Device Telemetry Sensors & Subsystems'
                : 'Running Processes'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compare sanitized cloud-safe views against local collector sensor details.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/70">
            <button
              type="button"
              onClick={() => setShowRawLocalArgs(false)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                !showRawLocalArgs
                  ? 'bg-white dark:bg-[#0D1424] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Sanitized Cloud View
            </button>
            <button
              type="button"
              onClick={() => setShowRawLocalArgs(true)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                showRawLocalArgs
                  ? 'bg-white dark:bg-[#0D1424] text-amber-700 dark:text-amber-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Local Raw Preview
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-medium">{isPersonal ? 'Sensor ID' : 'PID'}</th>
                <th className="py-2.5 px-3 font-medium">{isPersonal ? 'Subsystem' : 'Process'}</th>
                <th className="py-2.5 px-3 font-medium text-right">CPU %</th>
                <th className="py-2.5 px-3 font-medium text-right">MEM %</th>
                <th className="py-2.5 px-4 font-medium">
                  {showRawLocalArgs ? 'Local Sensor Detail' : 'Sanitized Cloud Channel'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {(rawSnapshot?.processes ?? []).map((proc, idx) => (
                <tr key={`${proc.pid}-${proc.name}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/35">
                  <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {proc.pid}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                    {proc.name}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {proc.cpuPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {proc.memPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300 max-w-xl truncate">
                    {showRawLocalArgs
                      ? proc.cmdline
                      : `${proc.name} [ARGS_STRIPPED_BY_POLICY]`}
                  </td>
                </tr>
              ))}
              {(!rawSnapshot || rawSnapshot.processes.length === 0) && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500 dark:text-slate-400">
                    No subsystem telemetry captured for this device yet.
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
