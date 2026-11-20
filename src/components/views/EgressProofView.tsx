import { useEffect, useState } from 'react';
import { Lock, Send, ShieldCheck } from 'lucide-react';
import type {
  AppSettings,
  BlockedFieldLogEntry,
  DataExportRecord,
  EgressAuditRecord,
  EgressProofResult,
  HostRecord,
  PrivacyControls,
} from '../../../shared/types';
import { api } from '../../services/api';
import { formatBytes, formatDateTime } from '../../utils/format';

interface EgressProofViewProps {
  hosts: HostRecord[];
  settings: AppSettings;
  audits: EgressAuditRecord[];
  blockedFields: BlockedFieldLogEntry[];
  exportsHistory: DataExportRecord[];
  onSavePrivacyControls: (privacy: PrivacyControls) => Promise<void>;
  onRefreshLogs: () => void;
}

export function EgressProofView({
  hosts,
  settings,
  audits,
  blockedFields,
  exportsHistory,
  onSavePrivacyControls,
  onRefreshLogs,
}: EgressProofViewProps) {
  const [selectedHostId, setSelectedHostId] = useState(hosts[0]?.id ?? '');
  const [proof, setProof] = useState<EgressProofResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [transmitting, setTransmitting] = useState(false);
  const [transmitNotice, setTransmitNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeLogTab, setActiveLogTab] = useState<'transmissions' | 'blocked' | 'exports'>(
    'transmissions'
  );
  const [customSecretProbe, setCustomSecretProbe] = useState(
    'python3 /Users/operator/app.py --token=ghp_probeSecret9988776655443322'
  );

  const effectiveHostId = hosts.some((h) => h.id === selectedHostId)
    ? selectedHostId
    : hosts[0]?.id ?? '';

  const loadPreview = async (hostId: string) => {
    if (!hostId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getEgressPreview(hostId);
      setProof(res.proof);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Egress Proof preview.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview(effectiveHostId);
  }, [effectiveHostId, settings.privacy]);

  const handleToggleControl = async (key: keyof PrivacyControls) => {
    const next: PrivacyControls = {
      ...settings.privacy,
      [key]: !settings.privacy[key],
    };
    await onSavePrivacyControls(next);
  };

  const handleTestProbe = async () => {
    if (!proof) return;
    setError(null);
    const modifiedRaw = {
      ...proof.rawLocal,
      processes: [
        {
          pid: 9999,
          name: 'privacy-probe-test',
          cpuPct: 4.2,
          memPct: 1.8,
          user: proof.rawLocal.operatorUser,
          cmdline: customSecretProbe,
        },
        ...proof.rawLocal.processes.slice(0, 3),
      ],
    };
    const res = await api.testEgressSanitization(modifiedRaw);
    setProof(res.proof);
    setTransmitNotice('Probe executed locally: inspect Stage 2 and Stage 4 below.');
  };

  const handleExecuteTransmission = async () => {
    if (!proof) return;
    setTransmitting(true);
    setTransmitNotice(null);
    setError(null);
    try {
      const res = await api.transmitSanitizedEgress({ rawTelemetry: proof.rawLocal });
      setProof(res.proof);
      setTransmitNotice(
        res.status === 'transmitted'
          ? `Verified sanitized payload transmitted (Audit ID: ${res.auditId}).`
          : `Transmission blocked locally by Cloud Sync policy (Audit ID: ${res.auditId}).`
      );
      onRefreshLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Egress transmission failed.');
    } finally {
      setTransmitting(false);
    }
  };

  const latestAudit = audits[0] ?? null;
  const totalBlockedCount = blockedFields.length;

  return (
    <div className="space-y-6">
      {/* Privacy Firewall Header & Controls */}
      <div className="rounded-xl border border-cyan-500/30 bg-white dark:bg-[#0D1424] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-cyan-500" />
              <h2 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100">
                Egress Proof – Zero-Trust Privacy Firewall
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
              Prove what stays local versus what crosses your network boundary. Every raw username, home directory, token, CLI secret, and internal IP is stripped before cloud transmission or Gemini analysis.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Select host for Egress Proof"
              value={effectiveHostId}
              onChange={(e) => setSelectedHostId(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-100"
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.isDemo ? 'DEMO DATA' : 'Real Agent'})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleExecuteTransmission}
              disabled={transmitting || !proof}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{transmitting ? 'Logging Egress…' : 'Transmit Sanitized Egress'}</span>
            </button>
          </div>
        </div>

        {/* Configurable Cloud Data-Sharing Controls */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
            Live Cloud Data-Sharing Controls
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {(
              [
                { key: 'cloudSyncEnabled', label: 'Cloud Telemetry Sync' },
                { key: 'shareHostnames', label: 'Share Real Hostnames' },
                { key: 'shareProcessNames', label: 'Share Process Names' },
                { key: 'shareProcessArgs', label: 'Share Sanitized Args' },
                { key: 'shareNetworkRates', label: 'Share Network Rates' },
                { key: 'redactUsernames', label: 'Redact Usernames & Emails' },
                { key: 'redactFilePaths', label: 'Redact Personal File Paths' },
                { key: 'redactCredentials', label: 'Filter Tokens & Passwords' },
              ] as Array<{ key: keyof PrivacyControls; label: string }>
            ).map((ctrl) => {
              const checked = settings.privacy[ctrl.key];
              return (
                <label
                  key={ctrl.key}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B14] cursor-pointer"
                >
                  <span className="text-slate-700 dark:text-slate-300">{ctrl.label}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggleControl(ctrl.key)}
                    className="accent-cyan-500 w-4 h-4"
                  />
                </label>
              );
            })}
          </div>
        </div>

        {/* Interactive Leak Probe */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center gap-2">
          <label htmlFor="egress-probe-input" className="text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
            Test Secret Redaction:
          </label>
          <input
            id="egress-probe-input"
            type="text"
            value={customSecretProbe}
            onChange={(e) => setCustomSecretProbe(e.target.value)}
            className="flex-1 min-w-[260px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={handleTestProbe}
            disabled={!proof}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10"
          >
            Run Sanitizer Probe
          </button>
        </div>

        {transmitNotice && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            {transmitNotice}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Stage KPIs: Stages 2, 3, 5 */}
      {proof && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">1. Local Raw Snapshot</div>
            <div className="text-xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
              {formatBytes(proof.rawByteSize)}
            </div>
            <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
              Contains local paths & credentials
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">2. Sensitive Fields Detected</div>
            <div className="text-xl font-mono font-bold tabular-nums text-red-600 dark:text-red-400 mt-1">
              {proof.sensitiveFieldsDetected.length}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {proof.fieldsSanitizedCount} sanitized · {proof.blockedFieldsCount} blocked
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">4. Approved Cloud Payload</div>
            <div className="text-xl font-mono font-bold tabular-nums text-cyan-600 dark:text-cyan-400 mt-1">
              {formatBytes(proof.sanitizedByteSize)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Policy {proof.approvedPayload.privacyPolicyHash}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">5. Last Verified Egress</div>
            <div className="text-sm font-mono font-semibold text-emerald-600 dark:text-emerald-400 mt-2 truncate">
              {latestAudit ? latestAudit.payloadHash : 'None yet'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {totalBlockedCount} blocked field entries logged
            </div>
          </div>
        </div>
      )}

      {/* Side-by-Side Raw Local vs Approved Cloud Payload */}
      {loading && !proof ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-8 text-center text-xs text-slate-500">
          Computing privacy diff…
        </div>
      ) : proof ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="rounded-xl border border-amber-500/30 bg-white dark:bg-[#0D1424] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Stage 1: Raw Data Collected Locally (Never Leaves Host)</span>
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-500">SQLite Local Only</span>
            </div>
            <pre className="p-4 text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto max-h-80 leading-relaxed">
              {JSON.stringify(proof.rawLocal, null, 2)}
            </pre>
          </div>

          <div className="rounded-xl border border-cyan-500/30 bg-white dark:bg-[#0D1424] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Stage 4 & 5: Sanitized Payload Approved for Transmission</span>
                </h3>
              </div>
              <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                {settings.privacy.cloudSyncEnabled ? 'Ready for Egress' : 'Held Locally'}
              </span>
            </div>
            <pre className="p-4 text-[11px] font-mono text-cyan-800 dark:text-cyan-200 overflow-x-auto max-h-80 leading-relaxed">
              {JSON.stringify(proof.approvedPayload, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}

      {/* Stage 2 & 3: Sensitive Fields Detected & Sanitized */}
      {proof && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Stage 2 & 3: Sensitive Fields Detected and Sanitized
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Masked snippets prove detection without exposing plaintext secrets in the audit UI.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Field Path</th>
                  <th className="py-2.5 px-3 font-medium">Category</th>
                  <th className="py-2.5 px-3 font-medium">Rule Applied</th>
                  <th className="py-2.5 px-3 font-medium">Action</th>
                  <th className="py-2.5 px-4 font-medium">Transformation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {proof.sensitiveFieldsDetected.map((det) => (
                  <tr key={det.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/35">
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-800 dark:text-slate-200">
                      {det.fieldPath}
                    </td>
                    <td className="py-2.5 px-3 capitalize text-slate-600 dark:text-slate-300">
                      {det.category.replace('_', ' ')}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{det.ruleName}</td>
                    <td className="py-2.5 px-3 uppercase font-mono text-[11px] font-semibold">
                      <span
                        className={
                          det.action === 'blocked'
                            ? 'text-red-600 dark:text-red-400'
                            : det.action === 'hashed'
                              ? 'text-purple-600 dark:text-purple-400'
                              : 'text-cyan-600 dark:text-cyan-400'
                        }
                      >
                        {det.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {det.originalSnippet} → <span className="text-emerald-600 dark:text-emerald-400">{det.replacement}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stage 6: Audit Logs, Blocked Fields Log, and Export History */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Stage 6: Egress Transmission History & Compliance Audit Logs
          </h3>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/70">
            {(
              [
                { id: 'transmissions', label: `Transmission Log (${audits.length})` },
                { id: 'blocked', label: `Blocked Fields (${blockedFields.length})` },
                { id: 'exports', label: `Export History (${exportsHistory.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveLogTab(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  activeLogTab === tab.id
                    ? 'bg-white dark:bg-[#0D1424] text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          {activeLogTab === 'transmissions' && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Timestamp</th>
                  <th className="py-2.5 px-3 font-medium">Host</th>
                  <th className="py-2.5 px-3 font-medium">Destination</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium text-right">Sanitized / Blocked</th>
                  <th className="py-2.5 px-4 font-medium text-right">Payload Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {audits.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/35">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatDateTime(a.timestamp)}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                      {a.hostName} {a.isDemo && <span className="text-[10px] font-mono text-purple-500 ml-1">DEMO DATA</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      {a.destination}
                    </td>
                    <td className="py-2.5 px-3 font-medium">
                      <span
                        className={
                          a.status === 'transmitted'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }
                      >
                        {a.status === 'transmitted' ? 'Transmitted (Sanitized)' : 'Blocked Locally'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {a.fieldsSanitized} / {a.fieldsBlocked} ({formatBytes(a.payloadBytes)})
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {a.payloadHash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeLogTab === 'blocked' && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Timestamp</th>
                  <th className="py-2.5 px-3 font-medium">Field Path</th>
                  <th className="py-2.5 px-3 font-medium">Category</th>
                  <th className="py-2.5 px-3 font-medium">Rule</th>
                  <th className="py-2.5 px-4 font-medium">Redacted Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {blockedFields.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/35">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatDateTime(b.timestamp)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-900 dark:text-slate-100">
                      {b.fieldPath}
                    </td>
                    <td className="py-2.5 px-3 capitalize text-slate-600 dark:text-slate-300">
                      {b.category.replace('_', ' ')}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{b.ruleName}</td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {b.redactedPreview}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeLogTab === 'exports' && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Timestamp</th>
                  <th className="py-2.5 px-3 font-medium">Report Type</th>
                  <th className="py-2.5 px-3 font-medium">Format</th>
                  <th className="py-2.5 px-3 font-medium text-right">Rows</th>
                  <th className="py-2.5 px-4 font-medium">Exported By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {exportsHistory.map((ex) => (
                  <tr key={ex.id}>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatDateTime(ex.timestamp)}
                    </td>
                    <td className="py-2.5 px-3 capitalize font-medium text-slate-900 dark:text-slate-100">
                      {ex.reportType}
                    </td>
                    <td className="py-2.5 px-3 uppercase font-mono">{ex.format}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{ex.rowCount}</td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{ex.exportedBy}</td>
                  </tr>
                ))}
                {exportsHistory.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500 dark:text-slate-400">
                      No report exports recorded yet. Export a CSV from the Reports view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
