import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  getAppSettings,
  getDb,
  listAlerts,
  listEgressAudits,
  listHosts,
} from '../db/sqlite';
import {
  computeHostHealthScore,
  evaluateMetricAlerts,
  isHostHeartbeatStale,
} from '../../shared/alerts/rules';
import { computePayloadHash, sanitizeTelemetryForEgress } from '../../shared/privacy/sanitizer';
import {
  DEMO_HOST_PROFILES,
  type DemoSimulationOverrides,
  generateDemoHostTelemetry,
} from '../../shared/demo/simulator';

let wss: WebSocketServer | null = null;
let simulationTick = 25;
let demoLoopTimer: NodeJS.Timeout | null = null;

const demoOverrides = new Map<string, DemoSimulationOverrides>();

export function setDemoHostOverride(hostId: string, override: DemoSimulationOverrides): void {
  const existing = demoOverrides.get(hostId) ?? {};
  demoOverrides.set(hostId, { ...existing, ...override });
}

export function clearDemoOverrides(): void {
  demoOverrides.clear();
}

export function getDemoOverridesSnapshot(): Record<string, DemoSimulationOverrides> {
  return Object.fromEntries(demoOverrides.entries());
}

export function getWsClientCount(): number {
  if (!wss) return 0;
  let open = 0;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) open += 1;
  }
  return open;
}

export function broadcastWsEvent(type: string, payload: unknown): void {
  if (!wss) return;
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function initRealtimeServer(httpServer: HttpServer): void {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    const settings = getAppSettings();
    ws.send(
      JSON.stringify({
        type: 'init',
        payload: {
          demoModeEnabled: settings.demoModeEnabled,
          hosts: listHosts(settings.demoModeEnabled),
          alerts: listAlerts(settings.demoModeEnabled).slice(0, 30),
          audits: listEgressAudits(settings.demoModeEnabled, 15),
        },
        timestamp: new Date().toISOString(),
      })
    );
  });

  if (demoLoopTimer) clearInterval(demoLoopTimer);
  demoLoopTimer = setInterval(() => {
    runHeartbeatAndDemoTick();
  }, 3000);
}

function runHeartbeatAndDemoTick(): void {
  const settings = getAppSettings();
  const db = getDb();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Check real agent staleness
  const realHosts = listHosts(false);
  for (const host of realHosts) {
    if (
      host.status !== 'offline' &&
      isHostHeartbeatStale(host.lastHeartbeat, nowMs, settings.thresholds.offlineTimeoutSec)
    ) {
      db.prepare('UPDATE hosts SET status = ?, health_score = 0 WHERE id = ?').run('offline', host.id);
      const alertId = `alt-offline-${host.id}-${Math.floor(nowMs / 60000)}`;
      const exists = db.prepare('SELECT id FROM alerts WHERE id = ?').get(alertId);
      if (!exists) {
        db.prepare(`
          INSERT INTO alerts (
            id, host_id, host_name, metric_type, severity, status, title, description,
            observed_value, threshold_value, created_at, is_demo
          ) VALUES (?, ?, ?, 'offline', 'critical', 'open', ?, ?, ?, ?, ?, 0)
        `).run(
          alertId,
          host.id,
          host.name,
          `Host offline: ${host.name}`,
          `No heartbeat received for more than ${settings.thresholds.offlineTimeoutSec}s.`,
          'Offline',
          `${settings.thresholds.offlineTimeoutSec}s`,
          nowIso
        );
      }
      broadcastWsEvent('host:updated', { hostId: host.id, status: 'offline' });
    }
  }

  if (!settings.demoModeEnabled) return;

  simulationTick += 1;
  const updatedHosts = [];

  for (const profile of DEMO_HOST_PROFILES) {
    const override = demoOverrides.get(profile.id) ?? {};
    if (override.offline) {
      db.prepare('UPDATE hosts SET status = ?, health_score = 0 WHERE id = ?').run('offline', profile.id);
      continue;
    }

    const prevRow = db
      .prepare('SELECT cpu_pct, ram_pct FROM hosts WHERE id = ?')
      .get(profile.id) as { cpu_pct: number; ram_pct: number } | undefined;

    const raw = generateDemoHostTelemetry(profile, simulationTick, nowIso, override);
    const status =
      raw.cpuPct >= settings.thresholds.cpuCritical || raw.ramPct >= settings.thresholds.ramCritical
        ? 'degraded'
        : 'online';
    const healthScore = computeHostHealthScore(status, raw.cpuPct, raw.ramPct, raw.diskPct);

    db.prepare(`
      UPDATE hosts
      SET status = ?, health_score = ?, last_heartbeat = ?, uptime_seconds = ?,
          cpu_pct = ?, ram_pct = ?, ram_used_gb = ?, disk_pct = ?, disk_used_gb = ?,
          net_rx_kbps = ?, net_tx_kbps = ?
      WHERE id = ?
    `).run(
      status,
      healthScore,
      nowIso,
      raw.uptimeSeconds,
      raw.cpuPct,
      raw.ramPct,
      raw.ramUsedGb,
      raw.diskPct,
      raw.diskUsedGb,
      raw.netRxKbps,
      raw.netTxKbps,
      profile.id
    );

    db.prepare(`
      INSERT INTO metrics (host_id, timestamp, cpu_pct, ram_pct, disk_pct, net_rx_kbps, net_tx_kbps, uptime_seconds, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      profile.id,
      nowIso,
      raw.cpuPct,
      raw.ramPct,
      raw.diskPct,
      raw.netRxKbps,
      raw.netTxKbps,
      raw.uptimeSeconds
    );

    db.prepare(`
      INSERT INTO raw_local_snapshots (host_id, raw_json, collected_at, is_demo)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(host_id) DO UPDATE SET raw_json = excluded.raw_json, collected_at = excluded.collected_at
    `).run(profile.id, JSON.stringify(raw), nowIso);

    // Evaluate alerts
    const candidates = evaluateMetricAlerts({
      host: { id: profile.id, name: profile.name, isDemo: true },
      current: {
        cpuPct: raw.cpuPct,
        ramPct: raw.ramPct,
        diskPct: raw.diskPct,
        netRxKbps: raw.netRxKbps,
        netTxKbps: raw.netTxKbps,
        timestamp: nowIso,
      },
      previous: prevRow ? { cpuPct: prevRow.cpu_pct, ramPct: prevRow.ram_pct } : undefined,
      thresholds: settings.thresholds,
    });

    for (const candidate of candidates) {
      const recentOpen = db
        .prepare(
          `SELECT id FROM alerts WHERE host_id = ? AND metric_type = ? AND status IN ('open', 'acknowledged') AND is_demo = 1 LIMIT 1`
        )
        .get(candidate.hostId, candidate.metricType);
      if (!recentOpen) {
        const alertId = `alt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        db.prepare(`
          INSERT INTO alerts (
            id, host_id, host_name, metric_type, severity, status, title, description,
            observed_value, threshold_value, created_at, is_demo
          ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 1)
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

    // Periodically log an Egress Proof sanitized transmission every 5 ticks
    if (simulationTick % 5 === 0 && profile.id === 'demo-host-01') {
      const egress = sanitizeTelemetryForEgress(raw, settings.privacy);
      const auditId = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const statusStr = settings.privacy.cloudSyncEnabled ? 'transmitted' : 'blocked_by_policy';
      db.prepare(`
        INSERT INTO egress_audits (
          id, host_id, host_name, timestamp, destination, status, fields_sanitized,
          fields_blocked, payload_bytes, payload_hash, approved_payload_json, is_demo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        auditId,
        profile.id,
        profile.name,
        nowIso,
        settings.privacy.cloudSyncEnabled ? 'cicada-cloud-ingest.local' : 'blocked-locally',
        statusStr,
        egress.fieldsSanitizedCount,
        egress.blockedFieldsCount,
        egress.sanitizedByteSize,
        computePayloadHash(egress.approvedPayload),
        JSON.stringify(egress.approvedPayload)
      );

      for (const det of egress.sensitiveFieldsDetected.slice(0, 4)) {
        db.prepare(`
          INSERT INTO blocked_fields (id, audit_id, host_id, timestamp, field_path, category, rule_name, redacted_preview, is_demo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          `blk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          auditId,
          profile.id,
          nowIso,
          det.fieldPath,
          det.category,
          det.ruleName,
          `${det.originalSnippet} -> ${det.replacement}`
        );
      }

      broadcastWsEvent('egress:logged', { auditId, hostId: profile.id, status: statusStr });
    }

    updatedHosts.push({
      id: profile.id,
      cpuPct: raw.cpuPct,
      ramPct: raw.ramPct,
      diskPct: raw.diskPct,
      netRxKbps: raw.netRxKbps,
      netTxKbps: raw.netTxKbps,
      uptimeSeconds: raw.uptimeSeconds,
      status,
      healthScore,
      timestamp: nowIso,
      isDemo: true,
    });
  }

  // Keep demo metrics table bounded
  if (simulationTick % 20 === 0) {
    db.prepare(
      `DELETE FROM metrics WHERE is_demo = 1 AND id NOT IN (SELECT id FROM metrics WHERE is_demo = 1 ORDER BY id DESC LIMIT 400)`
    ).run();
  }

  broadcastWsEvent('metrics:tick', { hosts: updatedHosts, timestamp: nowIso });
}
