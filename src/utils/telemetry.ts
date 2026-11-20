import type { MetricPoint } from '../../shared/types';

export interface AggregatedMetricPoint {
  timestamp: string;
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  netRxKbps: number;
  netTxKbps: number;
}

export function aggregateMetricsByTimestamp(points: MetricPoint[]): AggregatedMetricPoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
  );

  const buckets = new Map<string, { ts: string; updates: MetricPoint[] }>();
  for (const pt of sorted) {
    const ms = Date.parse(pt.timestamp);
    const bucketKey = Number.isNaN(ms) ? pt.timestamp : String(Math.floor(ms / 3000) * 3000);
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, { ts: pt.timestamp, updates: [pt] });
    } else {
      existing.updates.push(pt);
    }
  }

  const latestByHost = new Map<string, MetricPoint>();
  const result: AggregatedMetricPoint[] = [];

  for (const bucket of buckets.values()) {
    for (const pt of bucket.updates) {
      latestByHost.set(pt.hostId, pt);
    }
    const active = Array.from(latestByHost.values());
    const count = Math.max(1, active.length);
    const totals = active.reduce(
      (acc, pt) => ({
        cpu: acc.cpu + pt.cpuPct,
        ram: acc.ram + pt.ramPct,
        disk: acc.disk + pt.diskPct,
        rx: acc.rx + pt.netRxKbps,
        tx: acc.tx + pt.netTxKbps,
      }),
      { cpu: 0, ram: 0, disk: 0, rx: 0, tx: 0 }
    );

    result.push({
      timestamp: bucket.ts,
      cpuPct: Number((totals.cpu / count).toFixed(1)),
      ramPct: Number((totals.ram / count).toFixed(1)),
      diskPct: Number((totals.disk / count).toFixed(1)),
      netRxKbps: Number((totals.rx / count).toFixed(1)),
      netTxKbps: Number((totals.tx / count).toFixed(1)),
    });
  }

  return result;
}
