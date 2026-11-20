import { useState } from 'react';
import { FlaskConical, Power, RotateCcw, Zap } from 'lucide-react';
import type { HostRecord, NavPageId } from '../../../shared/types';
import { api } from '../../services/api';

interface DemoModeViewProps {
  hosts: HostRecord[];
  demoModeEnabled: boolean;
  onToggleDemoMode: (enabled: boolean) => Promise<void>;
  onRefresh: () => void;
  onNavigate: (page: NavPageId) => void;
}

export function DemoModeView({
  hosts,
  demoModeEnabled,
  onToggleDemoMode,
  onRefresh,
  onNavigate,
}: DemoModeViewProps) {
  const demoHosts = hosts.filter((h) => h.isDemo);
  const [targetHostId, setTargetHostId] = useState(demoHosts[0]?.id ?? 'demo-host-01');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const effectiveTarget = demoHosts.some((h) => h.id === targetHostId)
    ? targetHostId
    : demoHosts[0]?.id ?? 'demo-host-01';

  const handleTrigger = async (scenario: string, label: string) => {
    setBusyAction(scenario);
    setStatusNote(null);
    try {
      await api.triggerDemoIncident(effectiveTarget, scenario);
      setStatusNote(`Triggered "${label}" on ${effectiveTarget}. Check Alerts & Incidents or Overview.`);
      onRefresh();
    } finally {
      setBusyAction(null);
    }
  };

  const handleHostToggle = async (hostId: string, currentlyOffline: boolean) => {
    setBusyAction(hostId);
    try {
      await api.setDemoHostState(hostId, !currentlyOffline);
      onRefresh();
    } finally {
      setBusyAction(null);
    }
  };

  const handleReset = async () => {
    setBusyAction('reset');
    setStatusNote(null);
    try {
      await api.resetDemoFleet();
      setStatusNote('Demo fleet, metrics, alerts, and Egress Proof samples reset to baseline.');
      onRefresh();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="rounded-xl border border-purple-500/30 bg-white dark:bg-[#0D1424] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-purple-500" />
            <h2 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100">
              Hackathon Demo Mode Control Center
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Run the entire CICADA 2026 platform with 4 live simulated hosts without installing a local agent. All simulated records are strictly isolated and labeled <span className="font-mono font-semibold text-purple-500">DEMO DATA</span>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onToggleDemoMode(!demoModeEnabled)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              demoModeEnabled
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
            }`}
          >
            {demoModeEnabled ? 'Demo Mode: Enabled' : 'Enable Demo Mode'}
          </button>

          <button
            type="button"
            onClick={handleReset}
            disabled={busyAction === 'reset'}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Demo Fleet</span>
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-cyan-500/25 bg-white dark:bg-[#0D1424] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-600 dark:text-slate-300">
          Ready to monitor actual servers or workstations instead of synthetic <span className="font-mono text-purple-500">DEMO DATA</span>? Mint a signed Two-Tier Authenticated Collector Link in Hosts and disable Demo Mode.
        </div>
        <button
          type="button"
          onClick={() => onNavigate('hosts')}
          className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors whitespace-nowrap"
        >
          Pair Real Device Collector
        </button>
      </div>

      {statusNote && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-cyan-700 dark:text-cyan-300">
          <span>{statusNote}</span>
          <button
            type="button"
            onClick={() => onNavigate('alerts')}
            className="font-semibold underline"
          >
            Open Alerts & Incidents
          </button>
        </div>
      )}

      {/* Trigger Sample Incidents */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Trigger Sample Incidents
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Inject threshold violations to test live alerts, WebSocket updates, and Gemini root-cause analysis.
            </p>
          </div>
          <select
            aria-label="Target demo host for incident injection"
            value={effectiveTarget}
            onChange={(e) => setTargetHostId(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          >
            {demoHosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} (DEMO DATA)
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { id: 'cpu_spike', label: 'Trigger Critical CPU Spike', detail: '96.4% saturation' },
            { id: 'memory_leak', label: 'Trigger Memory Exhaustion', detail: '95.1% RAM usage' },
            { id: 'disk_full', label: 'Trigger Low Disk Space', detail: '92.8% capacity' },
            { id: 'network_spike', label: 'Trigger Network Anomaly', detail: '118.7 Mbps burst' },
          ].map((sc) => (
            <button
              key={sc.id}
              type="button"
              disabled={!demoModeEnabled || busyAction !== null}
              onClick={() => handleTrigger(sc.id, sc.label)}
              className="text-left p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-purple-500/50 bg-slate-50 dark:bg-[#070B14] transition-colors disabled:opacity-50"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <Zap className="w-3.5 h-3.5 text-purple-500" />
                <span>{sc.label}</span>
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                {sc.detail}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Simulated Hosts Online/Offline Control */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Simulated Fleet Power & Connectivity Controls (DEMO DATA)
          </h3>
        </div>
        <div className="divide-y divide-slate-200 dark:divide-slate-800/60">
          {demoHosts.map((host) => {
            const isOffline = host.status === 'offline';
            return (
              <div
                key={host.id}
                className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {host.name}{' '}
                    <span className="font-mono text-[10px] text-purple-500 ml-1">DEMO DATA</span>
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                    CPU {host.cpuPct.toFixed(1)}% · RAM {host.ramPct.toFixed(1)}% · Disk{' '}
                    {host.diskPct.toFixed(1)}%
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!demoModeEnabled || busyAction === host.id}
                  onClick={() => handleHostToggle(host.id, isOffline)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    isOffline
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-500/15 text-red-700 dark:text-red-300'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{isOffline ? 'Bring Host Online' : 'Simulate Offline'}</span>
                </button>
              </div>
            );
          })}
          {demoHosts.length === 0 && (
            <div className="px-5 py-6 text-xs text-slate-500 dark:text-slate-400">
              Enable Demo Mode above to view and control the 4 simulated hosts.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
