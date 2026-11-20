import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import {
  Activity,
  AlertTriangle,
  Ban,
  BatteryCharging,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Laptop,
  Link2,
  Play,
  Plus,
  Power,
  QrCode,
  RefreshCw,
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
  RawLocalTelemetry,
} from '../../../shared/types';
import {
  buildManualPairUrl,
  buildShortPairUrl,
  inspectPairingBaseUrl,
} from '../../../shared/pairing/url';
import { api } from '../../services/api';
import { formatDateTime, formatThroughput, formatUptime } from '../../utils/format';
import { TelemetryChart } from '../charts/TelemetryChart';

interface HostsViewProps {
  hosts: HostRecord[];
  demoModeEnabled: boolean;
  localCollectorRunning: boolean;
  browserProbeActive: boolean;
  browserProbeHostId: string | null;
  onToggleLocalCollector: (enabled: boolean) => Promise<void>;
  onStartBrowserProbe: () => Promise<void>;
  onStopBrowserProbe: () => void;
  onToggleDemoMode: (enabled: boolean) => Promise<void>;
  onRefresh: () => void;
  onSelectForLive: (hostId: string) => void;
  onOpenConnectDevices?: () => void;
}

export function HostsView({
  hosts,
  demoModeEnabled,
  localCollectorRunning,
  browserProbeActive,
  browserProbeHostId,
  onToggleLocalCollector,
  onStartBrowserProbe,
  onStopBrowserProbe,
  onToggleDemoMode,
  onRefresh,
  onSelectForLive,
  onOpenConnectDevices,
}: HostsViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'degraded' | 'offline'>('all');
  const [showModal, setShowModal] = useState(false);

  // Two-Tier Authenticated Enrollment Link state
  const [pairTargetType, setPairTargetType] = useState<'phone' | 'laptop' | 'server'>('phone');
  const [enrollLabel, setEnrollLabel] = useState('');
  const [enrollTtl, setEnrollTtl] = useState(30);
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [publicBaseUrl, setPublicBaseUrl] = useState(() => window.location.origin);
  const [networkInfo, setNetworkInfo] = useState<{
    requestOrigin: string;
    isAiStudioDevHost: boolean;
    sharedAppUrl: string | null;
    sharedAppReachable: boolean;
    lanUrls: string[];
  } | null>(null);
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const [liveQrDataUrl, setLiveQrDataUrl] = useState<string | null>(null);
  const [pairingCurrentDevice, setPairingCurrentDevice] = useState(false);
  const [togglingLocalHost, setTogglingLocalHost] = useState(false);
  const [enrollmentLinks, setEnrollmentLinks] = useState<EnrollmentLinkRecord[]>([]);
  const [generatedBundle, setGeneratedBundle] = useState<{
    link: EnrollmentLinkRecord;
    shortCode: string;
    shortPairUrl: string;
    pairPageUrl: string;
    qrDataUrl: string;
    enrollmentUrl: string;
    installerCommand: string;
    powershellCommand: string;
    pythonCommand: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [os, setOs] = useState('Ubuntu 24.04 LTS');
  const [architecture, setArchitecture] = useState('x86_64');
  const [ramTotalGb, setRamTotalGb] = useState(32);
  const [diskTotalGb, setDiskTotalGb] = useState(512);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [registeredResult, setRegisteredResult] = useState<{
    host: HostRecord;
    agentKey: string;
    instructions: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const [detailHostId, setDetailHostId] = useState<string | null>(null);
  const [detailHistory, setDetailHistory] = useState<MetricPoint[]>([]);
  const [detailRawSnapshot, setDetailRawSnapshot] = useState<RawLocalTelemetry | null>(null);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);

  const detailHost = detailHostId ? hosts.find((h) => h.id === detailHostId) ?? null : null;
  const hasRuntimeLocalHost = hosts.some((h) => h.id === 'tier1-runtime-host');

  const loadEnrollmentLinks = useCallback(async () => {
    try {
      const res = await api.getEnrollmentLinks();
      setEnrollmentLinks(res.links);
    } catch {
      // ignore initial fetch error if session unavailable
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
    if (!detailHostId) {
      setDetailHistory([]);
      setDetailRawSnapshot(null);
      return;
    }
    let cancelled = false;
    api
      .getHostDetail(detailHostId, 30)
      .then((res) => {
        if (cancelled) return;
        setDetailHistory(res.history);
        setDetailRawSnapshot(res.rawSnapshot);
      })
      .catch(() => {
        if (!cancelled) {
          setDetailHistory([]);
          setDetailRawSnapshot(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detailHostId, detailHost?.lastHeartbeat]);

  const realHosts = hosts.filter((h) => !h.isDemo);
  const realHostCount = realHosts.length;
  const demoHostCount = hosts.filter((h) => h.isDemo).length;

  const filteredHosts = hosts.filter((h) => {
    const matchesStatus = statusFilter === 'all' || h.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesQuery =
      !q ||
      h.name.toLowerCase().includes(q) ||
      h.hostname.toLowerCase().includes(q) ||
      h.os.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  const handleGenerateEnrollmentLink = async (e: FormEvent) => {
    e.preventDefault();
    setEnrollError(null);
    if (enrollLabel.trim().length < 2) {
      setEnrollError('Enter a device label (at least 2 characters), e.g. my-iphone-15 or macbook-ops.');
      return;
    }
    setEnrollLoading(true);
    try {
      const res = await api.createEnrollmentLink({
        label: enrollLabel.trim(),
        ttlMinutes: enrollTtl,
        publicBaseUrl: publicBaseUrl.trim() || undefined,
      });
      const qrDataUrl = await QRCode.toDataURL(res.shortPairUrl, {
        width: 240,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#070B14', light: '#FFFFFF' },
      });
      setGeneratedBundle({ ...res, qrDataUrl });
      setEnrollLabel('');
      await loadEnrollmentLinks();
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : 'Unable to mint authenticated link.');
    } finally {
      setEnrollLoading(false);
    }
  };

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
      width: 240,
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

  const handleToggleCurrentDevice = async () => {
    setPairingCurrentDevice(true);
    setEnrollError(null);
    try {
      if (browserProbeActive) {
        onStopBrowserProbe();
      } else {
        await onStartBrowserProbe();
      }
      onRefresh();
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : 'Unable to pair this device.');
    } finally {
      setPairingCurrentDevice(false);
    }
  };

  const handleToggleLocalHost = async (enabled: boolean) => {
    setTogglingLocalHost(true);
    setEnrollError(null);
    try {
      await onToggleLocalCollector(enabled);
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : 'Unable to toggle local host collector.');
    } finally {
      setTogglingLocalHost(false);
    }
  };

  const handleRevokeLink = async (id: string) => {
    await api.revokeEnrollmentLink(id);
    await loadEnrollmentLinks();
  };

  const handleCopyText = async (field: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError('Host alias name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.registerHost({
        name: name.trim(),
        hostname: hostname.trim() || name.trim(),
        os: os.trim(),
        architecture: architecture.trim(),
        ramTotalGb,
        diskTotalGb,
      });
      setRegisteredResult(res);
      setName('');
      setHostname('');
      onRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Host registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInspectHost = (host: HostRecord) => {
    setDetailHostId(host.id);
    requestAnimationFrame(() => {
      detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  const handleDeleteHost = async (hostId: string) => {
    if (hostId === 'tier1-runtime-host' && localCollectorRunning) {
      await onToggleLocalCollector(false);
    }
    await api.deleteHost(hostId);
    if (detailHostId === hostId) setDetailHostId(null);
    onRefresh();
  };

  const handleCopyCommand = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-6">
      {/* Phones & Other Devices Live Monitor + Authenticated Pairing Hub */}
      <section className="rounded-xl border border-cyan-500/25 bg-white dark:bg-[#0D1424] p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-600 dark:text-cyan-400">
              <Smartphone className="w-4 h-4" />
              <span>Phones &amp; Personal Devices · Live Two-Tier Telemetry</span>
            </div>
            <h2 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100 mt-1">
              Monitor Your Phone, Laptop, or Servers in Real Time
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              Pair your Android/iOS phone or another laptop via QR code &amp; authenticated link, or run the Tier 1 <code className="font-mono text-cyan-500">psutil</code> collector on servers. All private device fields are scrubbed locally before streaming to Tier 2.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14]">
              {realHostCount} Real Devices · {demoHostCount} Demo Hosts
            </span>
            {onOpenConnectDevices && (
              <button
                type="button"
                onClick={onOpenConnectDevices}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 transition-colors whitespace-nowrap"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Connect Various Devices</span>
              </button>
            )}
            {!hasRuntimeLocalHost && (
              <button
                type="button"
                disabled={togglingLocalHost}
                onClick={() => handleToggleLocalHost(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Start Local Host</span>
              </button>
            )}
            <button
              type="button"
              disabled={pairingCurrentDevice}
              onClick={handleToggleCurrentDevice}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                browserProbeActive
                  ? 'bg-red-500/15 text-red-700 dark:text-red-300 hover:bg-red-500/25'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>
                {pairingCurrentDevice
                  ? 'Pairing…'
                  : browserProbeActive
                    ? 'Stop This Device Stream'
                    : 'Stream This Device Now'}
              </span>
            </button>
            {demoModeEnabled ? (
              <button
                type="button"
                onClick={() => onToggleDemoMode(false)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20 transition-colors"
              >
                Real Devices Only
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onToggleDemoMode(true)}
                className="px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Re-enable Demo Data
              </button>
            )}
          </div>
        </div>

        {/* Dedicated Live Connected Phones & Other Devices Grid */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Live Connected Phones &amp; Real Devices ({realHosts.length})
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Updated live via Tier-1 X-Agent-Key + WebSocket /ws
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {realHosts.map((host) => {
              const kind = host.deviceMeta?.deviceKind;
              const isRuntimeLocalHost = host.id === 'tier1-runtime-host';
              const isThisBrowserDevice = host.id === browserProbeHostId;
              const isPhoneOrTablet =
                kind === 'phone' ||
                kind === 'tablet' ||
                host.agentVersion.includes('mobile-probe');
              const isLaptopOrBrowser =
                kind === 'workstation' ||
                kind === 'laptop' ||
                host.agentVersion.includes('browser-probe');
              const Icon = isPhoneOrTablet ? Smartphone : isLaptopOrBrowser ? Laptop : Server;

              return (
                <div
                  key={host.id}
                  className={`rounded-lg border p-4 space-y-3 bg-slate-50 dark:bg-[#070B14] ${
                    detailHostId === host.id
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
                          {isRuntimeLocalHost
                            ? `Local Host · ${host.os}`
                            : isThisBrowserDevice
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
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">CPU / Load</div>
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

                  {isRuntimeLocalHost && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300 pt-1">
                      <span className="font-mono">
                        Disk {host.diskUsedGb}/{host.diskTotalGb} GB · Up {formatUptime(host.uptimeSeconds)}
                      </span>
                      <button
                        type="button"
                        disabled={togglingLocalHost}
                        onClick={() => handleToggleLocalHost(!localCollectorRunning)}
                        className={`inline-flex items-center gap-1 font-semibold ${
                          localCollectorRunning
                            ? 'text-amber-600 dark:text-amber-400 hover:underline'
                            : 'text-emerald-600 dark:text-emerald-400 hover:underline'
                        }`}
                      >
                        <Power className="w-3 h-3" />
                        <span>{localCollectorRunning ? 'Pause Local Host' : 'Start Local Host'}</span>
                      </button>
                    </div>
                  )}

                  {host.deviceMeta && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300 pt-1">
                      {host.deviceMeta.batteryPct !== null &&
                        host.deviceMeta.batteryPct !== undefined && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <BatteryCharging className="w-3.5 h-3.5 text-emerald-500" />
                            {host.deviceMeta.batteryPct}%
                            {host.deviceMeta.batteryCharging ? ' (Charging)' : ''}
                          </span>
                        )}
                      {host.deviceMeta.networkType && (
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Wifi className="w-3.5 h-3.5 text-blue-500" />
                          {host.deviceMeta.networkType}
                          {host.deviceMeta.rttMs ? ` · ${host.deviceMeta.rttMs} ms` : ''}
                        </span>
                      )}
                      {host.deviceMeta.screen && (
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          {host.deviceMeta.screen}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/70 text-[11px]">
                    <span className="font-mono text-slate-500 dark:text-slate-400 truncate">
                      {formatDateTime(host.lastHeartbeat)}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleInspectHost(host)}
                        aria-label={`Inspect ${host.name}`}
                        className="font-medium text-slate-700 dark:text-slate-300 hover:text-cyan-500"
                      >
                        Inspect
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
                        onClick={() => handleDeleteHost(host.id)}
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

            {realHosts.length === 0 && (
              <div className="md:col-span-2 xl:col-span-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center text-xs text-slate-500 dark:text-slate-400">
                No phones or real devices connected yet. Click <span className="font-semibold">Stream This Device Now</span> or generate a QR pairing link below.
              </div>
            )}
          </div>
        </div>

        {/* Enrollment Link + QR Generator + Issued Links Log */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B14] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Pair Phone, Tablet, Laptop, or Server (Authenticated Link)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Mint a one-time HMAC-SHA256 link with QR code for phones or terminal command for servers.
                </p>
              </div>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-800/80 text-[11px]">
                {([
                  { id: 'phone', label: 'Phone / Tablet' },
                  { id: 'laptop', label: 'Other Laptop' },
                  { id: 'server', label: 'Linux / Server' },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPairTargetType(tab.id)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      pairTargetType === tab.id
                        ? 'bg-white dark:bg-[#0D1424] text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleGenerateEnrollmentLink} className="flex flex-wrap items-end gap-2.5">
              <div className="flex-1 min-w-[180px]">
                <label
                  htmlFor="enroll-device-label"
                  className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1"
                >
                  Device Name
                </label>
                <input
                  id="enroll-device-label"
                  type="text"
                  value={enrollLabel}
                  onChange={(e) => setEnrollLabel(e.target.value)}
                  placeholder={
                    pairTargetType === 'phone'
                      ? 'e.g. my-iphone-15 or pixel-9'
                      : pairTargetType === 'laptop'
                        ? 'e.g. macbook-air-ops'
                        : 'e.g. prod-ubuntu-02'
                  }
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1424] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="w-32">
                <label
                  htmlFor="enroll-ttl"
                  className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1"
                >
                  Link Expiry
                </label>
                <select
                  id="enroll-ttl"
                  value={enrollTtl}
                  onChange={(e) => setEnrollTtl(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1424] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={60}>1 hour</option>
                  <option value={1440}>24 hours</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={enrollLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>{enrollLoading ? 'Minting…' : 'Create Device Pairing Link'}</span>
              </button>
            </form>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <label
                  htmlFor="hosts-qr-base-url"
                  className="inline-flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300"
                >
                  <Globe className="w-3.5 h-3.5 text-cyan-500" />
                  <span>QR Target Server URL</span>
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPublicBaseUrl(window.location.origin)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
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
                      className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                        publicBaseUrl === networkInfo.sharedAppUrl
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {networkInfo.sharedAppReachable
                        ? 'Shared App URL (No 403)'
                        : 'Shared App URL (Share First)'}
                    </button>
                  )}
                  {networkInfo?.lanUrls.map((lan) => (
                    <button
                      key={lan}
                      type="button"
                      onClick={() => setPublicBaseUrl(lan)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                    >
                      {lan.replace('http://', 'LAN ')}
                    </button>
                  ))}
                </div>
              </div>
              <input
                id="hosts-qr-base-url"
                type="url"
                value={publicBaseUrl}
                onChange={(e) => setPublicBaseUrl(e.target.value)}
                placeholder="https://your-shared-app-url.run.app or http://192.168.x.x:3000"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-1.5 text-xs font-mono text-slate-800 dark:text-slate-200"
              />
              {pairingDiag.status !== 'ready' && (
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 space-y-2 text-[11px] text-amber-800 dark:text-amber-200">
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
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/40 bg-white/60 dark:bg-[#0D1424] text-amber-700 dark:text-amber-300 font-medium"
                      >
                        <RefreshCw className={`w-3 h-3 ${checkingNetwork ? 'animate-spin' : ''}`} />
                        <span>{checkingNetwork ? 'Checking…' : 'Re-check Shared URL'}</span>
                      </button>
                    )}
                  </div>
                  <p className="leading-relaxed">{pairingDiag.explanation}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {networkInfo?.sharedAppUrl && (
                      <a
                        href={networkInfo.sharedAppUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open Shared App (No 403)</span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyText(
                          'manualPair',
                          effectiveShortPairUrl || effectiveManualPairUrl
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded font-semibold border border-amber-500/40 bg-white/70 dark:bg-[#0D1424] text-amber-800 dark:text-amber-200"
                    >
                      {copiedField === 'manualPair' ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>
                        {copiedField === 'manualPair' ? 'Copied Pair Link' : 'Copy Signed-In Chrome Link'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleCurrentDevice}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded font-semibold border border-cyan-500/40 bg-cyan-500/15 text-cyan-800 dark:text-cyan-300"
                    >
                      <Laptop className="w-3 h-3" />
                      <span>Pair This Device Now</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {enrollError && <p className="text-xs text-red-500">{enrollError}</p>}

            {generatedBundle && (
              <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Single-use link ready for <span className="font-mono">{generatedBundle.link.label}</span>
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    Expires {formatDateTime(generatedBundle.link.expiresAt)}
                  </span>
                </div>

                {pairTargetType !== 'server' ? (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row items-center gap-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-3.5">
                      <div className="rounded-lg bg-white p-1.5 border border-slate-200 shrink-0">
                        <img
                          src={liveQrDataUrl || generatedBundle.qrDataUrl}
                          alt={`QR pairing code for ${generatedBundle.link.label}`}
                          className="w-36 h-36 block"
                        />
                      </div>
                      <div className="flex-1 min-w-0 space-y-2 w-full">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            Scan QR on Phone or Enter Code
                          </span>
                          <span className="font-mono text-sm font-bold text-cyan-600 dark:text-cyan-400">
                            {generatedBundle.shortCode}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Point your phone camera at the QR code (or open <code className="font-mono">/?pair=1</code> in signed-in phone Chrome and enter <span className="font-mono font-semibold">{generatedBundle.shortCode}</span>).
                        </p>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-medium text-cyan-600 dark:text-cyan-400 inline-flex items-center gap-1">
                            <Link2 className="w-3 h-3" /> QR Auto-Pair URL
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyText('shortPairUrl', effectiveShortPairUrl)}
                            className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                          >
                            {copiedField === 'shortPairUrl' ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span>{copiedField === 'shortPairUrl' ? 'Copied' : 'Copy Link'}</span>
                          </button>
                        </div>
                        <pre className="rounded-lg bg-slate-950 text-cyan-300 p-2 text-[11px] font-mono overflow-x-auto">
                          {effectiveShortPairUrl}
                        </pre>
                      </div>
                    </div>

                    {pairTargetType === 'laptop' && (
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          <span className="inline-flex items-center gap-1 font-medium">
                            <Terminal className="w-3 h-3" /> Windows PowerShell Local PC Agent (psutil)
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyText('powershell', generatedBundle.powershellCommand)}
                            className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                          >
                            {copiedField === 'powershell' ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span>{copiedField === 'powershell' ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                        <pre className="rounded-lg bg-slate-950 text-cyan-300 p-2.5 text-[11px] font-mono overflow-x-auto">
                          {generatedBundle.powershellCommand}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Terminal className="w-3 h-3" /> One-Line Collector Installer (macOS / Linux)
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyText('installer', generatedBundle.installerCommand)}
                          className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                        >
                          {copiedField === 'installer' ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedField === 'installer' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <pre className="rounded-lg bg-slate-950 text-cyan-300 p-2.5 text-[11px] font-mono overflow-x-auto">
                        {generatedBundle.installerCommand}
                      </pre>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        <span className="font-medium">Windows PowerShell Installer</span>
                        <button
                          type="button"
                          onClick={() => handleCopyText('powershell', generatedBundle.powershellCommand)}
                          className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                        >
                          {copiedField === 'powershell' ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedField === 'powershell' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <pre className="rounded-lg bg-slate-950 text-slate-200 p-2.5 text-[11px] font-mono overflow-x-auto">
                        {generatedBundle.powershellCommand}
                      </pre>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        <span className="font-medium">Direct Python psutil Collector Command</span>
                        <button
                          type="button"
                          onClick={() => handleCopyText('python', generatedBundle.pythonCommand)}
                          className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline"
                        >
                          {copiedField === 'python' ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedField === 'python' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <pre className="rounded-lg bg-slate-950 text-slate-200 p-2.5 text-[11px] font-mono overflow-x-auto">
                        {generatedBundle.pythonCommand}
                      </pre>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B14] p-4 flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Two-Tier Collector + SaaS Pairing Instructions
              </h3>
              <ol className="mt-2.5 space-y-2 text-[11px] text-slate-600 dark:text-slate-300 list-decimal list-inside leading-relaxed">
                <li>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">For a Phone or Tablet</span>: select <span className="font-semibold">Phone / Tablet</span>, enter a device name, click <span className="font-semibold">Create Device Pairing Link</span>, and scan the QR code with your phone camera.
                </li>
                <li>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">For another Laptop or Desktop</span>: open the pairing URL in that machine&apos;s browser, or switch to <span className="font-semibold">Linux / Server</span> and run the <code className="font-mono">curl | bash</code> Python <code className="font-mono">psutil</code> installer.
                </li>
                <li>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Privacy &amp; Egress Proof</span>: every paired device authenticates via a per-host <code className="font-mono">X-Agent-Key</code> and scrubs IP addresses, usernames, and personal paths before reaching Tier 2.
                </li>
              </ol>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-2">
                <span>Issued Authenticated Links ({enrollmentLinks.length})</span>
                <span className="text-slate-500 dark:text-slate-400 font-normal">
                  Single-use HMAC-SHA256 tokens
                </span>
              </div>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] divide-y divide-slate-200 dark:divide-slate-800/70">
                {enrollmentLinks.slice(0, 8).map((lnk) => (
                  <div
                    key={lnk.id}
                    className="px-3 py-2 flex items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {lnk.label}{' '}
                        {lnk.shortCode && (
                          <span className="font-mono font-semibold text-cyan-600 dark:text-cyan-400">
                            · {lnk.shortCode}
                          </span>
                        )}
                        <span className="font-mono text-slate-400"> · {lnk.id}</span>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 font-mono truncate">
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
                          <span>Revoke</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {enrollmentLinks.length === 0 && (
                  <div className="px-3 py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    No enrollment links minted yet. Generate one above to pair a phone or device.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter hosts by name or OS…"
            aria-label="Search hosts"
            className="w-64 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1424] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
          />
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/70">
            {(['all', 'online', 'degraded', 'offline'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                  statusFilter === status
                    ? 'bg-white dark:bg-[#0D1424] text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setRegisteredResult(null);
            setFormError(null);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Manual Key Registration</span>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 font-medium">Host</th>
                  <th className="py-3 px-3 font-medium">Status</th>
                  <th className="py-3 px-3 font-medium text-right">Health</th>
                  <th className="py-3 px-3 font-medium text-right">CPU</th>
                  <th className="py-3 px-3 font-medium text-right">RAM</th>
                  <th className="py-3 px-3 font-medium">Last Heartbeat</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {filteredHosts.map((host) => (
                  <tr key={host.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/35">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleInspectHost(host)}
                        className="font-semibold text-slate-900 dark:text-slate-100 hover:text-cyan-500 text-left"
                      >
                        {host.name}
                      </button>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {host.os} · {host.architecture} · {host.isDemo ? 'DEMO DATA' : 'Registered Agent'}
                      </div>
                    </td>
                    <td className="py-3 px-3 capitalize font-medium">
                      <span
                        className={
                          host.status === 'online'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : host.status === 'degraded'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-red-600 dark:text-red-400'
                        }
                      >
                        {host.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {host.healthScore}/100
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {host.cpuPct.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {host.ramPct.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatDateTime(host.lastHeartbeat)}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelectForLive(host.id)}
                        className="text-cyan-600 dark:text-cyan-400 font-medium hover:underline"
                      >
                        Live View
                      </button>
                      {!host.isDemo && (
                        <button
                          type="button"
                          onClick={() => handleDeleteHost(host.id)}
                          aria-label={`Remove ${host.name}`}
                          className="text-red-500 hover:text-red-400 inline-flex align-middle"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredHosts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      No hosts match your current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Host Detail Panel */}
        <div
          ref={detailPanelRef}
          className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5"
        >
          {detailHost ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {detailHost.name}
                    </h3>
                    <span
                      className={`text-[11px] font-semibold capitalize ${
                        detailHost.status === 'online'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : detailHost.status === 'degraded'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {detailHost.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {detailHost.id} · {detailHost.agentVersion}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailHostId(null)}
                  className="text-slate-400 hover:text-slate-200"
                  aria-label="Close host details"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-slate-500 dark:text-slate-400">OS / Kernel</div>
                  <div className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                    {detailHost.os}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Uptime</div>
                  <div className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                    {formatUptime(detailHost.uptimeSeconds)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">CPU / Memory</div>
                  <div className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                    {detailHost.cpuPct.toFixed(1)}% · {detailHost.ramUsedGb} / {detailHost.ramTotalGb} GB
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Storage Capacity</div>
                  <div className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                    {detailHost.diskUsedGb} / {detailHost.diskTotalGb} GB ({detailHost.diskPct}%)
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Network RX / TX</div>
                  <div className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                    {formatThroughput(detailHost.netRxKbps)} / {formatThroughput(detailHost.netTxKbps)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Masked IP / Load</div>
                  <div className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                    {detailHost.ipMasked}
                    {detailRawSnapshot ? ` · ${detailRawSnapshot.loadAvg.join('/')}` : ''}
                  </div>
                </div>
                {detailHost.deviceMeta && (
                  <>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Device Kind / Battery</div>
                      <div className="font-mono text-slate-900 dark:text-slate-100 mt-0.5 capitalize">
                        {detailHost.deviceMeta.deviceKind}
                        {detailHost.deviceMeta.batteryPct !== null &&
                        detailHost.deviceMeta.batteryPct !== undefined
                          ? ` · ${detailHost.deviceMeta.batteryPct}%${detailHost.deviceMeta.batteryCharging ? ' Charging' : ''}`
                          : ''}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Network / SaaS RTT</div>
                      <div className="font-mono text-slate-900 dark:text-slate-100 mt-0.5">
                        {detailHost.deviceMeta.networkType || 'https'}
                        {detailHost.deviceMeta.rttMs ? ` · ${detailHost.deviceMeta.rttMs} ms` : ''}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <TelemetryChart
                title="Historical CPU & RAM"
                timestamps={detailHistory.map((m) => m.timestamp)}
                series={[
                  { id: 'd-cpu', label: 'CPU', color: '#22D3EE', values: detailHistory.map((m) => m.cpuPct) },
                  { id: 'd-ram', label: 'RAM', color: '#8B5CF6', values: detailHistory.map((m) => m.ramPct) },
                ]}
                maxValue={100}
                height={155}
              />

              {detailRawSnapshot && detailRawSnapshot.processes.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      Live Top Processes ({detailRawSnapshot.processes.slice(0, 5).length})
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectForLive(detailHost.id)}
                      className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
                    >
                      Open Live View
                    </button>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 divide-y divide-slate-200 dark:divide-slate-800/60 text-[11px]">
                    {detailRawSnapshot.processes.slice(0, 5).map((proc) => (
                      <div
                        key={proc.pid}
                        className="px-2.5 py-1.5 flex items-center justify-between gap-2 font-mono"
                      >
                        <span className="truncate text-slate-800 dark:text-slate-200">
                          {proc.name} <span className="text-slate-400">#{proc.pid}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-cyan-600 dark:text-cyan-400">
                          {proc.cpuPct.toFixed(1)}% CPU · {proc.memPct.toFixed(1)}% MEM
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              Select any host row or click Inspect on a device card to view live telemetry, processes, and historical performance.
            </div>
          )}
        </div>
      </div>

      {/* Register Host Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-host-title"
            className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id="register-host-title" className="font-display font-semibold text-base text-slate-900 dark:text-slate-100">
                Register Python Monitoring Agent
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Close registration modal"
                className="text-slate-500 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!registeredResult ? (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label htmlFor="reg-name" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Host Alias Name
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. prod-worker-05"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reg-hostname" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Local Hostname
                    </label>
                    <input
                      id="reg-hostname"
                      type="text"
                      value={hostname}
                      onChange={(e) => setHostname(e.target.value)}
                      placeholder="worker-05.internal"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-os" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Operating System
                    </label>
                    <input
                      id="reg-os"
                      type="text"
                      value={os}
                      onChange={(e) => setOs(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="reg-arch" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Arch
                    </label>
                    <input
                      id="reg-arch"
                      type="text"
                      value={architecture}
                      onChange={(e) => setArchitecture(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-ram" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      RAM (GB)
                    </label>
                    <input
                      id="reg-ram"
                      type="number"
                      min={1}
                      value={ramTotalGb}
                      onChange={(e) => setRamTotalGb(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-disk" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Disk (GB)
                    </label>
                    <input
                      id="reg-disk"
                      type="number"
                      min={1}
                      value={diskTotalGb}
                      onChange={(e) => setDiskTotalGb(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                {formError && <p className="text-xs text-red-500">{formError}</p>}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-60"
                  >
                    {submitting ? 'Registering…' : 'Issue Agent Credential'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                  Host <span className="font-semibold">{registeredResult.host.name}</span> registered. Store this one-time agent key securely—only its SHA-256 hash is persisted on the server.
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Agent Launch Command
                  </div>
                  <pre className="rounded-lg bg-slate-950 text-cyan-300 p-3 text-[11px] font-mono overflow-x-auto">
                    {registeredResult.instructions}
                  </pre>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyCommand(registeredResult.instructions)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy Command'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 text-white"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
