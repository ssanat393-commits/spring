import type { CollectorSourceType, ProcessEntry } from '../types';

export interface ProcStatTotals {
  idle: number;
  total: number;
}

export interface ProcNetTotals {
  rxBytes: number;
  txBytes: number;
}

export function classifyCollectorSource(agentVersion: string): CollectorSourceType {
  const normalized = agentVersion.toLowerCase();
  if (normalized.includes('tier1-os') || normalized.includes('linux-runtime')) {
    return 'linux_os_collector';
  }
  if (normalized.includes('mobile-probe')) {
    return 'mobile_probe';
  }
  if (normalized.includes('browser-probe')) {
    return 'browser_probe';
  }
  if (normalized.includes('cicada-py')) {
    return 'python_psutil';
  }
  return 'registered_agent';
}

export function parseProcStatTotals(content: string): ProcStatTotals | null {
  const firstLine = content.split('\n').find((line) => line.startsWith('cpu '));
  if (!firstLine) return null;
  const parts = firstLine
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((n) => Number(n));
  if (parts.length < 4 || parts.some((n) => Number.isNaN(n))) return null;
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((acc, v) => acc + v, 0);
  return { idle, total };
}

export function computeCpuUsageFromProcStat(
  previous: ProcStatTotals,
  current: ProcStatTotals
): number {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return 0;
  const usage = ((totalDelta - Math.max(0, idleDelta)) / totalDelta) * 100;
  return Number(Math.min(100, Math.max(0, usage)).toFixed(1));
}

export function parseProcNetDevTotals(content: string): ProcNetTotals {
  let rxBytes = 0;
  let txBytes = 0;
  const lines = content.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const iface = line.slice(0, colonIdx).trim();
    if (!iface || iface === 'lo') continue;
    const cols = line
      .slice(colonIdx + 1)
      .trim()
      .split(/\s+/)
      .map((v) => Number(v));
    if (cols.length >= 9 && !Number.isNaN(cols[0]) && !Number.isNaN(cols[8])) {
      rxBytes += cols[0];
      txBytes += cols[8];
    }
  }
  return { rxBytes, txBytes };
}

export function parsePsOutput(stdout: string, limit = 10): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  const lines = stdout.trim().split('\n').slice(1);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    entries.push({
      pid: Number(match[1]),
      name: match[2],
      cpuPct: Number(match[3]),
      memPct: Number(match[4]),
      user: match[5],
      cmdline: match[6].slice(0, 220),
    });
    if (entries.length >= limit) break;
  }
  return entries;
}
