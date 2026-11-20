import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  getAppSettings,
  getDb,
  getHostById,
  hashAgentKey,
  listHosts,
  recordTier2IngestEvent,
} from '../db/sqlite';
import {
  computeHostHealthScore,
  evaluateMetricAlerts,
  findStaleRealHostIds,
} from '../../shared/alerts/rules';
import { computePayloadHash, sanitizeTelemetryForEgress } from '../../shared/privacy/sanitizer';
import {
  computeCpuUsageFromProcStat,
  parseProcNetDevTotals,
  parseProcStatTotals,
  parsePsOutput,
  type ProcNetTotals,
  type ProcStatTotals,
} from '../../shared/tier2/metrics';
import type { ProcessEntry, RawLocalTelemetry } from '../../shared/types';
import { broadcastWsEvent } from './realtime';

export const TIER1_RUNTIME_HOST_ID = 'tier1-runtime-host';
const TIER1_CRED_FILE = path.resolve(process.cwd(), 'data', 'tier1-runtime-credentials.json');

let collectorTimer: NodeJS.Timeout | null = null;
let collectorEnabled = true;
let prevProcStat: ProcStatTotals | null = null;
let prevProcNet: ProcNetTotals | null = null;
let prevSampleTs = Date.now();
let runtimeTickCount = 0;

function ensureRuntimeHostAndKey(): string {
  const db = getDb();
  const dir = path.dirname(TIER1_CRED_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existingHost = getHostById(TIER1_RUNTIME_HOST_ID);
  if (existingHost && fs.existsSync(TIER1_CRED_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(TIER1_CRED_FILE, 'utf8')) as { agentKey?: string };
      if (saved.agentKey) return saved.agentKey;
    } catch {
      // regenerate credential below
    }
  }

  const rawAgentKey = `cicada_ag_${crypto.randomBytes(20).toString('hex')}`;
  const keyHash = hashAgentKey(rawAgentKey);
  const nowIso = new Date().toISOString();
  const ramTotalGb = Number((os.totalmem() / 1024 ** 3).toFixed(2));
  const diskInfo = readRootDiskUsageGb(ramTotalGb);

  if (!existingHost) {
    db.prepare(`
      INSERT INTO hosts (
        id, name, hostname, os, kernel, architecture, ip_masked, status, health_score,
        last_heartbeat, uptime_seconds, cpu_pct, ram_pct, ram_used_gb, ram_total_gb,
        disk_pct, disk_used_gb, disk_total_gb, net_rx_kbps, net_tx_kbps, agent_version,
        agent_key_hash, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'redacted-by-tier1', 'online', 100, ?, ?, 0, 0, 0, ?, ?, ?, ?, 0, 0, 'cicada-tier1-os/1.0.0', ?, 0, ?)
    `).run(
      TIER1_RUNTIME_HOST_ID,
      `tier1-${os.hostname().slice(0, 24)}`,
      os.hostname(),
      `${os.type()} ${os.release()}`,
      os.version().slice(0, 60) || os.release(),
      os.arch(),
      nowIso,
      Math.floor(os.uptime()),
      ramTotalGb,
      diskInfo.diskPct,
      diskInfo.usedGb,
      diskInfo.totalGb,
      keyHash,
      nowIso
    );
  } else {
    db.prepare('UPDATE hosts SET agent_key_hash = ?, agent_version = ? WHERE id = ?').run(
      keyHash,
      'cicada-tier1-os/1.0.0',
      TIER1_RUNTIME_HOST_ID
    );
  }

  fs.writeFileSync(
    TIER1_CRED_FILE,
    JSON.stringify({ hostId: TIER1_RUNTIME_HOST_ID, agentKey: rawAgentKey }, null, 2),
    { mode: 0o600 }
  );

  return rawAgentKey;
}

function readRootDiskUsageGb(fallbackGb = 64): { totalGb: number; usedGb: number; diskPct: number } {
  try {
    const stat = fs.statfsSync('/');
    const totalBytes = stat.blocks * stat.bsize;
    const availBytes = stat.bavail * stat.bsize;
    const usedBytes = Math.max(0, totalBytes - availBytes);
    const totalGb = Number(Math.max(1, totalBytes / 1024 ** 3).toFixed(2));
    const usedGb = Number((usedBytes / 1024 ** 3).toFixed(2));
    const rawPct = (usedBytes / Math.max(1, totalBytes)) * 100;
    const diskPct =
      usedBytes > 0 && rawPct < 0.1
        ? Number(rawPct.toFixed(2))
        : Number(Math.min(100, Math.max(0, rawPct)).toFixed(1));
    return { totalGb, usedGb, diskPct };
  } catch {
    return { totalGb: fallbackGb, usedGb: 0, diskPct: 0 };
  }
}

function readLiveCpuPct(): number {
  try {
    const content = fs.readFileSync('/proc/stat', 'utf8');
    const curr = parseProcStatTotals(content);
    if (curr) {
      if (prevProcStat) {
        const pct = computeCpuUsageFromProcStat(prevProcStat, curr);
        prevProcStat = curr;
        return pct;
      }
      prevProcStat = curr;
    }
  } catch {
    // non-Linux fallback below
  }
  const load1 = os.loadavg()[0] ?? 0;
  const cores = Math.max(1, os.cpus().length);
  return Number(Math.min(100, Math.max(0, (load1 / cores) * 100)).toFixed(1));
}

function readLiveNetworkKbps(elapsedSec: number): { rxKbps: number; txKbps: number } {
  try {
    const content = fs.readFileSync('/proc/net/dev', 'utf8');
    const curr = parseProcNetDevTotals(content);
    if (prevProcNet && elapsedSec > 0) {
      const rxDelta = Math.max(0, curr.rxBytes - prevProcNet.rxBytes);
      const txDelta = Math.max(0, curr.txBytes - prevProcNet.txBytes);
      prevProcNet = curr;
      return {
        rxKbps: Number(((rxDelta * 8) / (elapsedSec * 1000)).toFixed(1)),
        txKbps: Number(((txDelta * 8) / (elapsedSec * 1000)).toFixed(1)),
      };
    }
    prevProcNet = curr;
  } catch {
    // ignore if /proc/net/dev is unavailable
  }
  return { rxKbps: 0, txKbps: 0 };
}

function readLiveProcesses(): ProcessEntry[] {
  try {
    const out = execSync('ps -eo pid,comm,pcpu,pmem,user,args --sort=-pcpu | head -n 11', {
      encoding: 'utf8',
      timeout: 1000,
    });
    return parsePsOutput(out, 10);
  } catch {
    return [
      {
        pid: process.pid,
        name: 'node',
        cpuPct: 1.2,
        memPct: Number(((process.memoryUsage().rss / Math.max(1, os.totalmem())) * 100).toFixed(1)),
        user: os.userInfo().username || 'node',
        cmdline: process.argv.join(' ').slice(0, 180),
      },
    ];
  }
}

function collectAndForwardSample(): void {
  if (!collectorEnabled) return;

  const startedAt = Date.now();
  const agentKey = ensureRuntimeHostAndKey();
  const db = getDb();
  const host = getHostById(TIER1_RUNTIME_HOST_ID);
  if (!host) return;

  // Verify local X-Agent-Key credential hash matches Tier 2 registry
  const keyRow = db
    .prepare('SELECT agent_key_hash FROM hosts WHERE id = ?')
    .get(TIER1_RUNTIME_HOST_ID) as { agent_key_hash: string | null } | undefined;
  if (!keyRow || keyRow.agent_key_hash !== hashAgentKey(agentKey)) return;

  const nowMs = Date.now();
  const elapsedSec = Math.max(1, (nowMs - prevSampleTs) / 1000);
  prevSampleTs = nowMs;
  const nowIso = new Date(nowMs).toISOString();

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const ramTotalGb = Number((totalMem / 1024 ** 3).toFixed(2));
  const ramUsedGb = Number((usedMem / 1024 ** 3).toFixed(2));
  const ramPct = Number(Math.min(100, Math.max(0, (usedMem / Math.max(1, totalMem)) * 100)).toFixed(1));
  const disk = readRootDiskUsageGb(host.diskTotalGb);
  const cpuPct = readLiveCpuPct();
  const { rxKbps, txKbps } = readLiveNetworkKbps(elapsedSec);
  const uptimeSeconds = Math.floor(os.uptime());
  const load = os.loadavg().map((v) => Number(v.toFixed(2))) as [number, number, number];
  const processes = readLiveProcesses();

  const interfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  for (const [ifaceName, addrs] of Object.entries(interfaces)) {
    if (ifaceName === 'lo' || !addrs) continue;
    const v4 = addrs.find((a) => a.family === 'IPv4' && !a.internal);
    if (v4) {
      localIp = v4.address;
      break;
    }
  }

  const rawSnapshot: RawLocalTelemetry = {
    hostId: TIER1_RUNTIME_HOST_ID,
    hostAlias: host.name,
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    kernel: os.version().slice(0, 60) || os.release(),
    localIp,
    operatorUser: os.userInfo().username || 'runtime',
    homeDir: os.homedir(),
    uptimeSeconds,
    cpuPct,
    ramPct,
    ramUsedGb,
    ramTotalGb,
    diskPct: disk.diskPct,
    diskUsedGb: disk.usedGb,
    diskTotalGb: disk.totalGb,
    netRxKbps: rxKbps,
    netTxKbps: txKbps,
    loadAvg: load,
    processes,
    collectedAt: nowIso,
    isDemo: false,
  };

  const settings = getAppSettings();
  const prevCpu = host.cpuPct;
  const prevRam = host.ramPct;
  const status =
    cpuPct >= settings.thresholds.cpuCritical || ramPct >= settings.thresholds.ramCritical
      ? 'degraded'
      : 'online';
  const healthScore = computeHostHealthScore(status, cpuPct, ramPct, disk.diskPct);

  // Tier 1 local raw storage
  db.prepare(`
    INSERT INTO raw_local_snapshots (host_id, raw_json, collected_at, is_demo)
    VALUES (?, ?, ?, 0)
    ON CONFLICT(host_id) DO UPDATE SET raw_json = excluded.raw_json, collected_at = excluded.collected_at
  `).run(TIER1_RUNTIME_HOST_ID, JSON.stringify(rawSnapshot), nowIso);

  // Tier 1 Pre-Egress Sanitization -> Tier 2 SaaS Ingest
  const egress = sanitizeTelemetryForEgress(rawSnapshot, settings.privacy);

  db.prepare(`
    UPDATE hosts
    SET status = ?, health_score = ?, last_heartbeat = ?, uptime_seconds = ?,
        cpu_pct = ?, ram_pct = ?, ram_used_gb = ?, ram_total_gb = ?,
        disk_pct = ?, disk_used_gb = ?, disk_total_gb = ?,
        net_rx_kbps = ?, net_tx_kbps = ?
    WHERE id = ?
  `).run(
    status,
    healthScore,
    nowIso,
    uptimeSeconds,
    cpuPct,
    ramPct,
    ramUsedGb,
    ramTotalGb,
    disk.diskPct,
    disk.usedGb,
    disk.totalGb,
    rxKbps,
    txKbps,
    TIER1_RUNTIME_HOST_ID
  );

  db.prepare(`
    INSERT INTO metrics (host_id, timestamp, cpu_pct, ram_pct, disk_pct, net_rx_kbps, net_tx_kbps, uptime_seconds, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(TIER1_RUNTIME_HOST_ID, nowIso, cpuPct, ramPct, disk.diskPct, rxKbps, txKbps, uptimeSeconds);

  // Log Egress Proof audit every 3 ticks so audit history reflects real collector packets without flooding
  runtimeTickCount += 1;
  if (runtimeTickCount === 1 || runtimeTickCount % 3 === 0) {
    const auditId = `aud-real-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const auditStatus = settings.privacy.cloudSyncEnabled ? 'transmitted' : 'blocked_by_policy';
    db.prepare(`
      INSERT INTO egress_audits (
        id, host_id, host_name, timestamp, destination, status, fields_sanitized,
        fields_blocked, payload_bytes, payload_hash, approved_payload_json, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      auditId,
      TIER1_RUNTIME_HOST_ID,
      host.name,
      nowIso,
      settings.privacy.cloudSyncEnabled ? 'tier2-saas-ingest' : 'blocked-locally',
      auditStatus,
      egress.fieldsSanitizedCount,
      egress.blockedFieldsCount,
      egress.sanitizedByteSize,
      computePayloadHash(egress.approvedPayload),
      JSON.stringify(egress.approvedPayload)
    );

    for (const det of egress.sensitiveFieldsDetected.slice(0, 4)) {
      db.prepare(`
        INSERT INTO blocked_fields (id, audit_id, host_id, timestamp, field_path, category, rule_name, redacted_preview, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        `blk-real-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        auditId,
        TIER1_RUNTIME_HOST_ID,
        nowIso,
        det.fieldPath,
        det.category,
        det.ruleName,
        `${det.originalSnippet} -> ${det.replacement}`
      );
    }

    broadcastWsEvent('egress:logged', { auditId, hostId: TIER1_RUNTIME_HOST_ID, status: auditStatus });
  }

  const alerts = evaluateMetricAlerts({
    host: { id: TIER1_RUNTIME_HOST_ID, name: host.name, isDemo: false },
    current: { cpuPct, ramPct, diskPct: disk.diskPct, netRxKbps: rxKbps, netTxKbps: txKbps, timestamp: nowIso },
    previous: { cpuPct: prevCpu, ramPct: prevRam },
    thresholds: settings.thresholds,
  });

  for (const candidate of alerts) {
    const recentOpen = db
      .prepare(
        `SELECT id FROM alerts WHERE host_id = ? AND metric_type = ? AND status IN ('open', 'acknowledged') AND is_demo = 0 LIMIT 1`
      )
      .get(candidate.hostId, candidate.metricType);
    if (!recentOpen) {
      const alertId = `alt-real-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(`
        INSERT INTO alerts (
          id, host_id, host_name, metric_type, severity, status, title, description,
          observed_value, threshold_value, created_at, is_demo
        ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 0)
      `).run(
        alertId,
        candidate.hostId,
        candidate.hostName,
        candidate.metricType,
        candidate.severity,
        candidate.title,
        candidate.description,
        candidate.observedValue,
        candidate.thresholdValue,
        candidate.createdAt
      );
      broadcastWsEvent('alert:created', { ...candidate, id: alertId });
    }
  }

  const ingestEvent = {
    id: `t2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    hostId: TIER1_RUNTIME_HOST_ID,
    hostName: host.name,
    sourceType: 'linux_os_collector' as const,
    authMethod: 'X-Agent-Key (SHA-256)',
    cpuPct,
    ramPct,
    diskPct: disk.diskPct,
    netRxKbps: rxKbps,
    netTxKbps: txKbps,
    fieldsSanitized: egress.fieldsSanitizedCount + egress.blockedFieldsCount,
    ingestLatencyMs: Math.max(1, Date.now() - startedAt),
    status: 'accepted' as const,
    reason: 'Authenticated Tier-1 OS snapshot verified',
    timestamp: nowIso,
  };
  recordTier2IngestEvent(ingestEvent);

  broadcastWsEvent('metrics:tick', {
    hosts: [
      {
        id: TIER1_RUNTIME_HOST_ID,
        cpuPct,
        ramPct,
        diskPct: disk.diskPct,
        netRxKbps: rxKbps,
        netTxKbps: txKbps,
        uptimeSeconds,
        status,
        healthScore,
        timestamp: nowIso,
        isDemo: false,
      },
    ],
    timestamp: nowIso,
  });
  broadcastWsEvent('tier2:ingest', ingestEvent);
}

function reconcileStaleRealHosts(): void {
  const db = getDb();
  const settings = getAppSettings();
  const timeoutSec = Math.min(settings.thresholds.offlineTimeoutSec || 45, 45);
  const exclude = collectorEnabled ? [TIER1_RUNTIME_HOST_ID] : [];
  const staleIds = findStaleRealHostIds(listHosts(false), Date.now(), timeoutSec, exclude);
  if (staleIds.length === 0) return;

  const updateStmt = db.prepare('UPDATE hosts SET status = ?, health_score = 0 WHERE id = ?');
  for (const id of staleIds) {
    updateStmt.run('offline', id);
    broadcastWsEvent('host:updated', { hostId: id, status: 'offline' });
  }
}

export function startTier1LocalCollector(): void {
  collectorEnabled = true;
  // Warm up /proc baselines then collect immediately
  readLiveCpuPct();
  readLiveNetworkKbps(1);
  setTimeout(() => {
    try {
      collectAndForwardSample();
    } catch (err) {
      console.error('[Tier-1 Collector] Initial sample failed:', err);
    }
  }, 600);

  if (collectorTimer) clearInterval(collectorTimer);
  collectorTimer = setInterval(() => {
    try {
      reconcileStaleRealHosts();
      collectAndForwardSample();
    } catch (err) {
      console.error('[Tier-1 Collector] Tick error:', err);
    }
  }, 4000);
}

export function setTier1LocalCollectorEnabled(enabled: boolean): boolean {
  collectorEnabled = enabled;
  const db = getDb();
  if (enabled) {
    ensureRuntimeHostAndKey();
    if (!collectorTimer) {
      startTier1LocalCollector();
    } else {
      collectAndForwardSample();
    }
    broadcastWsEvent('host:updated', { hostId: TIER1_RUNTIME_HOST_ID, status: 'online' });
  } else {
    db.prepare('UPDATE hosts SET status = ?, health_score = 0 WHERE id = ?').run(
      'offline',
      TIER1_RUNTIME_HOST_ID
    );
    broadcastWsEvent('host:updated', { hostId: TIER1_RUNTIME_HOST_ID, status: 'offline' });
  }
  return collectorEnabled;
}

export function isTier1LocalCollectorRunning(): boolean {
  return collectorEnabled;
}
