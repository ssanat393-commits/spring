import type { HostRecord, MetricPoint } from '../types';

export interface PersonalDeviceAnalytics {
  hostId: string;
  hostName: string;
  sampleCount: number;
  avgCpuPct: number;
  peakCpuPct: number;
  avgRamPct: number;
  peakRamPct: number;
  avgNetRxKbps: number;
  currentRttMs: number | null;
  networkQuality: 'Excellent' | 'Good' | 'Fair' | 'Slow' | 'Unknown';
  powerSummary: string;
  recommendations: string[];
}

export function isPersonalDeviceHost(host: HostRecord): boolean {
  if (host.isDemo) return false;
  return (
    Boolean(host.deviceMeta) ||
    host.agentVersion.includes('browser-probe') ||
    host.agentVersion.includes('mobile-probe')
  );
}

export function classifyNetworkQuality(
  rttMs: number | null | undefined
): PersonalDeviceAnalytics['networkQuality'] {
  if (rttMs === null || rttMs === undefined || !Number.isFinite(rttMs)) return 'Unknown';
  if (rttMs <= 60) return 'Excellent';
  if (rttMs <= 140) return 'Good';
  if (rttMs <= 280) return 'Fair';
  return 'Slow';
}

export function analyzePersonalDeviceTelemetry(
  host: HostRecord,
  history: MetricPoint[]
): PersonalDeviceAnalytics {
  const points = history.filter((m) => m.hostId === host.id);
  const sampleCount = points.length;

  const cpuValues = sampleCount > 0 ? points.map((p) => p.cpuPct) : [host.cpuPct];
  const ramValues = sampleCount > 0 ? points.map((p) => p.ramPct) : [host.ramPct];
  const rxValues = sampleCount > 0 ? points.map((p) => p.netRxKbps) : [host.netRxKbps];

  const avgCpuPct = Number(
    (cpuValues.reduce((sum, v) => sum + v, 0) / cpuValues.length).toFixed(1)
  );
  const peakCpuPct = Number(Math.max(...cpuValues).toFixed(1));
  const avgRamPct = Number(
    (ramValues.reduce((sum, v) => sum + v, 0) / ramValues.length).toFixed(1)
  );
  const peakRamPct = Number(Math.max(...ramValues).toFixed(1));
  const avgNetRxKbps = Number(
    (rxValues.reduce((sum, v) => sum + v, 0) / rxValues.length).toFixed(1)
  );

  const currentRttMs = host.deviceMeta?.rttMs ?? null;
  const networkQuality = classifyNetworkQuality(currentRttMs);

  const batteryPct = host.deviceMeta?.batteryPct;
  const batteryCharging = host.deviceMeta?.batteryCharging;
  let powerSummary = 'Desktop AC / Browser restricted';
  if (batteryPct !== null && batteryPct !== undefined) {
    powerSummary = `${batteryPct}%${batteryCharging ? ' · Charging' : ' · On battery'}`;
  }

  const recommendations: string[] = [];

  if (host.status === 'offline') {
    recommendations.push(
      'Device heartbeat timed out. Keep the collector tab open or install the Python psutil agent for background telemetry.'
    );
  }
  if (peakCpuPct >= 85) {
    recommendations.push(
      `Peak load reached ${peakCpuPct}% (mean ${avgCpuPct}%). Close background tabs or heavy local tasks if sluggishness persists.`
    );
  } else {
    recommendations.push(
      `Compute load is healthy at ${avgCpuPct}% average (peak ${peakCpuPct}%).`
    );
  }

  if (avgRamPct >= 85) {
    recommendations.push(
      `Heap allocation pressure is elevated (${avgRamPct}% avg). Reloading long-lived tabs frees browser memory.`
    );
  }

  if (currentRttMs !== null && currentRttMs > 200) {
    recommendations.push(
      `SaaS round-trip latency is ${currentRttMs} ms (${networkQuality}). Switch to a lower-latency Wi-Fi/5G link if telemetry updates lag.`
    );
  } else if (currentRttMs !== null) {
    recommendations.push(
      `Tier-2 link is responsive at ${currentRttMs} ms RTT (${networkQuality}).`
    );
  }

  if (batteryPct !== null && batteryPct !== undefined && batteryPct <= 20 && !batteryCharging) {
    recommendations.push(
      `Battery is low (${batteryPct}% and discharging). Connect a charger to avoid OS power-throttling telemetry intervals.`
    );
  }

  return {
    hostId: host.id,
    hostName: host.name,
    sampleCount,
    avgCpuPct,
    peakCpuPct,
    avgRamPct,
    peakRamPct,
    avgNetRxKbps,
    currentRttMs,
    networkQuality,
    powerSummary,
    recommendations,
  };
}
