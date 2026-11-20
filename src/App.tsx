import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiAnalysisOutput,
  AlertIncident,
  AppSettings,
  BlockedFieldLogEntry,
  DataExportRecord,
  EgressAuditRecord,
  HostRecord,
  MetricPoint,
  NavPageId,
  PrivacyControls,
} from '../shared/types';
import { DEFAULT_THRESHOLDS } from '../shared/alerts/rules';
import { DEFAULT_PRIVACY_CONTROLS } from '../shared/privacy/sanitizer';
import { api } from './services/api';
import { isPersonalDeviceHost } from '../shared/personal/insights';
import {
  collectRealBrowserTelemetrySample,
  detectWorkstationProfile,
} from './services/browserDeviceCollector';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { OverviewView } from './components/views/OverviewView';
import { LiveMonitoringView } from './components/views/LiveMonitoringView';
import { HostsView } from './components/views/HostsView';
import { Tier2ControlPlaneView } from './components/views/Tier2ControlPlaneView';
import { AlertsView } from './components/views/AlertsView';
import { AiInsightsView } from './components/views/AiInsightsView';
import { EgressProofView } from './components/views/EgressProofView';
import { ReportsView } from './components/views/ReportsView';
import { SettingsView } from './components/views/SettingsView';
import { DemoModeView } from './components/views/DemoModeView';
import { ConnectDevicesView } from './components/views/ConnectDevicesView';
import { MobileCollectorView } from './components/views/MobileCollectorView';

const FALLBACK_SETTINGS: AppSettings = {
  profile: {
    displayName: 'SecOps Lead',
    email: 'ops@cicada.local',
    role: 'Principal Observability Engineer',
    organization: 'CICADA Security Operations',
  },
  monitoringIntervalSec: 3,
  retentionDays: 30,
  theme: 'dark',
  demoModeEnabled: true,
  thresholds: DEFAULT_THRESHOLDS,
  privacy: DEFAULT_PRIVACY_CONTROLS,
  agentConfig: {
    heartbeatIntervalSec: 15,
    collectProcessArgsLocally: true,
    localSqliteBufferMaxMb: 128,
  },
};

export default function App() {
  const [pairToken, setPairToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('pairToken');
  });
  const [pairCode, setPairCode] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('c') || params.get('code');
  });
  const [pairMode, setPairMode] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('pair') === '1' || Boolean(params.get('c') || params.get('code'));
  });
  const isMobileCollectorSession = Boolean(pairToken || pairMode);
  const [activePage, setActivePage] = useState<NavPageId>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [hosts, setHosts] = useState<HostRecord[]>([]);
  const [alerts, setAlerts] = useState<AlertIncident[]>([]);
  const [audits, setAudits] = useState<EgressAuditRecord[]>([]);
  const [blockedFields, setBlockedFields] = useState<BlockedFieldLogEntry[]>([]);
  const [exportsHistory, setExportsHistory] = useState<DataExportRecord[]>([]);
  const [fleetHistory, setFleetHistory] = useState<MetricPoint[]>([]);
  const [insights, setInsights] = useState<AiAnalysisOutput[]>([]);
  const [settings, setSettings] = useState<AppSettings>(FALLBACK_SETTINGS);
  const [geminiConfigured, setGeminiConfigured] = useState(false);

  const [selectedHostId, setSelectedHostId] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [localCollectorRunning, setLocalCollectorRunning] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [browserProbeActive, setBrowserProbeActive] = useState(false);
  const [browserProbeHostId, setBrowserProbeHostId] = useState<string | null>(null);
  const [browserProbeRttMs, setBrowserProbeRttMs] = useState<number | null>(null);
  const browserProbeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserProbeCredsRef = useRef<{ hostId: string; agentKey: string; startedMs: number } | null>(null);
  const autoResumedProbeRef = useRef(false);

  const fetchAllData = useCallback(async () => {
    try {
      const [settingsRes, hostsRes, alertsRes, logsRes, metricsRes, aiRes] = await Promise.all([
        api.getSettings(),
        api.getHosts(),
        api.getAlerts(),
        api.getEgressLogs(),
        api.getMetricsHistory(undefined, 120),
        api.getAiInsights(),
      ]);

      setSettings(settingsRes.settings);
      setGeminiConfigured(settingsRes.geminiConfigured);
      setHosts(hostsRes.hosts);
      if (typeof hostsRes.localCollectorRunning === 'boolean') {
        setLocalCollectorRunning(hostsRes.localCollectorRunning);
      }
      setAlerts(alertsRes.alerts);
      setAudits(logsRes.audits);
      setBlockedFields(logsRes.blockedFields);
      setExportsHistory(logsRes.exports);
      setFleetHistory(metricsRes.metrics);
      setInsights(aiRes.insights);
      setSelectedHostId((prev) => {
        if (hostsRes.hosts.some((h) => h.id === prev)) return prev;
        const preferredPersonal = hostsRes.hosts.find(
          (h) => isPersonalDeviceHost(h) && h.status !== 'offline'
        );
        return preferredPersonal?.id ?? hostsRes.hosts[0]?.id ?? '';
      });
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to reach CICADA backend.');
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isMobileCollectorSession) return;
    fetchAllData();
  }, [fetchAllData, isMobileCollectorSession]);

  // Sync Tailwind dark class with settings.theme
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  // Real-time WebSocket subscription with auto-reconnect
  useEffect(() => {
    if (isMobileCollectorSession) return;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!closed) setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as { type: string; payload: any };
          if (msg.type === 'metrics:tick' && Array.isArray(msg.payload?.hosts)) {
            const updates = new Map<string, any>(
              msg.payload.hosts.map((u: any) => [u.id, u])
            );
            setHosts((prev) =>
              prev.map((h) => {
                const u = updates.get(h.id);
                if (!u) return h;
                return {
                  ...h,
                  cpuPct: u.cpuPct,
                  ramPct: u.ramPct,
                  diskPct: u.diskPct,
                  netRxKbps: u.netRxKbps,
                  netTxKbps: u.netTxKbps,
                  uptimeSeconds: u.uptimeSeconds,
                  status: u.status,
                  healthScore: u.healthScore,
                  deviceMeta: u.deviceMeta ?? h.deviceMeta,
                  lastHeartbeat: u.timestamp,
                };
              })
            );
            const tickPoints: MetricPoint[] = msg.payload.hosts.map((u: any) => ({
              hostId: u.id,
              timestamp: u.timestamp,
              cpuPct: u.cpuPct,
              ramPct: u.ramPct,
              diskPct: u.diskPct,
              netRxKbps: u.netRxKbps,
              netTxKbps: u.netTxKbps,
              uptimeSeconds: u.uptimeSeconds,
              isDemo: Boolean(u.isDemo),
            }));
            if (tickPoints.length > 0) {
              setFleetHistory((prev) => [...prev.slice(-120), ...tickPoints]);
            }
          } else if (
            msg.type === 'alert:created' ||
            msg.type === 'alert:updated' ||
            msg.type === 'host:updated' ||
            msg.type === 'host:registered' ||
            msg.type === 'host:removed' ||
            msg.type === 'demo:reset' ||
            msg.type === 'demo:toggled'
          ) {
            fetchAllData();
          } else if (msg.type === 'egress:logged') {
            api.getEgressLogs().then((res) => {
              setAudits(res.audits);
              setBlockedFields(res.blockedFields);
              setExportsHistory(res.exports);
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (closed) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [fetchAllData, isMobileCollectorSession]);

  const handleAcknowledgeAlert = async (id: string) => {
    await api.acknowledgeAlert(id);
    fetchAllData();
  };

  const handleResolveAlert = async (id: string) => {
    await api.resolveAlert(id);
    fetchAllData();
  };

  const handleDismissAlert = async (id: string) => {
    await api.dismissAlert(id);
    fetchAllData();
  };

  const handleSaveSettings = async (next: AppSettings) => {
    const res = await api.saveSettings(next);
    setSettings(res.settings);
    fetchAllData();
  };

  const handleSavePrivacyControls = async (privacy: PrivacyControls) => {
    await handleSaveSettings({ ...settings, privacy });
  };

  const handleToggleDemoMode = async (enabled: boolean) => {
    await api.toggleDemoMode(enabled);
    await fetchAllData();
  };

  const handleToggleLocalCollector = async (enabled: boolean) => {
    const res = await api.toggleTier1LocalCollector(enabled);
    setLocalCollectorRunning(res.localCollectorRunning);
    await fetchAllData();
  };

  const LOCAL_DEVICE_STORAGE_KEY = 'cicada_local_device_creds';

  const stopBrowserProbe = useCallback(() => {
    if (browserProbeTimerRef.current) {
      clearInterval(browserProbeTimerRef.current);
      browserProbeTimerRef.current = null;
    }
    const creds = browserProbeCredsRef.current;
    browserProbeCredsRef.current = null;
    setBrowserProbeActive(false);

    try {
      const raw = localStorage.getItem(LOCAL_DEVICE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { hostId: string; agentKey: string; active?: boolean };
        localStorage.setItem(
          LOCAL_DEVICE_STORAGE_KEY,
          JSON.stringify({ ...parsed, active: false })
        );
      }
    } catch {
      // ignore storage errors
    }

    if (creds) {
      api
        .setAgentOffline(creds.hostId, creds.agentKey)
        .then(() => fetchAllData())
        .catch(() => {
          // ignore if host already removed
        });
    }
  }, [fetchAllData]);

  const pushBrowserSample = useCallback(async () => {
    const creds = browserProbeCredsRef.current;
    if (!creds) return;
    const sample = await collectRealBrowserTelemetrySample(creds.startedMs);
    setBrowserProbeRttMs(sample.rttMs);
    await api.ingestCollectorTelemetry(creds.agentKey, {
      hostId: creds.hostId,
      hostname: 'workstation-redacted',
      os: sample.os,
      kernel: `${sample.cores} logical cores`,
      uptimeSeconds: sample.uptimeSeconds,
      cpuPct: sample.cpuPct,
      ramPct: sample.ramPct,
      ramUsedGb: sample.ramUsedGb,
      ramTotalGb: sample.ramTotalGb,
      diskPct: sample.diskPct,
      diskUsedGb: sample.diskUsedGb,
      diskTotalGb: sample.diskTotalGb,
      netRxKbps: sample.netRxKbps,
      netTxKbps: sample.netTxKbps,
      loadAvg: [Number((sample.cpuPct / 25).toFixed(2)), Number((sample.rttMs / 100).toFixed(2)), 0],
      processes: sample.sensors,
      deviceMeta: sample.deviceMeta,
      localIp: 'redacted-by-browser',
      operatorUser: 'redacted-by-browser',
      homeDir: 'redacted-by-browser',
    });
  }, []);

  const startBrowserProbe = useCallback(async () => {
    if (browserProbeTimerRef.current) {
      clearInterval(browserProbeTimerRef.current);
      browserProbeTimerRef.current = null;
    }

    let savedCreds: { hostId: string; agentKey: string; active?: boolean } | null = null;
    try {
      const raw = localStorage.getItem(LOCAL_DEVICE_STORAGE_KEY);
      if (raw) {
        savedCreds = JSON.parse(raw) as { hostId: string; agentKey: string; active?: boolean };
      }
    } catch {
      savedCreds = null;
    }

    let creds: { hostId: string; agentKey: string } | null = null;
    if (savedCreds?.hostId && savedCreds?.agentKey) {
      browserProbeCredsRef.current = {
        hostId: savedCreds.hostId,
        agentKey: savedCreds.agentKey,
        startedMs: Date.now(),
      };
      try {
        await pushBrowserSample();
        creds = { hostId: savedCreds.hostId, agentKey: savedCreds.agentKey };
      } catch {
        // Saved host no longer exists or key rotated -> register a fresh local device host below
        browserProbeCredsRef.current = null;
      }
    }

    if (!creds) {
      const profile = detectWorkstationProfile();
      const reg = await api.registerBrowserProbe({
        label: profile.defaultLabel,
        os: profile.os,
        architecture: profile.architecture,
        ramTotalGb: profile.ramTotalGb,
        cores: profile.cores,
        agentVersion: profile.agentVersion,
        deviceMeta: {
          deviceKind: profile.deviceKind,
          screen: profile.screen,
          cores: profile.cores,
        },
      });
      creds = { hostId: reg.hostId, agentKey: reg.agentKey };
      browserProbeCredsRef.current = {
        hostId: reg.hostId,
        agentKey: reg.agentKey,
        startedMs: Date.now(),
      };
      await pushBrowserSample();
    }

    try {
      localStorage.setItem(
        LOCAL_DEVICE_STORAGE_KEY,
        JSON.stringify({ hostId: creds.hostId, agentKey: creds.agentKey, active: true })
      );
    } catch {
      // ignore storage errors
    }

    setBrowserProbeHostId(creds.hostId);
    setBrowserProbeActive(true);
    browserProbeTimerRef.current = setInterval(() => {
      pushBrowserSample().catch(() => {
        // ignore transient network errors during probe
      });
    }, 4500);
    await fetchAllData();
  }, [fetchAllData, pushBrowserSample]);

  useEffect(() => {
    if (autoResumedProbeRef.current || initialLoading || pairToken || pairMode) return;
    autoResumedProbeRef.current = true;
    try {
      const raw = localStorage.getItem(LOCAL_DEVICE_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { hostId?: string; agentKey?: string; active?: boolean };
        if (saved.active && saved.hostId && saved.agentKey && hosts.some((h) => h.id === saved.hostId)) {
          startBrowserProbe().catch(() => {
            // ignore auto-resume error
          });
        }
      }
    } catch {
      // ignore malformed local storage
    }
  }, [hosts, initialLoading, pairMode, pairToken, startBrowserProbe]);

  useEffect(() => {
    return () => {
      if (browserProbeTimerRef.current) clearInterval(browserProbeTimerRef.current);
    };
  }, []);

  const openAlertsCount = alerts.filter(
    (a) => a.status === 'open' || a.status === 'acknowledged'
  ).length;

  if (pairToken || pairMode) {
    return (
      <MobileCollectorView
        pairToken={pairToken}
        initialCode={pairCode}
        onExitToDashboard={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('pairToken');
          url.searchParams.delete('pair');
          url.searchParams.delete('c');
          url.searchParams.delete('code');
          window.history.replaceState({}, '', url.toString());
          setPairToken(null);
          setPairCode(null);
          setPairMode(false);
          setActivePage('connect-devices');
          fetchAllData();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 dark:bg-[#070B14] dark:text-slate-100">
      <Sidebar
        activePage={activePage}
        onSelectPage={setActivePage}
        openAlertsCount={openAlertsCount}
        demoModeEnabled={settings.demoModeEnabled}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activePage={activePage}
          wsConnected={wsConnected}
          demoModeEnabled={settings.demoModeEnabled}
          operatorName={settings.profile.displayName}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onNavigate={setActivePage}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {initialLoading ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-12 text-center text-sm text-slate-500 dark:text-slate-400">
              Loading CICADA 2026 Smart Observability telemetry…
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-600 dark:text-red-300 flex items-center justify-between gap-4">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={fetchAllData}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {activePage === 'overview' && (
                <OverviewView
                  hosts={hosts}
                  alerts={alerts}
                  audits={audits}
                  fleetHistory={fleetHistory}
                  demoModeEnabled={settings.demoModeEnabled}
                  onToggleDemoMode={handleToggleDemoMode}
                  onNavigate={setActivePage}
                  onSelectHostForMonitoring={(hostId) => {
                    setSelectedHostId(hostId);
                    setActivePage('monitoring');
                  }}
                  onAcknowledgeAlert={handleAcknowledgeAlert}
                  onResolveAlert={handleResolveAlert}
                />
              )}

              {activePage === 'monitoring' && (
                <LiveMonitoringView
                  hosts={hosts}
                  selectedHostId={selectedHostId}
                  onSelectHostId={setSelectedHostId}
                  onNavigate={setActivePage}
                />
              )}

              {activePage === 'hosts' && (
                <HostsView
                  hosts={hosts}
                  demoModeEnabled={settings.demoModeEnabled}
                  localCollectorRunning={localCollectorRunning}
                  browserProbeActive={browserProbeActive}
                  browserProbeHostId={browserProbeHostId}
                  onToggleLocalCollector={handleToggleLocalCollector}
                  onStartBrowserProbe={startBrowserProbe}
                  onStopBrowserProbe={stopBrowserProbe}
                  onToggleDemoMode={handleToggleDemoMode}
                  onRefresh={fetchAllData}
                  onSelectForLive={(hostId) => {
                    setSelectedHostId(hostId);
                    setActivePage('monitoring');
                  }}
                  onOpenConnectDevices={() => setActivePage('connect-devices')}
                />
              )}

              {activePage === 'connect-devices' && (
                <ConnectDevicesView
                  hosts={hosts}
                  localCollectorRunning={localCollectorRunning}
                  browserProbeActive={browserProbeActive}
                  browserProbeHostId={browserProbeHostId}
                  onToggleLocalCollector={handleToggleLocalCollector}
                  onStartBrowserProbe={startBrowserProbe}
                  onStopBrowserProbe={stopBrowserProbe}
                  onRefresh={fetchAllData}
                  onSelectForLive={(hostId) => {
                    setSelectedHostId(hostId);
                    setActivePage('monitoring');
                  }}
                  onNavigate={setActivePage}
                />
              )}

              {activePage === 'tier2-saas' && (
                <Tier2ControlPlaneView
                  browserProbeActive={browserProbeActive}
                  browserProbeHostId={browserProbeHostId}
                  browserProbeRttMs={browserProbeRttMs}
                  onStartBrowserProbe={startBrowserProbe}
                  onStopBrowserProbe={stopBrowserProbe}
                  onNavigate={setActivePage}
                  onSelectHostForLive={(hostId) => {
                    setSelectedHostId(hostId);
                    setActivePage('monitoring');
                  }}
                  onRefreshGlobal={fetchAllData}
                />
              )}

              {activePage === 'alerts' && (
                <AlertsView
                  alerts={alerts}
                  thresholds={settings.thresholds}
                  onAcknowledge={handleAcknowledgeAlert}
                  onResolve={handleResolveAlert}
                  onDismiss={handleDismissAlert}
                  onOpenSettings={() => setActivePage('settings')}
                />
              )}

              {activePage === 'ai-insights' && (
                <AiInsightsView
                  hosts={hosts}
                  alerts={alerts}
                  insights={insights}
                  geminiConfigured={geminiConfigured}
                  onRefreshInsights={fetchAllData}
                />
              )}

              {activePage === 'egress-proof' && (
                <EgressProofView
                  hosts={hosts}
                  settings={settings}
                  audits={audits}
                  blockedFields={blockedFields}
                  exportsHistory={exportsHistory}
                  onSavePrivacyControls={handleSavePrivacyControls}
                  onRefreshLogs={fetchAllData}
                />
              )}

              {activePage === 'reports' && (
                <ReportsView
                  hosts={hosts}
                  alerts={alerts}
                  audits={audits}
                  onRefreshLogs={fetchAllData}
                />
              )}

              {activePage === 'settings' && (
                <SettingsView
                  settings={settings}
                  geminiConfigured={geminiConfigured}
                  onSaveSettings={handleSaveSettings}
                />
              )}

              {activePage === 'demo-mode' && (
                <DemoModeView
                  hosts={hosts}
                  demoModeEnabled={settings.demoModeEnabled}
                  onToggleDemoMode={handleToggleDemoMode}
                  onRefresh={fetchAllData}
                  onNavigate={setActivePage}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
