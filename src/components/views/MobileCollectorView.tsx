import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Activity,
  BatteryCharging,
  CheckCircle2,
  Cpu,
  KeyRound,
  Pause,
  Play,
  ShieldCheck,
  Smartphone,
  Unlink,
  Wifi,
} from 'lucide-react';
import { ApiError, api } from '../../services/api';
import {
  collectRealBrowserTelemetrySample,
  detectWorkstationProfile,
  type BrowserWorkstationSample,
} from '../../services/browserDeviceCollector';

interface MobileCollectorViewProps {
  pairToken?: string | null;
  initialCode?: string | null;
  onExitToDashboard: () => void;
}

interface PairedDeviceCreds {
  hostId: string;
  agentKey: string;
  hostName: string;
  pairedAt: string;
  codeUsed?: string;
}

const ACTIVE_CODE_PAIR_STORAGE_KEY = 'cicada_mobile_active_device';

function safeGetStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors in private browsing or restricted mobile WebViews
  }
}

function safeRemoveStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

export function MobileCollectorView({
  pairToken,
  initialCode,
  onExitToDashboard,
}: MobileCollectorViewProps) {
  const normalizedInitialCode = initialCode ? initialCode.trim().toUpperCase() : null;
  const storageKey = pairToken
    ? `cicada_paired_device_${pairToken.slice(-24)}`
    : normalizedInitialCode
      ? `cicada_paired_code_${normalizedInitialCode}`
      : ACTIVE_CODE_PAIR_STORAGE_KEY;

  const profile = detectWorkstationProfile();

  const [creds, setCreds] = useState<PairedDeviceCreds | null>(() => {
    const raw = safeGetStorage(storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PairedDeviceCreds;
    } catch {
      return null;
    }
  });
  const [pairing, setPairing] = useState(
    Boolean((pairToken || normalizedInitialCode) && !creds)
  );
  const [pairingCodeInput, setPairingCodeInput] = useState(normalizedInitialCode || '');
  const [deviceLabelInput, setDeviceLabelInput] = useState('');
  const [submittingCode, setSubmittingCode] = useState(false);

  const [streaming, setStreaming] = useState(true);
  const [packetsSent, setPacketsSent] = useState(0);
  const [lastSample, setLastSample] = useState<BrowserWorkstationSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedMsRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptedAutoClaimRef = useRef<string | null>(null);

  // Automatic token-based pairing (?pairToken=...) OR compact QR short-code auto-claim (?c=CIC-XXXX)
  useEffect(() => {
    const autoKey = pairToken
      ? `token:${pairToken}`
      : normalizedInitialCode
        ? `code:${normalizedInitialCode}`
        : null;
    if (!autoKey || creds) {
      setPairing(false);
      return;
    }
    if (attemptedAutoClaimRef.current === autoKey) {
      return;
    }
    attemptedAutoClaimRef.current = autoKey;

    let cancelled = false;
    setPairing(true);
    setError(null);

    const req = pairToken
      ? api.enrollWithToken(pairToken, {
          hostname: `${profile.defaultLabel}.client`,
          os: profile.os,
          kernel: `${profile.cores} cores`,
          architecture: profile.architecture,
          ramTotalGb: profile.ramTotalGb,
          diskTotalGb: 16,
          agentVersion: profile.agentVersion,
          deviceMeta: {
            deviceKind: profile.deviceKind,
            screen: profile.screen,
            cores: profile.cores,
          },
        })
      : api.enrollWithCode(normalizedInitialCode!, {
          hostname: `${profile.defaultLabel}.client`,
          os: profile.os,
          kernel: `${profile.cores} cores`,
          architecture: profile.architecture,
          ramTotalGb: profile.ramTotalGb,
          diskTotalGb: 16,
          agentVersion: profile.agentVersion,
          deviceMeta: {
            deviceKind: profile.deviceKind,
            screen: profile.screen,
            cores: profile.cores,
          },
        });

    req
      .then((res) => {
        if (cancelled) return;
        const nextCreds: PairedDeviceCreds = {
          hostId: res.hostId,
          agentKey: res.agentKey,
          hostName: res.host.name,
          pairedAt: new Date().toISOString(),
          codeUsed: normalizedInitialCode ?? undefined,
        };
        safeSetStorage(storageKey, JSON.stringify(nextCreds));
        setCreds(nextCreds);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to pair this device.');
        }
      })
      .finally(() => {
        if (!cancelled) setPairing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    creds,
    normalizedInitialCode,
    pairToken,
    profile.agentVersion,
    profile.architecture,
    profile.cores,
    profile.defaultLabel,
    profile.deviceKind,
    profile.os,
    profile.ramTotalGb,
    profile.screen,
    storageKey,
  ]);

  const handlePairWithCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedCode = pairingCodeInput.trim().toUpperCase();
    if (!trimmedCode) {
      setError('Enter the 7-character pairing code from Connect Devices (e.g. CIC-7X4M).');
      return;
    }

    setSubmittingCode(true);
    try {
      const customLabel = deviceLabelInput.trim();
      const res = await api.enrollWithCode(trimmedCode, {
        deviceLabel: customLabel.length >= 2 ? customLabel : undefined,
        hostname: `${customLabel || profile.defaultLabel}.client`,
        os: profile.os,
        kernel: `${profile.cores} cores`,
        architecture: profile.architecture,
        ramTotalGb: profile.ramTotalGb,
        diskTotalGb: 16,
        agentVersion: profile.agentVersion,
        deviceMeta: {
          deviceKind: profile.deviceKind,
          screen: profile.screen,
          cores: profile.cores,
        },
      });
      const nextCreds: PairedDeviceCreds = {
        hostId: res.hostId,
        agentKey: res.agentKey,
        hostName: res.host.name,
        pairedAt: new Date().toISOString(),
        codeUsed: trimmedCode,
      };
      safeSetStorage(storageKey, JSON.stringify(nextCreds));
      setCreds(nextCreds);
      setPacketsSent(0);
      setStreaming(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pairing code could not be claimed.');
    } finally {
      setSubmittingCode(false);
    }
  };

  const handleUnpairDevice = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const current = creds;
    setCreds(null);
    setPacketsSent(0);
    setLastSample(null);
    setError(null);
    safeRemoveStorage(storageKey);
    if (current) {
      api.setAgentOffline(current.hostId, current.agentKey).catch(() => {
        // ignore if already deleted on server
      });
    }
  };

  const sendTelemetryFrame = useCallback(async () => {
    if (!creds) return;
    try {
      const sample = await collectRealBrowserTelemetrySample(startedMsRef.current);
      setLastSample(sample);
      await api.ingestCollectorTelemetry(creds.agentKey, {
        hostId: creds.hostId,
        hostname: 'mobile-client-redacted',
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
        localIp: 'redacted-by-device',
        operatorUser: 'redacted-by-device',
        homeDir: 'redacted-by-device',
      });
      setPacketsSent((n) => n + 1);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        safeRemoveStorage(storageKey);
        setCreds(null);
        setStreaming(false);
        setError(
          'This device credential was revoked or removed on the dashboard (HTTP 403). Enter a new pairing code below to reconnect.'
        );
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to transmit device sample.');
    }
  }, [creds, storageKey]);

  useEffect(() => {
    if (!creds || !streaming) return;
    sendTelemetryFrame();
    timerRef.current = setInterval(sendTelemetryFrame, 4000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [creds, streaming, sendTelemetryFrame]);

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-cyan-500/30 bg-[#0D1424] p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 via-blue-600 to-purple-600 flex items-center justify-center text-white shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold text-sm truncate">CICADA 2026 Tier-1 Device</div>
              <div className="text-[11px] text-cyan-400 font-mono truncate">
                {creds ? creds.hostName : 'Authenticated Device Pairing'}
              </div>
            </div>
          </div>

          <span
            className={`text-xs font-mono font-semibold shrink-0 ${
              pairing || submittingCode
                ? 'text-amber-400'
                : creds && streaming
                  ? 'text-emerald-400'
                  : creds
                    ? 'text-slate-400'
                    : 'text-cyan-400'
            }`}
          >
            {pairing || submittingCode
              ? 'PAIRING'
              : creds && streaming
                ? 'STREAMING'
                : creds
                  ? 'PAUSED'
                  : 'READY'}
          </span>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {pairing && !creds && (
          <div className="rounded-xl border border-cyan-500/30 bg-[#070B14] p-5 text-center space-y-2">
            <div className="text-xs font-semibold text-cyan-300">
              Claiming pairing credential &amp; provisioning X-Agent-Key…
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {normalizedInitialCode ? `Code ${normalizedInitialCode}` : 'Signed QR token'}
            </div>
          </div>
        )}

        {!creds && !pairing && (
          <form onSubmit={handlePairWithCode} className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-[#070B14] p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                <KeyRound className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Enter Pairing Code from Connect Devices</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Mint a pairing code inside <span className="text-slate-200 font-medium">Connect Devices</span> on your primary workstation, then enter it here to bind this phone, tablet, or laptop.
              </p>

              <div>
                <label htmlFor="pair-code-input" className="block text-[11px] font-medium text-slate-300 mb-1">
                  Pairing Code
                </label>
                <input
                  id="pair-code-input"
                  type="text"
                  value={pairingCodeInput}
                  onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
                  placeholder="CIC-7X4M"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Pairing code"
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1424] px-3 py-2.5 text-sm font-mono tracking-wider text-cyan-300 placeholder:text-slate-600 focus:outline-hidden focus:border-cyan-500"
                />
              </div>

              <div>
                <label htmlFor="pair-device-name" className="block text-[11px] font-medium text-slate-300 mb-1">
                  Device Name (Optional Override)
                </label>
                <input
                  id="pair-device-name"
                  type="text"
                  value={deviceLabelInput}
                  onChange={(e) => setDeviceLabelInput(e.target.value)}
                  placeholder={`Default from code or ${profile.defaultLabel}`}
                  aria-label="Device name"
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1424] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-hidden focus:border-cyan-500"
                />
              </div>

              <div className="text-[11px] text-slate-400 font-mono pt-1">
                Detected: {profile.os} · {profile.cores} cores · {profile.screen}
              </div>
            </div>

            <button
              type="submit"
              disabled={submittingCode}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-60"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{submittingCode ? 'Pairing Device…' : 'Pair & Start Streaming'}</span>
            </button>
          </form>
        )}

        {creds && (
          <>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <div>
                Paired as <span className="font-mono font-semibold">{creds.hostId}</span> ·{' '}
                <span className="font-mono tabular-nums">{packetsSent}</span> sanitized packets sent
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-800 bg-[#070B14] p-3.5">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Device Load</span>
                </div>
                <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-cyan-400">
                  {lastSample ? `${lastSample.cpuPct.toFixed(1)}%` : '—'}
                </div>
                <div className="text-[11px] text-slate-400">{profile.cores} cores</div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#070B14] p-3.5">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Activity className="w-3.5 h-3.5 text-purple-400" />
                  <span>Memory / Heap</span>
                </div>
                <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-slate-100">
                  {lastSample ? `${lastSample.ramPct.toFixed(1)}%` : '—'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {lastSample ? `${lastSample.ramTotalGb} GB est.` : profile.os}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#070B14] p-3.5">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Battery</span>
                </div>
                <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-slate-100">
                  {lastSample?.deviceMeta.batteryPct !== null &&
                  lastSample?.deviceMeta.batteryPct !== undefined
                    ? `${lastSample.deviceMeta.batteryPct}%`
                    : 'N/A'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {lastSample?.deviceMeta.batteryCharging === true
                    ? 'Charging'
                    : lastSample?.deviceMeta.batteryCharging === false
                      ? 'On battery'
                      : 'Browser restricted'}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#070B14] p-3.5">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Wifi className="w-3.5 h-3.5 text-blue-400" />
                  <span>SaaS RTT / Net</span>
                </div>
                <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-slate-100">
                  {lastSample ? `${lastSample.rttMs} ms` : '—'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {lastSample?.deviceMeta.networkType || 'https'} · {profile.screen}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="rounded-lg border border-slate-800 bg-[#070B14] p-3 flex items-start gap-2 text-[11px] text-slate-400">
          <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            Egress Proof active: IP addresses, user identifiers, and personal paths are scrubbed locally before sending via <code className="font-mono text-slate-200">X-Agent-Key</code>. Keep this tab open to stream live metrics into <span className="text-slate-200 font-semibold">Connect Devices</span> &amp; <span className="text-slate-200 font-semibold">Hosts</span>.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {creds && (
            <>
              <button
                type="button"
                onClick={() => setStreaming((s) => !s)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors whitespace-nowrap"
              >
                {streaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{streaming ? 'Pause Stream' : 'Resume Stream'}</span>
              </button>
              {!pairToken && (
                <button
                  type="button"
                  onClick={handleUnpairDevice}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Switch Code</span>
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={onExitToDashboard}
            className="flex-1 px-4 py-2.5 rounded-lg text-xs font-semibold border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Open Full Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
