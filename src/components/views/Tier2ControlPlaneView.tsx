import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Cloud,
  Cpu,
  KeyRound,
  Laptop,
  Layers,
  Power,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type {
  CollectorSourceType,
  NavPageId,
  Tier2ControlPlaneStatus,
} from '../../../shared/types';
import { api } from '../../services/api';
import { detectWorkstationProfile } from '../../services/browserDeviceCollector';
import { formatDateTime, formatThroughput, formatUptime } from '../../utils/format';

interface Tier2ControlPlaneViewProps {
  browserProbeActive: boolean;
  browserProbeHostId: string | null;
  browserProbeRttMs: number | null;
  onStartBrowserProbe: () => Promise<void>;
  onStopBrowserProbe: () => void;
  onNavigate: (page: NavPageId) => void;
  onSelectHostForLive: (hostId: string) => void;
  onRefreshGlobal: () => void;
}

const SOURCE_LABELS: Record<CollectorSourceType, string> = {
  linux_os_collector: 'Linux OS Collector',
  mobile_probe: 'Phone / Mobile Device',
  browser_probe: 'Browser Device Probe',
  python_psutil: 'Python psutil Agent',
  registered_agent: 'Registered Agent',
};

export function Tier2ControlPlaneView({
  browserProbeActive,
  browserProbeHostId,
  browserProbeRttMs,
  onStartBrowserProbe,
  onStopBrowserProbe,
  onNavigate,
  onSelectHostForLive,
  onRefreshGlobal,
}: Tier2ControlPlaneViewProps) {
  const [status, setStatus] = useState<Tier2ControlPlaneStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingLocal, setTogglingLocal] = useState(false);
  const [togglingBrowser, setTogglingBrowser] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workstation = detectWorkstationProfile();

  const fetchStatus = useCallback(async () => {
    try {
      const next = await api.getTier2Status();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Tier 2 status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 3500);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  const handleToggleLocalCollector = async () => {
    if (!status) return;
    setTogglingLocal(true);
    try {
      await api.toggleTier1LocalCollector(!status.localCollectorRunning);
      await fetchStatus();
      onRefreshGlobal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle Tier 1 collector.');
    } finally {
      setTogglingLocal(false);
    }
  };

  const handleToggleBrowserProbe = async () => {
    setTogglingBrowser(true);
    setError(null);
    try {
      if (browserProbeActive) {
        onStopBrowserProbe();
      } else {
        await onStartBrowserProbe();
      }
      await fetchStatus();
      onRefreshGlobal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to pair browser device collector.');
    } finally {
      setTogglingBrowser(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Loading Tier 2 Cloud SaaS Control Plane…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Tier 2 KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Real Authenticated Collectors
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-display font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
              {status?.activeRealCollectors ?? 0}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {status?.realHosts.length ?? 0} registered
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Accepted Tier-1 Packets
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-display font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {status?.totalAcceptedPackets ?? 0}
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              X-Agent-Key
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            WebSocket Subscribers
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-display font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {status?.wsClientsConnected ?? 0}
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">/ws fanout</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Egress-Verified Payloads
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-display font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {status?.egressVerifiedRealCount ?? 0}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">Non-demo</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Rejected Auth Attempts
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span
              className={`text-2xl font-display font-bold tabular-nums ${
                (status?.totalRejectedAuth ?? 0) > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {status?.totalRejectedAuth ?? 0}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">SHA-256 gate</span>
          </div>
        </div>
      </div>

      {/* Tier 1 Collectors -> Authenticated Link -> Tier 2 SaaS Control Plane */}
      <section className="rounded-xl border border-cyan-500/25 bg-white dark:bg-[#0D1424] p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-600 dark:text-cyan-400">
              <Layers className="w-4 h-4" />
              <span>Tier 2 Cloud SaaS Control Plane · Live Multi-Device Ingestion</span>
            </div>
            <h2 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100 mt-1">
              Real-Time Tier 1 Collectors &amp; Tier 2 SaaS Pipeline
            </h2>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Control Plane Uptime {formatUptime(status?.uptimeSeconds ?? 0)}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Card 1: Built-in Runtime Linux OS Collector */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B14] p-4 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <Cpu className="w-4 h-4 text-cyan-500" />
                  <span>Tier 1 · Live Linux Runtime Collector</span>
                </div>
                <span
                  className={`text-[11px] font-mono font-semibold ${
                    status?.localCollectorRunning
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {status?.localCollectorRunning ? 'STREAMING' : 'PAUSED'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                Reads genuine OS hardware metrics via <code className="font-mono">/proc/stat</code>,{' '}
                <code className="font-mono">/proc/net/dev</code>, disk stats, and live processes every 4s, sanitizes sensitive paths, and ingests into Tier 2 under{' '}
                <code className="font-mono text-cyan-500">{status?.localCollectorHostId}</code>.
              </p>
            </div>

            <button
              type="button"
              disabled={togglingLocal}
              onClick={handleToggleLocalCollector}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                status?.localCollectorRunning
                  ? 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>
                {status?.localCollectorRunning ? 'Pause Runtime Collector' : 'Start Runtime Collector'}
              </span>
            </button>
          </div>

          {/* Card 2: Current User Workstation / Browser Probe */}
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                  <Laptop className="w-4 h-4" />
                  <span>Tier 1 · Your Workstation Device</span>
                </div>
                <span
                  className={`text-[11px] font-mono font-semibold ${
                    browserProbeActive
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {browserProbeActive ? 'PAIRED LIVE' : 'STANDBY'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
                Pairs this browser workstation via an authenticated <code className="font-mono">X-Agent-Key</code> and streams real hardware cores ({workstation.cores}), memory (~{workstation.ramTotalGb} GB), JS heap, downlink, and live SaaS RTT
                {browserProbeRttMs !== null ? ` (${browserProbeRttMs} ms)` : ''}.
              </p>
              {browserProbeActive && browserProbeHostId && (
                <div className="mt-2 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                  Host ID: {browserProbeHostId}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={togglingBrowser}
              onClick={handleToggleBrowserProbe}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                browserProbeActive
                  ? 'bg-red-500/15 text-red-700 dark:text-red-300 hover:bg-red-500/25'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>
                {togglingBrowser
                  ? 'Pairing…'
                  : browserProbeActive
                    ? 'Stop Workstation Stream'
                    : 'Stream This Workstation Live'}
              </span>
            </button>
          </div>

          {/* Card 3: Tier 2 Cloud SaaS Pipeline & External Python Pairing */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B14] p-4 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <Cloud className="w-4 h-4 text-blue-500" />
                  <span>Tier 2 · SaaS Ingestion &amp; Auth Gate</span>
                </div>
                <KeyRound className="w-4 h-4 text-purple-500" />
              </div>
              <ul className="mt-2 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                <li>
                  • Enrollment links:{' '}
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {status?.pendingEnrollmentLinks ?? 0} pending · {status?.claimedEnrollmentLinks ?? 0} claimed
                  </span>
                </li>
                <li>• Auth Gate: HMAC-SHA256 links + SHA-256 X-Agent-Key</li>
                <li>• Pipeline: SQLite Ledger -&gt; Threshold Alerts -&gt; /ws -&gt; Gemini AI</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('hosts')}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            >
              <span>Pair External Linux/macOS Device</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Real-Time Connected Devices Grid (Strictly non-demo is_demo = 0) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Real-Time Connected Devices (Authenticated Tier-1 Fleet)
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Isolated from synthetic DEMO DATA
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(status?.realHosts ?? []).map((host) => (
            <div
              key={host.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                    {host.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {host.os} · {host.architecture}
                  </div>
                </div>
                <span
                  className={`text-xs font-semibold capitalize shrink-0 ${
                    host.status === 'online'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : host.status === 'degraded'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {host.status}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-xs pt-1 border-t border-slate-200 dark:border-slate-800/70">
                <div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">CPU</div>
                  <div className="font-mono tabular-nums font-semibold text-cyan-600 dark:text-cyan-400">
                    {host.cpuPct.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">RAM</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {host.ramPct.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">Net RX</div>
                  <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {formatThroughput(host.netRxKbps)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">Health</div>
                  <div className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                    {host.healthScore}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/70 text-[11px]">
                <span className="font-mono text-slate-500 dark:text-slate-400 truncate">
                  {host.agentVersion}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectHostForLive(host.id)}
                  className="font-semibold text-cyan-600 dark:text-cyan-400 hover:underline shrink-0"
                >
                  Open Live View
                </button>
              </div>
            </div>
          ))}

          {(status?.realHosts.length ?? 0) === 0 && (
            <div className="md:col-span-2 xl:col-span-3 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No real-time devices are currently registered. Start the Runtime Collector, stream this workstation, or pair an external device in Hosts.
            </div>
          )}
        </div>
      </section>

      {/* Tier 2 Ingestion Stream Ledger */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Tier 1 ──▶ Tier 2 Authenticated Ingestion Stream
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live audit of authenticated telemetry packets verified at the Tier 2 SaaS API gateway.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
            Latest {status?.recentIngestEvents.length ?? 0} frames
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-medium">Timestamp</th>
                <th className="py-2.5 px-3 font-medium">Device</th>
                <th className="py-2.5 px-3 font-medium">Tier-1 Source</th>
                <th className="py-2.5 px-3 font-medium text-right">CPU / RAM</th>
                <th className="py-2.5 px-3 font-medium text-right">Sanitized</th>
                <th className="py-2.5 px-3 font-medium text-right">Latency</th>
                <th className="py-2.5 px-4 font-medium text-right">Auth Gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {(status?.recentIngestEvents ?? []).map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/35">
                  <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {formatDateTime(ev.timestamp)}
                  </td>
                  <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                    {ev.hostName}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                    {SOURCE_LABELS[ev.sourceType]}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {ev.cpuPct.toFixed(1)}% · {ev.ramPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                    {ev.fieldsSanitized}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {ev.ingestLatencyMs} ms
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {ev.status === 'accepted' ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Verified</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Rejected</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {(status?.recentIngestEvents.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    Waiting for Tier 1 telemetry packets…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
