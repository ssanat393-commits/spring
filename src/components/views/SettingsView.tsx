import { useEffect, useState, type FormEvent } from 'react';
import { Check, Save } from 'lucide-react';
import type { AppSettings } from '../../../shared/types';
import { getFirebaseRuntimeStatus } from '../../services/firebase';

interface SettingsViewProps {
  settings: AppSettings;
  geminiConfigured: boolean;
  onSaveSettings: (next: AppSettings) => Promise<void>;
}

export function SettingsView({ settings, geminiConfigured, onSaveSettings }: SettingsViewProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const firebaseStatus = getFirebaseRuntimeStatus();

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    try {
      await onSaveSettings(draft);
      setSavedMsg('Settings persisted to SQLite.');
      setTimeout(() => setSavedMsg(null), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Platform & Observability Configuration
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Changes apply immediately across threshold evaluation, Egress Proof sanitization, and SQLite retention.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-60"
        >
          {savedMsg ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{saving ? 'Saving…' : savedMsg || 'Save Settings'}</span>
        </button>
      </div>

      {/* User Profile & Theme */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Operator Profile & Theme
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="set-name" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Display Name
              </label>
              <input
                id="set-name"
                type="text"
                value={draft.profile.displayName}
                onChange={(e) =>
                  setDraft({ ...draft, profile: { ...draft.profile, displayName: e.target.value } })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="set-email" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Email
              </label>
              <input
                id="set-email"
                type="email"
                value={draft.profile.email}
                onChange={(e) =>
                  setDraft({ ...draft, profile: { ...draft.profile, email: e.target.value } })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="set-role" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Role
              </label>
              <input
                id="set-role"
                type="text"
                value={draft.profile.role}
                onChange={(e) =>
                  setDraft({ ...draft, profile: { ...draft.profile, role: e.target.value } })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="set-theme" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Theme Preference
              </label>
              <select
                id="set-theme"
                value={draft.theme}
                onChange={(e) => setDraft({ ...draft, theme: e.target.value as 'dark' | 'light' })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="dark">Dark Navy (Default)</option>
                <option value="light">Light Slate</option>
              </select>
            </div>
          </div>
        </section>

        {/* Monitoring Intervals, Retention & Agent Config */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Monitoring, Retention & Agent Defaults
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="set-interval" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Polling Interval (sec)
              </label>
              <input
                id="set-interval"
                type="number"
                min={2}
                max={300}
                value={draft.monitoringIntervalSec}
                onChange={(e) =>
                  setDraft({ ...draft, monitoringIntervalSec: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="set-retention" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                SQLite Retention (days)
              </label>
              <input
                id="set-retention"
                type="number"
                min={1}
                max={365}
                value={draft.retentionDays}
                onChange={(e) => setDraft({ ...draft, retentionDays: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="set-hb" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Agent Heartbeat (sec)
              </label>
              <input
                id="set-hb"
                type="number"
                min={5}
                max={120}
                value={draft.agentConfig.heartbeatIntervalSec}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    agentConfig: {
                      ...draft.agentConfig,
                      heartbeatIntervalSec: Number(e.target.value),
                    },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="set-buf" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Agent Local Buffer (MB)
              </label>
              <input
                id="set-buf"
                type="number"
                min={16}
                max={2048}
                value={draft.agentConfig.localSqliteBufferMaxMb}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    agentConfig: {
                      ...draft.agentConfig,
                      localSqliteBufferMaxMb: Number(e.target.value),
                    },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </section>
      </div>

      {/* Alert Thresholds */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Alert Thresholds
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {(
            [
              { key: 'cpuWarning', label: 'CPU Warning (%)' },
              { key: 'cpuCritical', label: 'CPU Critical (%)' },
              { key: 'ramWarning', label: 'RAM Warning (%)' },
              { key: 'ramCritical', label: 'RAM Critical (%)' },
              { key: 'diskWarning', label: 'Disk Warning (%)' },
              { key: 'diskCritical', label: 'Disk Critical (%)' },
              { key: 'networkSpikeKbps', label: 'Network Spike (Kbps)' },
              { key: 'offlineTimeoutSec', label: 'Offline Timeout (sec)' },
            ] as const
          ).map((field) => (
            <div key={field.key}>
              <label
                htmlFor={`thr-${field.key}`}
                className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
              >
                {field.label}
              </label>
              <input
                id={`thr-${field.key}`}
                type="number"
                value={draft.thresholds[field.key]}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    thresholds: { ...draft.thresholds, [field.key]: Number(e.target.value) },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Cloud & AI Integration Status (Read-Only Environment Inspection) */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          External Services & Privacy Controls
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14]">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Google Gemini Server Integration
            </div>
            <div className="mt-1 text-slate-600 dark:text-slate-300">
              Status:{' '}
              <span className={geminiConfigured ? 'text-emerald-500 font-medium' : 'text-amber-500 font-medium'}>
                {geminiConfigured ? 'Configured via server GEMINI_API_KEY' : 'Not configured in server environment'}
              </span>
            </div>
            <div className="mt-1 text-slate-500 dark:text-slate-400">
              API keys are managed strictly through server secrets and never exposed to browser code.
            </div>
          </div>

          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14]">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Firebase Auth & Firestore Sync
            </div>
            <div className="mt-1 text-slate-600 dark:text-slate-300">
              Status:{' '}
              <span className={firebaseStatus.configured ? 'text-emerald-500 font-medium' : 'text-cyan-500 font-medium'}>
                {firebaseStatus.configured
                  ? `Connected (${firebaseStatus.projectId})`
                  : 'Running Local SQLite & Session Auth'}
              </span>
            </div>
            <div className="mt-1 text-slate-500 dark:text-slate-400">
              Set VITE_FIREBASE_* environment variables to enable cloud multi-tenant sync.
            </div>
          </div>
        </div>
      </section>
    </form>
  );
}
