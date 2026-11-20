import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import {
  Activity,
  AlertTriangle,
  Ban,
  BatteryCharging,
  Check,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  Laptop,
  Link2,
  Play,
  Plus,
  Power,
  QrCode,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Smartphone,
  Terminal,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import type {
  EnrollmentLinkRecord,
  HostRecord,
  MetricPoint,
  NavPageId,
  RawLocalTelemetry,
} from '../../../shared/types';
import {
  buildManualPairUrl,
  buildShortPairUrl,
  inspectPairingBaseUrl,
} from '../../../shared/pairing/url';
import { analyzePersonalDeviceTelemetry } from '../../../shared/personal/insights';
import { api } from '../../services/api';
import { detectWorkstationProfile } from '../../services/browserDeviceCollector';
import { formatDateTime, formatThroughput, formatUptime } from '../../utils/format';
import { TelemetryChart } from '../charts/TelemetryChart';

type DeviceTargetKind = 'phone' | 'this-device' | 'laptop' | 'server' | 'edge';
type FleetCategoryFilter = 'all' | 'phone' | 'laptop' | 'server';

interface ConnectDevicesViewProps {
  hosts: HostRecord[];
  localCollectorRunning: boolean;
  browserProbeActive: boolean;
  browserProbeHostId: string | null;
  onToggleLocalCollector: (enabled: boolean) => Promise<void>;
  onStartBrowserProbe: () => Promise<void>;
  onStopBrowserProbe: () => void;
  onRefresh: () => void;
  onSelectForLive: (hostId: string) => void;
  onNavigate: (page: NavPageId) => void;
}

const TARGET_OPTIONS: Array<{
  id: DeviceTargetKind;
  title: string;
  subtitle: string;
  icon: typeof Smartphone;
}> = [
  {
    id: 'phone',
    title: 'Phone / Tablet',
    subtitle: 'QR scan or 7-char code',
    icon: Smartphone,
  },
  {
    id: 'this-device',
    title: 'This Device',
    subtitle: 'Instant local stream',
    icon: Activity,
  },
  {
    id: 'laptop',
    title: 'Laptop / Desktop',
    subtitle: 'Browser or Windows/Mac',
    icon: Laptop,
  },
  {
    id: 'server',
    title: 'Linux / Cloud Server',
    subtitle: 'curl, Python or Docker',
    icon: Server,
  },
  {
    id: 'edge',
    title: 'Edge / Raspberry Pi / IoT',
    subtitle: 'ARM psutil or REST push',
    icon: Cpu,
  },
];

export function ConnectDevicesView({
  hosts,
  localCollectorRunning,
  browserProbeActive,
  browserProbeHostId,
  onToggleLocalCollector,
  onStartBrowserProbe,
  onStopBrowserProbe,
  onRefresh,
  onSelectForLive,
  onNavigate,
}: ConnectDevicesViewProps) {
  const [targetKind, setTargetKind] = useState<DeviceTargetKind>('phone');
  const [fleetFilter, setFleetFilter] = useState<FleetCategoryFilter>('all');

  const [deviceLabel, setDeviceLabel] = useState('');
  const [ttlMinutes, setTtlMinutes] = useState(30);
  const [publicBaseUrl, setPublicBaseUrl] = useState(() => window.location.origin);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [pairingCurrentDevice, setPairingCurrentDevice] = useState(false);
  const [togglingLocalHost, setTogglingLocalHost] = useState(false);

  const [enrollmentLinks, setEnrollmentLinks] = useState<EnrollmentLinkRecord[]>([]);
  const [generatedBundle, setGeneratedBundle] = useState<{
    link: EnrollmentLinkRecord;
    shortCode: string;
    shortPairUrl: string;
    pairCodePageUrl: string;
    pairPageUrl: string;
    qrDataUrl: string;
    enrollmentUrl: string;
    installerCommand: string;
    powershellCommand: string;
    pythonCommand: string;
  } | null>(null);
  const [networkInfo, setNetworkInfo] = useState<{
    requestOrigin: string;
    isAiStudioDevHost: boolean;
    isLocalhostOrigin?: boolean;
    sharedAppUrl: string | null;
    sharedAppReachable: boolean;
    sharedAppHttpStatus?: number | null;
    lanUrls: string[];
  } | null>(null);
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const [liveQrDataUrl, setLiveQrDataUrl] = useState<string | null>(null);

  // Manual Edge / Custom REST Agent Credential issuer
  const [edgeLabel, setEdgeLabel] = useState('');
  const [edgeOs, setEdgeOs] = useState('Raspberry Pi OS / ARM64');
  const [edgeArch, setEdgeArch] = useState('aarch64');
  const [edgeRamGb, setEdgeRamGb] = useState(4);
  const [edgeDiskGb, setEdgeDiskGb] = useState(64);
  const [issuingEdgeKey, setIssuingEdgeKey] = useState(false);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [manualCreds, setManualCreds] = useState<{
    host: HostRecord;
    agentKey: string;
    instructions: string;
  } | null>(null);

  const [inspectedHostId, setInspectedHostId] = useState<string | null>(null);
  const [inspectedHistory, setInspectedHistory] = useState<MetricPoint[]>([]);
  const [inspectedRaw, setInspectedRaw] = useState<RawLocalTelemetry | null>(null);
  const [cleaningOffline, setCleaningOffline] = useState(false);
  const telemetryDrawerRef = useRef<HTMLDivElement | null>(null);

  const localProfile = detectWorkstationProfile();
  const realHosts = hosts.filter((h) => !h.isDemo);
  const onlineRealCount = realHosts.filter((h) => h.status === 'online').length;
  const offlineCleanableCount = realHosts.filter(
    (h) => h.status === 'offline' && h.id !== 'tier1-runtime-host'
  ).length;
  const hasRuntimeLocalHost = hosts.some((h) => h.id === 'tier1-runtime-host');
  const inspectedHost = inspectedHostId
    ? realHosts.find((h) => h.id === inspectedHostId) ?? null
    : null;

  const loadEnrollmentLinks = useCallback(async () => {
    try {
      const res = await api.getEnrollmentLinks();
      setEnrollmentLinks(res.links);
    } catch {
      // ignore if session unavailable
    }
  }, []);

  const loadNetworkInfo = useCallback(async (autoSelectShared = false) => {
    setCheckingNetwork(true);
    try {
      const info = await api.getNetworkInfo();
      setNetworkInfo(info);
      if (autoSelectShared && info.sharedAppReachable && info.sharedAppUrl) {
        setPublicBaseUrl(info.sharedAppUrl);
      }
    } catch {
      // ignore network probe errors
    } finally {
      setCheckingNetwork(false);
    }
  }, []);

  useEffect(() => {
    loadEnrollmentLinks();
    loadNetworkInfo(true);
  }, [loadEnrollmentLinks, loadNetworkInfo]);

  useEffect(() => {
    if (!inspectedHostId) {
      setInspectedHistory([]);
      setInspectedRaw(null);
      return;
    }
    let cancelled = false;
    api
      .getHostDetail(inspectedHostId, 45)
      .then((res) => {
        if (cancelled) return;
        setInspectedHistory(res.history);
        setInspectedRaw(res.rawSnapshot);
      })
      .catch(() => {
        if (!cancelled) {
          setInspectedHistory([]);
          setInspectedRaw(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inspectedHostId, inspectedHost?.lastHeartbeat]);

  const handleCopy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleGeneratePairingBundle = async (e: FormEvent) => {
    e.preventDefault();
    setMintError(null);
    if (deviceLabel.trim().length < 2) {
      setMintError('Enter a device name (at least 2 characters), e.g. my-pixel-9 or ops-laptop.');
      return;
    }

    setMinting(true);
    try {
      const trimmedBaseUrl = publicBaseUrl.trim();
      const res = await api.createEnrollmentLink({
        label: deviceLabel.trim(),
        ttlMinutes,
        publicBaseUrl: trimmedBaseUrl || undefined,
      });
      const qrDataUrl = await QRCode.toDataURL(res.shortPairUrl, {
        width: 280,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#070B14', light: '#FFFFFF' },
      });
      setGeneratedBundle({ ...res, qrDataUrl });
      setDeviceLabel('');
      await loadEnrollmentLinks();
    } catch (err) {
      setMintError(err instanceof Error ? err.message : 'Unable to generate pairing bundle.');
    } finally {
      setMinting(false);
    }
  };

  const handleIssueEdgeCredential = async (e: FormEvent) => {
    e.preventDefault();
    setEdgeError(null);
    if (edgeLabel.trim().length < 2) {
      setEdgeError('Enter a node alias name (at least 2 characters).');
      return;
    }
    setIssuingEdgeKey(true);
    try {
      const res = await api.registerHost({
        name: edgeLabel.trim(),
        hostname: `${edgeLabel.trim()}.edge`,
        os: edgeOs.trim() || 'Linux ARM64',
        architecture: edgeArch.trim() || 'aarch64',
        ramTotalGb: Math.max(1, edgeRamGb),
        diskTotalGb: Math.max(1, edgeDiskGb),
      });
      setManualCreds(res);
      setEdgeLabel('');
      onRefresh();
    } catch (err) {
      setEdgeError(err instanceof Error ? err.message : 'Unable to register custom node.');
    } finally {
      setIssuingEdgeKey(false);
    }
  };

  const handleToggleThisDevice = async () => {
    setPairingCurrentDevice(true);
    setMintError(null);
    try {
      if (browserProbeActive) {
        onStopBrowserProbe();
      } else {
        await onStartBrowserProbe();
      }
      onRefresh();
    } catch (err) {
      setMintError(err instanceof Error ? err.message : 'Unable to toggle this device collector.');
    } finally {
      setPairingCurrentDevice(false);
    }
  };

  const handleToggleLocalHost = async (enabled: boolean) => {
    setTogglingLocalHost(true);
    try {
      await onToggleLocalCollector(enabled);
    } finally {
      setTogglingLocalHost(false);
    }
  };

  const handleDeleteDevice = async (hostId: string) => {
    if (hostId === 'tier1-runtime-host' && localCollectorRunning) {
      await onToggleLocalCollector(false);
    }
    await api.deleteHost(hostId);
    if (inspectedHostId === hostId) setInspectedHostId(null);
    onRefresh();
  };

  const handleCleanupOffline = async () => {
    setCleaningOffline(true);
    try {
      await api.cleanupOfflineHosts();
      if (inspectedHost && inspectedHost.status === 'offline') {
        setInspectedHostId(null);
      }
      onRefresh();
    } finally {
      setCleaningOffline(false);
    }
  };

  const handleInspectDevice = (hostId: string) => {
    setInspectedHostId(hostId);
    requestAnimationFrame(() => {
      telemetryDrawerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  const handleRevokeLink = async (id: string) => {
    await api.revokeEnrollmentLink(id);
    await loadEnrollmentLinks();
  };

  const getDeviceCategory = (host: HostRecord): 'phone' | 'laptop' | 'server' => {
    const kind = host.deviceMeta?.deviceKind;
    if (kind === 'phone' || kind === 'tablet' || host.agentVersion.includes('mobile-probe')) {
      return 'phone';
    }
    if (
      kind === 'workstation' ||
      kind === 'laptop' ||
      host.agentVersion.includes('browser-probe')
    ) {
      return 'laptop';
    }
    return 'server';
  };

  const filteredRealHosts = realHosts.filter((host) => {
    if (fleetFilter === 'all') return true;
    return getDeviceCategory(host) === fleetFilter;
  });

  const resolvedOrigin = (publicBaseUrl.trim() || window.location.origin).replace(/\/$/, '');
  const pairingDiag = inspectPairingBaseUrl(resolvedOrigin, {
    sharedAppReachable: networkInfo?.sharedAppReachable,
  });
  const effectiveShortPairUrl = generatedBundle
    ? buildShortPairUrl(resolvedOrigin, generatedBundle.shortCode)
    : '';
  const effectiveManualPairUrl = buildManualPairUrl(resolvedOrigin);

  useEffect(() => {
    if (!generatedBundle || !effectiveShortPairUrl) {
      setLiveQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(effectiveShortPairUrl, {
      width: 280,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#070B14', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setLiveQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setLiveQrDataUrl(generatedBundle.qrDataUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [generatedBundle, effectiveShortPairUrl]);

  const dockerCommand = generatedBundle
    ? `docker run --rm --net=host python:3.11-slim sh -c "pip install -q psutil requests && curl -fsSL '${resolvedOrigin}/api/agent/script.py' -o agent.py && python3 agent.py --enroll-url '${generatedBundle.enrollmentUrl}'"`
    : '';
  const edgeCurlSnippet = manualCreds
    ? `curl -sS -X POST "${resolvedOrigin}/api/metrics/ingest" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Agent-Key: ${manualCreds.agentKey}" \\\n  -d '{"hostId":"${manualCreds.host.id}","hostname":"${manualCreds.host.hostname}","os":"${manualCreds.host.os}","cpuPct":18.4,"ramPct":42.1,"ramUsedGb":1.7,"ramTotalGb":${manualCreds.host.ramTotalGb},"diskPct":31.0,"diskUsedGb":20,"diskTotalGb":${manualCreds.host.diskTotalGb},"netRxKbps":128,"netTxKbps":64,"uptimeSeconds":3600}'`
    : '';

  const isDevStudioHost = window.location.hostname.includes('ais-dev-');

  return (
    <div className="space-y-6">
      {/* Header Summary Bar */}
      <section className="rounded-xl border border-cyan-500/25 bg-white dark:bg-[#0D1424] p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-600 dark:text-cyan-400">
            <Link2 className="w-4 h-4" />
            <span>Multi-Device Pairing Space · Tier 1 Collector → Tier 2 SaaS</span>
          </div>
          <h2 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100 mt-1">
            Connect Any Phone, Laptop, Server, or Edge Node
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
            Pair devices with a 7-character code (<span className="font-mono text-cyan-600 dark:text-cyan-400">CIC-XXXX</span>), scannable QR code, one-line OS installer, Docker container, or direct <code className="font-mono">X-Agent-Key</code> REST telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] px-3.5 py-2 font-mono tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{onlineRealCount}</span>{' '}
            <span className="text-slate-500 dark:text-slate-400">Online ·</span>{' '}
            <span className="text-slate-900 dark:text-slate-100 font-semibold">{realHosts.length}</span>{' '}
            <span className="text-slate-500 dark:text-slate-400">Paired Real Devices</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('hosts')}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Open Full Hosts Table
          </button>
        </div>
      </section>

      {/* Step 1: Target Device Type Picker */}
      <section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {TARGET_OPTIONS.map((item) => {
          const Icon = item.icon;
          const active = targetKind === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTargetKind(item.id)}
              aria-pressed={active}
              className={`rounded-xl border p-4 text-left transition-colors flex flex-col gap-2 ${
                active
                  ? 'border-cyan-500 bg-cyan-500/10 text-slate-900 dark:text-slate-100'
                  : 'border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <Icon className={`w-4 h-4 ${active ? 'text-cyan-500' : 'text-slate-400'}`} />
                {active && (
                  <span className="text-[10px] font-mono font-semibold text-cyan-600 dark:text-cyan-400">
                    SELECTED
                  </span>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold">{item.title}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {item.subtitle}
                </div>
              </div>
            </button>
          );
        })}
      </section>

      {/* Step 2: Pairing Workspace + Issued Codes Ledger */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 space-y-5">
          {targetKind === 'this-device' ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Stream This Browser Device &amp; Runtime Local Host Immediately
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Zero installation required. Start the browser telemetry collector for your current laptop/phone, or control the Tier-1 local runtime <code className="font-mono">node:os</code> host.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Current Browser Workstation / Phone
                    </span>
                    <span
                      className={`text-[11px] font-mono font-semibold ${
                        browserProbeActive ? 'text-emerald-500' : 'text-slate-400'
                      }`}
                    >
                      {browserProbeActive ? 'STREAMING' : 'STOPPED'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono space-y-1">
                    <div>Profile: {localProfile.defaultLabel}</div>
                    <div>OS / Arch: {localProfile.os} · {localProfile.architecture}</div>
                    <div>Hardware: {localProfile.cores} logical cores · ~{localProfile.ramTotalGb} GB RAM</div>
                  </div>
                  <button
                    type="button"
                    disabled={pairingCurrentDevice}
                    onClick={handleToggleThisDevice}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      browserProbeActive
                        ? 'bg-red-500/15 text-red-700 dark:text-red-300 hover:bg-red-500/25'
                        : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>
                      {pairingCurrentDevice
                        ? 'Connecting…'
                        : browserProbeActive
                          ? 'Stop Streaming This Device'
                          : 'Stream This Device Now'}
                    </span>
                  </button>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Local Runtime Host (<code className="font-mono">tier1-localhost</code>)
                    </span>
                    <span
                      className={`text-[11px] font-mono font-semibold ${
                        localCollectorRunning && hasRuntimeLocalHost
                          ? 'text-emerald-500'
                          : 'text-slate-400'
                      }`}
                    >
                      {localCollectorRunning && hasRuntimeLocalHost ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    Reads real CPU, RAM, disk capacity, load average, network RX/TX, and running processes directly from the local Node/Linux host and scrubs local identifiers via Egress Proof.
                  </p>
                  <button
                    type="button"
                    disabled={togglingLocalHost}
                    onClick={() => handleToggleLocalHost(!(localCollectorRunning && hasRuntimeLocalHost))}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      localCollectorRunning && hasRuntimeLocalHost
                        ? 'border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>
                      {localCollectorRunning && hasRuntimeLocalHost
                        ? 'Pause Local Host Collector'
                        : 'Start Local Host Collector'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {targetKind === 'phone' && 'Pair Android / iOS Phone or Tablet'}
                    {targetKind === 'laptop' && 'Pair Another Laptop or Desktop'}
                    {targetKind === 'server' && 'Pair Linux, macOS, or Cloud Server'}
                    {targetKind === 'edge' && 'Pair Edge Node, Raspberry Pi, or IoT Device'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Creates a single-use HMAC-SHA256 pairing token AND a 7-character code (<code className="font-mono">CIC-XXXX</code>).
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Egress-Proof Pre-Sanitized
                </span>
              </div>

              <form onSubmit={handleGeneratePairingBundle} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-6">
                    <label
                      htmlFor="connect-device-label"
                      className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Device Name
                    </label>
                    <input
                      id="connect-device-label"
                      type="text"
                      value={deviceLabel}
                      onChange={(e) => setDeviceLabel(e.target.value)}
                      placeholder={
                        targetKind === 'phone'
                          ? 'e.g. pixel-9-pro or iphone-16'
                          : targetKind === 'laptop'
                            ? 'e.g. work-thinkpad or macbook-air'
                            : targetKind === 'server'
                              ? 'e.g. prod-ubuntu-eu-01'
                              : 'e.g. rpi5-rack-sensor'
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label
                      htmlFor="connect-ttl"
                      className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Expiry Window
                    </label>
                    <select
                      id="connect-ttl"
                      value={ttlMinutes}
                      onChange={(e) => setTtlMinutes(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={60}>1 hour</option>
                      <option value={1440}>24 hours</option>
                    </select>
                  </div>

                  <div className="sm:col-span-3 flex items-end">
                    <button
                      type="submit"
                      disabled={minting}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-60 whitespace-nowrap"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>{minting ? 'Minting…' : 'Generate Pair Code'}</span>
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="connect-server-url"
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300"
                    >
                      <Globe className="w-3.5 h-3.5 text-cyan-500" />
                      <span>Reachable Server URL (embedded in QR &amp; CLI installers)</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPublicBaseUrl(window.location.origin)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                          publicBaseUrl === window.location.origin
                            ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
                            : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Current Preview
                      </button>
                      {networkInfo?.sharedAppUrl && (
                        <button
                          type="button"
                          onClick={() => setPublicBaseUrl(networkInfo.sharedAppUrl!)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                            publicBaseUrl === networkInfo.sharedAppUrl
                              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {networkInfo.sharedAppReachable
                            ? 'Shared App URL (No Login · Ready)'
                            : 'Shared App URL (Publish App First)'}
                        </button>
                      )}
                      {networkInfo?.lanUrls.map((lan) => (
                        <button
                          key={lan}
                          type="button"
                          onClick={() => setPublicBaseUrl(lan)}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
                            publicBaseUrl === lan
                              ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
                              : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {lan.replace('http://', 'LAN ')}
                        </button>
                      ))}
                      {publicBaseUrl !== window.location.origin && (
                        <button
                          type="button"
                          onClick={() => setPublicBaseUrl(window.location.origin)}
                          className="inline-flex items-center gap-1 text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    id="connect-server-url"
                    type="url"
                    value={publicBaseUrl}
                    onChange={(e) => setPublicBaseUrl(e.target.value)}
                    placeholder="https://your-shared-app-url.run.app or http://192.168.x.x:3000"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1424] px-3 py-1.5 text-xs font-mono text-slate-800 dark:text-slate-200"
                  />

                  {pairingDiag.status !== 'ready' && (
                    <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 space-y-2 text-[11px] text-amber-800 dark:text-amber-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span>{pairingDiag.headline}</span>
                        </span>
                        {networkInfo?.sharedAppUrl && (
                          <button
                            type="button"
                            onClick={() => loadNetworkInfo(true)}
                            disabled={checkingNetwork}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/40 bg-white/60 dark:bg-[#0D1424] text-amber-700 dark:text-amber-300 font-medium hover:bg-white dark:hover:bg-slate-800"
                          >
                            <RefreshCw className={`w-3 h-3 ${checkingNetwork ? 'animate-spin' : ''}`} />
                            <span>{checkingNetwork ? 'Checking…' : 'Re-check Shared URL'}</span>
                          </button>
                        )}
                      </div>
                      <p className="leading-relaxed">{pairingDiag.explanation}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                        {networkInfo?.sharedAppUrl && (
                          <a
                            href={networkInfo.sharedAppUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg font-semibold bg-emerald-600 hover:bg-emerald-500 text-white text-center"
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span>
                              {networkInfo.sharedAppReachable
                                ? 'Open Shared App (No 403)'
                                : 'Shared App URL (Share First)'}
                            </span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(
                              'manualChromeUrl',
                              effectiveShortPairUrl || effectiveManualPairUrl
                            )
                          }
                          className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg font-semibold border border-amber-500/40 bg-white/70 dark:bg-[#0D1424] text-amber-800 dark:text-amber-200 hover:bg-white dark:hover:bg-slate-800"
                        >
                          {copiedKey === 'manualChromeUrl' ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>
                            {copiedKey === 'manualChromeUrl'
                              ? 'Copied Pair URL'
                              : 'Copy Signed-In Chrome Link'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTargetKind('this-device');
                            if (!browserProbeActive) {
                              handleToggleThisDevice();
                            }
                          }}
                          className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg font-semibold border border-cyan-500/40 bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 hover:bg-cyan-500/25"
                        >
                          <Laptop className="w-3 h-3 shrink-0" />
                          <span>Pair This Device Now</span>
                        </button>
                      </div>
                      <p className="text-[10px] opacity-90">
                        Valid fixes for 403: (1) Click <span className="font-semibold">Share App</span> in AI Studio and open the <span className="font-semibold">Shared App URL</span> (<code className="font-mono">ais-pre-</code>) on both desktop and phone; or (2) open the copied link in <span className="font-semibold">Chrome on your phone signed into the same Google account</span> instead of the camera mini-browser; or (3) paste your self-hosted LAN / Cloud Run URL above.
                      </p>
                    </div>
                  )}
                </div>
              </form>

              {mintError && <p className="text-xs text-red-500">{mintError}</p>}

              {generatedBundle && (
                <div className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center rounded-xl border border-cyan-500/30 bg-slate-50 dark:bg-[#070B14] p-4">
                    <div className="md:col-span-4 flex flex-col items-center gap-2">
                      <div className="rounded-xl bg-white p-2 border border-slate-200 shadow-xs">
                        <img
                          src={liveQrDataUrl || generatedBundle.qrDataUrl}
                          alt={`QR pairing code for ${generatedBundle.link.label}`}
                          className="w-44 h-44 block"
                        />
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono text-center">
                        Compact Auto-Pair QR ({generatedBundle.shortCode})
                      </span>
                      <span
                        className={`text-[10px] font-semibold text-center ${
                          pairingDiag.status === 'ready'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {pairingDiag.status === 'ready'
                          ? 'External QR Reachable (No 403)'
                          : 'Dev Preview URL (Use Signed-In Chrome or Shared URL)'}
                      </span>
                    </div>

                    <div className="md:col-span-8 space-y-3 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          Ready for <span className="font-mono text-cyan-600 dark:text-cyan-400">{generatedBundle.link.label}</span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          Expires {formatDateTime(generatedBundle.link.expiresAt)}
                        </span>
                      </div>

                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            7-Char Pairing Code (Enter at {resolvedOrigin}/?pair=1)
                          </div>
                          <div className="font-mono text-xl font-bold tracking-widest text-cyan-600 dark:text-cyan-400 mt-0.5">
                            {generatedBundle.shortCode}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopy('shortCode', generatedBundle.shortCode)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {copiedKey === 'shortCode' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedKey === 'shortCode' ? 'Copied' : 'Copy Code'}</span>
                          </button>
                          <a
                            href={effectiveShortPairUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
                          >
                            Test QR Target
                          </a>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="font-medium text-slate-600 dark:text-slate-300">
                            QR Scan Target URL (Auto-Pairs on Open)
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy('shortPairUrl', effectiveShortPairUrl)}
                            className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                          >
                            {copiedKey === 'shortPairUrl' ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span>{copiedKey === 'shortPairUrl' ? 'Copied' : 'Copy URL'}</span>
                          </button>
                        </div>
                        <pre className="rounded-lg bg-slate-950 text-cyan-300 p-2 text-[11px] font-mono overflow-x-auto">
                          {effectiveShortPairUrl}
                        </pre>
                      </div>
                    </div>
                  </div>

                  {(targetKind === 'laptop' || targetKind === 'server' || targetKind === 'edge') && (
                    <div className="space-y-3">
                      {(targetKind === 'laptop' || targetKind === 'server' || targetKind === 'edge') && (
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                            <span className="inline-flex items-center gap-1 font-medium">
                              <Terminal className="w-3 h-3" /> macOS / Linux / Raspberry Pi (Python psutil installer)
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy('installer', generatedBundle.installerCommand)}
                              className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                            >
                              {copiedKey === 'installer' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedKey === 'installer' ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>
                          <pre className="rounded-lg bg-slate-950 text-cyan-300 p-2.5 text-[11px] font-mono overflow-x-auto">
                            {generatedBundle.installerCommand}
                          </pre>
                        </div>
                      )}

                      {targetKind === 'laptop' && (
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                            <span className="font-medium">Windows PowerShell Collector (psutil)</span>
                            <button
                              type="button"
                              onClick={() => handleCopy('ps', generatedBundle.powershellCommand)}
                              className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                            >
                              {copiedKey === 'ps' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedKey === 'ps' ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>
                          <pre className="rounded-lg bg-slate-950 text-slate-200 p-2.5 text-[11px] font-mono overflow-x-auto">
                            {generatedBundle.powershellCommand}
                          </pre>
                        </div>
                      )}

                      {(targetKind === 'server' || targetKind === 'edge') && (
                        <>
                          <div>
                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                              <span className="font-medium">Direct Python Agent Command</span>
                              <button
                                type="button"
                                onClick={() => handleCopy('py', generatedBundle.pythonCommand)}
                                className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                              >
                                {copiedKey === 'py' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                <span>{copiedKey === 'py' ? 'Copied' : 'Copy'}</span>
                              </button>
                            </div>
                            <pre className="rounded-lg bg-slate-950 text-slate-200 p-2.5 text-[11px] font-mono overflow-x-auto">
                              {generatedBundle.pythonCommand}
                            </pre>
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                              <span className="font-medium">Containerized Docker Collector</span>
                              <button
                                type="button"
                                onClick={() => handleCopy('docker', dockerCommand)}
                                className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                              >
                                {copiedKey === 'docker' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                <span>{copiedKey === 'docker' ? 'Copied' : 'Copy'}</span>
                              </button>
                            </div>
                            <pre className="rounded-lg bg-slate-950 text-slate-200 p-2.5 text-[11px] font-mono overflow-x-auto">
                              {dockerCommand}
                            </pre>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Direct REST / X-Agent-Key Issuer for Edge / Custom Microcontrollers / Scripts */}
              {targetKind === 'edge' && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <KeyRound className="w-4 h-4 text-purple-500" />
                    <span>Issue Static X-Agent-Key for Custom REST / Embedded Scripts</span>
                  </div>
                  <form onSubmit={handleIssueEdgeCredential} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    <input
                      type="text"
                      value={edgeLabel}
                      onChange={(e) => setEdgeLabel(e.target.value)}
                      placeholder="Node alias (e.g. gateway-sensor-01)"
                      className="sm:col-span-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <input
                      type="text"
                      value={edgeOs}
                      onChange={(e) => setEdgeOs(e.target.value)}
                      placeholder="OS"
                      className="sm:col-span-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <input
                      type="text"
                      value={edgeArch}
                      onChange={(e) => setEdgeArch(e.target.value)}
                      placeholder="Arch"
                      className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={issuingEdgeKey}
                      className="sm:col-span-3 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-60 whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{issuingEdgeKey ? 'Issuing…' : 'Issue Key'}</span>
                    </button>
                  </form>
                  {edgeError && <p className="text-xs text-red-500">{edgeError}</p>}

                  {manualCreds && (
                    <div className="rounded-lg border border-purple-500/30 bg-slate-50 dark:bg-[#070B14] p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-purple-600 dark:text-purple-400">
                          REST Push Sample ({manualCreds.host.name} · {manualCreds.host.id})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy('edgeCurl', edgeCurlSnippet)}
                          className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                        >
                          {copiedKey === 'edgeCurl' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedKey === 'edgeCurl' ? 'Copied' : 'Copy cURL'}</span>
                        </button>
                      </div>
                      <pre className="rounded-lg bg-slate-950 text-cyan-300 p-2.5 text-[11px] font-mono overflow-x-auto">
                        {edgeCurlSnippet}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Column: Issued Pairing Codes & Links Ledger */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Pairing Codes &amp; Auth Links ({enrollmentLinks.length})
              </h3>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                HMAC-SHA256
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] divide-y divide-slate-200 dark:divide-slate-800/70">
              {enrollmentLinks.slice(0, 12).map((lnk) => (
                <div
                  key={lnk.id}
                  className="px-3 py-2.5 flex items-center justify-between gap-2 text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {lnk.label}
                      </span>
                      {lnk.shortCode && (
                        <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400 shrink-0">
                          {lnk.shortCode}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 font-mono truncate mt-0.5">
                      {lnk.claimedHostId
                        ? `Paired -> ${lnk.claimedHostId}`
                        : `Expires ${formatDateTime(lnk.expiresAt)}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`capitalize font-semibold ${
                        lnk.status === 'claimed'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : lnk.status === 'pending'
                            ? 'text-cyan-600 dark:text-cyan-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {lnk.status}
                    </span>
                    {lnk.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleRevokeLink(lnk.id)}
                        aria-label={`Revoke link ${lnk.label}`}
                        className="text-red-500 hover:text-red-400 inline-flex items-center gap-0.5"
                      >
                        <Ban className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {enrollmentLinks.length === 0 && (
                <div className="px-3 py-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
                  No pairing codes issued yet. Generate one on the left to connect a phone, laptop, or server.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] p-3.5 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              How Two-Tier Device Pairing Works
            </div>
            <p className="leading-relaxed">
              1. Generate a code or QR link above for any device type.
              <br />
              2. Claiming mints a unique per-device <code className="font-mono">X-Agent-Key</code> (hashed with SHA-256 on Tier 2).
              <br />
              3. Raw hostnames, IPs, and paths stay redacted while live metrics stream over WebSockets into <span className="font-semibold">Live Monitoring</span> &amp; <span className="font-semibold">Hosts</span>.
            </p>
          </div>
        </div>
      </div>

      {/* Step 3: Live Connected Devices Fleet */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
              Connected Real Devices ({filteredRealHosts.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live telemetry across all paired phones, workstations, servers, and runtime local hosts.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {offlineCleanableCount > 0 && (
              <button
                type="button"
                disabled={cleaningOffline}
                onClick={handleCleanupOffline}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/30 bg-red-500/8 text-red-600 dark:text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                {cleaningOffline ? 'Cleaning…' : `Clear Offline (${offlineCleanableCount})`}
              </button>
            )}
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/70 text-xs">
              {([
                { id: 'all', label: 'All Devices' },
                { id: 'phone', label: 'Phones & Tablets' },
                { id: 'laptop', label: 'Laptops & Desktops' },
                { id: 'server', label: 'Servers, Edge & Local' },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFleetFilter(tab.id)}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    fleetFilter === tab.id
                      ? 'bg-white dark:bg-[#0D1424] text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredRealHosts.map((host) => {
            const category = getDeviceCategory(host);
            const isRuntimeLocal = host.id === 'tier1-runtime-host';
            const isThisBrowser = host.id === browserProbeHostId;
            const Icon =
              category === 'phone' ? Smartphone : category === 'laptop' ? Laptop : Server;

            return (
              <div
                key={host.id}
                className={`rounded-lg border p-4 space-y-3 bg-slate-50 dark:bg-[#070B14] ${
                  inspectedHostId === host.id
                    ? 'border-cyan-500/60'
                    : 'border-slate-200 dark:border-slate-800/80'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/12 border border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-cyan-400 shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {host.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {isRuntimeLocal
                          ? `Local Host · ${host.os}`
                          : isThisBrowser
                            ? `This Device · ${host.os}`
                            : `${host.os} · ${host.architecture}`}
                      </div>
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

                <div className="grid grid-cols-4 gap-2 text-xs pt-2 border-t border-slate-200 dark:border-slate-800/70">
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
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Disk</div>
                    <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {host.diskPct.toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Net RX</div>
                    <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatThroughput(host.netRxKbps)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="font-mono">
                    Health {host.healthScore}/100 · Up {formatUptime(host.uptimeSeconds)}
                  </span>
                  {host.deviceMeta && (
                    <span className="inline-flex items-center gap-2 font-mono">
                      {host.deviceMeta.batteryPct !== null &&
                        host.deviceMeta.batteryPct !== undefined && (
                          <span className="inline-flex items-center gap-1">
                            <BatteryCharging className="w-3 h-3 text-emerald-500" />
                            {host.deviceMeta.batteryPct}%
                          </span>
                        )}
                      {host.deviceMeta.networkType && (
                        <span className="inline-flex items-center gap-1">
                          <Wifi className="w-3 h-3 text-blue-500" />
                          {host.deviceMeta.networkType}
                          {host.deviceMeta.rttMs ? ` · ${host.deviceMeta.rttMs}ms` : ''}
                        </span>
                      )}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/70 text-[11px]">
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    {formatDateTime(host.lastHeartbeat)}
                  </span>
                  <div className="flex items-center gap-2.5 shrink-0">
                    {isRuntimeLocal && (
                      <button
                        type="button"
                        disabled={togglingLocalHost}
                        onClick={() => handleToggleLocalHost(!localCollectorRunning)}
                        className="font-medium text-amber-600 dark:text-amber-400 hover:underline"
                      >
                        {localCollectorRunning ? 'Pause' : 'Start'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleInspectDevice(host.id)}
                      className="font-medium text-slate-700 dark:text-slate-200 hover:text-cyan-500"
                    >
                      Inspect Telemetry
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectForLive(host.id)}
                      className="font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
                    >
                      Live View
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDevice(host.id)}
                      aria-label={`Remove device ${host.name}`}
                      className="text-red-500 hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredRealHosts.length === 0 && (
            <div className="md:col-span-2 xl:col-span-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No real devices in this category yet. Select a device type above to pair one.
            </div>
          )}
        </div>

        {/* Inline Personal Device Telemetry, History & Export Panel */}
        {inspectedHost && (
          <div
            ref={telemetryDrawerRef}
            className="rounded-xl border border-cyan-500/35 bg-slate-50 dark:bg-[#070B14] p-5 space-y-4"
          >
            {(() => {
              const report = analyzePersonalDeviceTelemetry(inspectedHost, inspectedHistory);
              return (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                        Device Telemetry &amp; Usage Report · {inspectedHost.id}
                      </div>
                      <h4 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100 mt-0.5">
                        {inspectedHost.name} ({inspectedHost.os})
                      </h4>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = `/api/reports/export?type=metrics&format=csv&hostId=${encodeURIComponent(inspectedHost.id)}`;
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export CSV</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = `/api/reports/export?type=metrics&format=json&hostId=${encodeURIComponent(inspectedHost.id)}`;
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800"
                      >
                        Export JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectForLive(inspectedHost.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                      >
                        Full Live Monitor
                      </button>
                      <button
                        type="button"
                        onClick={() => setInspectedHostId(null)}
                        aria-label="Close telemetry report"
                        className="p-1.5 text-slate-400 hover:text-slate-200"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-3">
                      <div className="text-slate-500 dark:text-slate-400">Load Mean / Peak</div>
                      <div className="font-mono font-semibold text-cyan-600 dark:text-cyan-400 mt-1 tabular-nums">
                        {report.avgCpuPct}% / {report.peakCpuPct}%
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-3">
                      <div className="text-slate-500 dark:text-slate-400">Heap Memory Mean</div>
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                        {report.avgRamPct}% ({inspectedHost.ramTotalGb} GB tier)
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-3">
                      <div className="text-slate-500 dark:text-slate-400">SaaS Link Latency</div>
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                        {report.currentRttMs !== null ? `${report.currentRttMs} ms (${report.networkQuality})` : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-3">
                      <div className="text-slate-500 dark:text-slate-400">Power / Battery</div>
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-1">
                        {report.powerSummary}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <TelemetryChart
                      title="Historical Load & Memory"
                      timestamps={inspectedHistory.map((m) => m.timestamp)}
                      series={[
                        { id: 'c-cpu', label: 'CPU / Load %', color: '#22D3EE', values: inspectedHistory.map((m) => m.cpuPct) },
                        { id: 'c-ram', label: 'Memory %', color: '#8B5CF6', values: inspectedHistory.map((m) => m.ramPct) },
                      ]}
                      maxValue={100}
                      height={165}
                    />
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4 space-y-2.5 text-xs">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Device Diagnostics &amp; Active Sensors ({inspectedRaw?.processes.length ?? 0})
                      </div>
                      <ul className="space-y-1 text-slate-600 dark:text-slate-300 list-disc pl-4">
                        {report.recommendations.map((rec, i) => (
                          <li key={i}>{rec}</li>
                        ))}
                      </ul>
                      {inspectedRaw && inspectedRaw.processes.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1 font-mono text-[11px]">
                          {inspectedRaw.processes.slice(0, 4).map((p, idx) => (
                            <div key={`${p.pid}-${p.name}-${idx}`} className="flex items-center justify-between gap-2">
                              <span className="text-slate-700 dark:text-slate-300 truncate">{p.name}</span>
                              <span className="text-cyan-600 dark:text-cyan-400 shrink-0 tabular-nums">
                                {p.cpuPct.toFixed(1)}% CPU · {p.memPct.toFixed(1)}% MEM
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </section>
    </div>
  );
}
