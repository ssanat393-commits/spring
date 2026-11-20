import type {
  AlertIncident,
  AlertSeverity,
  AlertStatus,
  AlertThresholds,
  HostRecord,
  MetricPoint,
} from '../types';

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  cpuWarning: 80,
  cpuCritical: 92,
  ramWarning: 82,
  ramCritical: 94,
  diskWarning: 80,
  diskCritical: 90,
  networkSpikeKbps: 45000,
  offlineTimeoutSec: 90,
};

export interface MetricEvaluationInput {
  host: Pick<HostRecord, 'id' | 'name' | 'isDemo'>;
  current: Pick<MetricPoint, 'cpuPct' | 'ramPct' | 'diskPct' | 'netRxKbps' | 'netTxKbps' | 'timestamp'>;
  previous?: Pick<MetricPoint, 'cpuPct' | 'ramPct'>;
  thresholds: AlertThresholds;
}

export type CandidateAlert = Omit<AlertIncident, 'id' | 'acknowledgedAt' | 'resolvedAt' | 'acknowledgedBy'>;

export function evaluateMetricAlerts(input: MetricEvaluationInput): CandidateAlert[] {
  const { host, current, previous, thresholds } = input;
  const alerts: CandidateAlert[] = [];

  if (current.cpuPct >= thresholds.cpuCritical) {
    alerts.push({
      hostId: host.id,
      hostName: host.name,
      metricType: 'cpu',
      severity: 'critical',
      status: 'open',
      title: `Critical CPU saturation on ${host.name}`,
      description: `CPU utilization reached ${current.cpuPct.toFixed(1)}%, exceeding the critical threshold of ${thresholds.cpuCritical}%.`,
      observedValue: `${current.cpuPct.toFixed(1)}%`,
      thresholdValue: `${thresholds.cpuCritical}%`,
      createdAt: current.timestamp,
      isDemo: host.isDemo,
    });
  } else if (current.cpuPct >= thresholds.cpuWarning) {
    alerts.push({
      hostId: host.id,
      hostName: host.name,
      metricType: 'cpu',
      severity: 'high',
      status: 'open',
      title: `Elevated CPU load on ${host.name}`,
      description: `CPU utilization reached ${current.cpuPct.toFixed(1)}%, exceeding the warning threshold of ${thresholds.cpuWarning}%.`,
      observedValue: `${current.cpuPct.toFixed(1)}%`,
      thresholdValue: `${thresholds.cpuWarning}%`,
      createdAt: current.timestamp,
      isDemo: host.isDemo,
    });
  }

  if (current.ramPct >= thresholds.ramCritical) {
    alerts.push({
      hostId: host.id,
      hostName: host.name,
      metricType: 'ram',
      severity: 'critical',
      status: 'open',
      title: `Critical memory pressure on ${host.name}`,
      description: `Memory consumption reached ${current.ramPct.toFixed(1)}%, threatening OOM eviction.`,
      observedValue: `${current.ramPct.toFixed(1)}%`,
      thresholdValue: `${thresholds.ramCritical}%`,
      createdAt: current.timestamp,
      isDemo: host.isDemo,
    });
  } else if (current.ramPct >= thresholds.ramWarning) {
    alerts.push({
      hostId: host.id,
      hostName: host.name,
      metricType: 'ram',
      severity: 'medium',
      status: 'open',
      title: `High memory utilization on ${host.name}`,
      description: `Memory consumption reached ${current.ramPct.toFixed(1)}%, above warning limit (${thresholds.ramWarning}%).`,
      observedValue: `${current.ramPct.toFixed(1)}%`,
      thresholdValue: `${thresholds.ramWarning}%`,
      createdAt: current.timestamp,
      isDemo: host.isDemo,
    });
  }

  if (current.diskPct >= thresholds.diskCritical) {
    alerts.push({
      hostId: host.id,
      hostName: host.name,
      metricType: 'disk',
      severity: 'critical',
      status: 'open',
      title: `Critical disk capacity warning on ${host.name}`,
      description: `Root filesystem usage reached ${current.diskPct.toFixed(1)}%, risking write failures.`,
      observedValue: `${current.diskPct.toFixed(1)}%`,
      thresholdValue: `${thresholds.diskCritical}%`,
      createdAt: current.timestamp,
      isDemo: host.isDemo,
    });
  } else if (current.diskPct >= thresholds.diskWarning) {
    alerts.push({
      hostId: host.id,
      hostName: host.name,
      metricType: 'disk',
      severity: 'low',
      status: 'open',
      title: `Disk capacity approaching threshold on ${host.name}`,
      description: `Filesystem usage at ${current.diskPct.toFixed(1)}% (warning threshold ${thresholds.diskWarning}%).`,
      observedValue: `${current.diskPct.toFixed(1)}%`,
      thresholdValue: `${thresholds.diskWarning}%`,
      createdAt: current.timestamp,
      isDemo: host.isDemo,
    });
  }

  const totalNetKbps = current.netRxKbps + current.netTxKbps;
  if (totalNetKbps >= thresholds.networkSpikeKbps) {
    alerts.push({
      hostId: host.id,
      hostName: host.name,
      metricType: 'network',
      severity: 'high',
      status: 'open',
      title: `Network bandwidth anomaly on ${host.name}`,
      description: `Combined ingress/egress throughput surged to ${(totalNetKbps / 1000).toFixed(1)} Mbps.`,
      observedValue: `${Math.round(totalNetKbps)} Kbps`,
      thresholdValue: `${thresholds.networkSpikeKbps} Kbps`,
      createdAt: current.timestamp,
      isDemo: host.isDemo,
    });
  }

  if (previous) {
    const cpuDelta = current.cpuPct - previous.cpuPct;
    if (cpuDelta >= 35 && current.cpuPct >= 65) {
      alerts.push({
        hostId: host.id,
        hostName: host.name,
        metricType: 'anomaly',
        severity: 'medium',
        status: 'open',
        title: `Sudden CPU jump detected on ${host.name}`,
        description: `CPU jumped +${cpuDelta.toFixed(1)}% within a single polling interval.`,
        observedValue: `+${cpuDelta.toFixed(1)}%`,
        thresholdValue: '+35.0% delta',
        createdAt: current.timestamp,
        isDemo: host.isDemo,
      });
    }
  }

  return alerts;
}

export function isHostHeartbeatStale(
  lastHeartbeatIso: string,
  nowMs: number,
  offlineTimeoutSec: number
): boolean {
  const lastMs = Date.parse(lastHeartbeatIso);
  if (Number.isNaN(lastMs)) return true;
  return nowMs - lastMs > offlineTimeoutSec * 1000;
}

export function findStaleRealHostIds(
  hosts: Array<Pick<HostRecord, 'id' | 'isDemo' | 'status' | 'lastHeartbeat'>>,
  nowMs: number,
  offlineTimeoutSec: number,
  excludeHostIds: string[] = []
): string[] {
  const excluded = new Set(excludeHostIds);
  return hosts
    .filter(
      (h) =>
        !h.isDemo &&
        !excluded.has(h.id) &&
        h.status !== 'offline' &&
        isHostHeartbeatStale(h.lastHeartbeat, nowMs, offlineTimeoutSec)
    )
    .map((h) => h.id);
}

export function computeHostHealthScore(
  status: HostRecord['status'],
  cpuPct: number,
  ramPct: number,
  diskPct: number
): number {
  if (status === 'offline') return 0;
  const cpuPenalty = Math.max(0, cpuPct - 60) * 0.7;
  const ramPenalty = Math.max(0, ramPct - 65) * 0.6;
  const diskPenalty = Math.max(0, diskPct - 75) * 0.8;
  const raw = 100 - cpuPenalty - ramPenalty - diskPenalty;
  return Math.max(12, Math.min(100, Math.round(raw)));
}

export function canTransitionAlertStatus(from: AlertStatus, to: AlertStatus): boolean {
  if (from === to) return false;
  if (from === 'resolved' || from === 'dismissed') {
    return to === 'open';
  }
  return true;
}

export function severityWeight(severity: AlertSeverity): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}
