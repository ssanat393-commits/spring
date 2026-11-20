import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ENV } from '../config/env';
import type {
  AiAnalysisOutput,
  AlertIncident,
  AppSettings,
  BlockedFieldLogEntry,
  DataExportRecord,
  EgressAuditRecord,
  EnrollmentLinkRecord,
  HostRecord,
  MetricPoint,
  RawLocalTelemetry,
  Tier2IngestEvent,
} from '../../shared/types';
import { DEFAULT_THRESHOLDS } from '../../shared/alerts/rules';
import { DEFAULT_PRIVACY_CONTROLS, computePayloadHash, sanitizeTelemetryForEgress } from '../../shared/privacy/sanitizer';
import {
  DEMO_HOST_PROFILES,
  buildInitialDemoHostRecord,
  generateDemoHostTelemetry,
} from '../../shared/demo/simulator';

let dbInstance: DatabaseSync | null = null;

export const DEFAULT_SETTINGS: AppSettings = {
  profile: {
    displayName: 'SecOps Lead',
    email: 'ops@cicada.local',
    role: 'Principal Observability Engineer',
    organization: 'CICADA Security Operations',
  },
  monitoringIntervalSec: 3,
  retentionDays: 30,
  theme: 'dark',
  demoModeEnabled: true,
  thresholds: { ...DEFAULT_THRESHOLDS },
  privacy: { ...DEFAULT_PRIVACY_CONTROLS },
  agentConfig: {
    heartbeatIntervalSec: 15,
    collectProcessArgsLocally: true,
    localSqliteBufferMaxMb: 128,
  },
};

export function hashAgentKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dir = path.dirname(ENV.DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(ENV.DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hostname TEXT NOT NULL,
      os TEXT NOT NULL,
      kernel TEXT NOT NULL,
      architecture TEXT NOT NULL,
      ip_masked TEXT NOT NULL,
      status TEXT NOT NULL,
      health_score INTEGER NOT NULL,
      last_heartbeat TEXT NOT NULL,
      uptime_seconds INTEGER NOT NULL,
      cpu_pct REAL NOT NULL,
      ram_pct REAL NOT NULL,
      ram_used_gb REAL NOT NULL,
      ram_total_gb REAL NOT NULL,
      disk_pct REAL NOT NULL,
      disk_used_gb REAL NOT NULL,
      disk_total_gb REAL NOT NULL,
      net_rx_kbps REAL NOT NULL,
      net_tx_kbps REAL NOT NULL,
      agent_version TEXT NOT NULL,
      agent_key_hash TEXT,
      device_meta_json TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      cpu_pct REAL NOT NULL,
      ram_pct REAL NOT NULL,
      disk_pct REAL NOT NULL,
      net_rx_kbps REAL NOT NULL,
      net_tx_kbps REAL NOT NULL,
      uptime_seconds INTEGER NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_host_ts ON metrics (host_id, timestamp DESC);

    CREATE TABLE IF NOT EXISTS raw_local_snapshots (
      host_id TEXT PRIMARY KEY,
      raw_json TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      host_name TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      observed_value TEXT NOT NULL,
      threshold_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at TEXT,
      acknowledged_by TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts (created_at DESC);

    CREATE TABLE IF NOT EXISTS egress_audits (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      host_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      destination TEXT NOT NULL,
      status TEXT NOT NULL,
      fields_sanitized INTEGER NOT NULL,
      fields_blocked INTEGER NOT NULL,
      payload_bytes INTEGER NOT NULL,
      payload_hash TEXT NOT NULL,
      approved_payload_json TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_egress_ts ON egress_audits (timestamp DESC);

    CREATE TABLE IF NOT EXISTS blocked_fields (
      id TEXT PRIMARY KEY,
      audit_id TEXT NOT NULL,
      host_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      field_path TEXT NOT NULL,
      category TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      redacted_preview TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS export_history (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      format TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      exported_by TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ai_insights (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      host_name TEXT NOT NULL,
      incident_id TEXT,
      summary TEXT NOT NULL,
      observed_metrics_json TEXT NOT NULL,
      possible_explanations_json TEXT NOT NULL,
      root_cause_json TEXT NOT NULL,
      troubleshooting_json TEXT NOT NULL,
      predictive_json TEXT NOT NULL,
      model_used TEXT NOT NULL,
      privacy_verified INTEGER NOT NULL DEFAULT 1,
      generated_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enrollment_tokens (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      short_code TEXT,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      revoked_at TEXT,
      claimed_host_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tier2_ingest_events (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      host_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      auth_method TEXT NOT NULL,
      cpu_pct REAL NOT NULL,
      ram_pct REAL NOT NULL,
      disk_pct REAL NOT NULL,
      net_rx_kbps REAL NOT NULL,
      net_tx_kbps REAL NOT NULL,
      fields_sanitized INTEGER NOT NULL,
      ingest_latency_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tier2_ingest_ts ON tier2_ingest_events (timestamp DESC);
  `);

  const hostColumns = db.prepare('PRAGMA table_info(hosts)').all() as Array<{ name: string }>;
  if (!hostColumns.some((c) => c.name === 'device_meta_json')) {
    db.exec('ALTER TABLE hosts ADD COLUMN device_meta_json TEXT;');
  }

  const enrollColumns = db.prepare('PRAGMA table_info(enrollment_tokens)').all() as Array<{ name: string }>;
  if (!enrollColumns.some((c) => c.name === 'short_code')) {
    db.exec('ALTER TABLE enrollment_tokens ADD COLUMN short_code TEXT;');
  }

  dbInstance = db;
  seedInitialStateIfNeeded(db);
  return db;
}

export function getAppSettings(): AppSettings {
  const db = getDb();
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('app_settings') as
    | { value_json: string }
    | undefined;
  if (!row) {
    return DEFAULT_SETTINGS;
  }
  try {
    const parsed = JSON.parse(row.value_json) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      profile: { ...DEFAULT_SETTINGS.profile, ...(parsed.profile ?? {}) },
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(parsed.thresholds ?? {}) },
      privacy: { ...DEFAULT_SETTINGS.privacy, ...(parsed.privacy ?? {}) },
      agentConfig: { ...DEFAULT_SETTINGS.agentConfig, ...(parsed.agentConfig ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveAppSettings(next: AppSettings): AppSettings {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run('app_settings', JSON.stringify(next), now);
  return next;
}

function seedInitialStateIfNeeded(db: DatabaseSync): void {
  const existingSettings = db.prepare('SELECT key FROM settings WHERE key = ?').get('app_settings');
  const nowIso = new Date().toISOString();
  if (!existingSettings) {
    db.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'app_settings',
      JSON.stringify(DEFAULT_SETTINGS),
      nowIso
    );
  }

  const hostCountRow = db.prepare('SELECT COUNT(*) as cnt FROM hosts').get() as { cnt: number };
  if (hostCountRow.cnt === 0) {
    seedDemoFleetData(db);
  }
}

export function seedDemoFleetData(db: DatabaseSync = getDb()): void {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  db.prepare('DELETE FROM hosts WHERE is_demo = 1').run();
  db.prepare('DELETE FROM metrics WHERE is_demo = 1').run();
  db.prepare('DELETE FROM raw_local_snapshots WHERE is_demo = 1').run();
  db.prepare('DELETE FROM alerts WHERE is_demo = 1').run();
  db.prepare('DELETE FROM egress_audits WHERE is_demo = 1').run();
  db.prepare('DELETE FROM blocked_fields WHERE is_demo = 1').run();
  db.prepare('DELETE FROM ai_insights WHERE is_demo = 1').run();

  const insertHost = db.prepare(`
    INSERT INTO hosts (
      id, name, hostname, os, kernel, architecture, ip_masked, status, health_score,
      last_heartbeat, uptime_seconds, cpu_pct, ram_pct, ram_used_gb, ram_total_gb,
      disk_pct, disk_used_gb, disk_total_gb, net_rx_kbps, net_tx_kbps, agent_version,
      agent_key_hash, is_demo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const insertMetric = db.prepare(`
    INSERT INTO metrics (host_id, timestamp, cpu_pct, ram_pct, disk_pct, net_rx_kbps, net_tx_kbps, uptime_seconds, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const insertRaw = db.prepare(`
    INSERT INTO raw_local_snapshots (host_id, raw_json, collected_at, is_demo)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(host_id) DO UPDATE SET raw_json = excluded.raw_json, collected_at = excluded.collected_at
  `);

  for (const profile of DEMO_HOST_PROFILES) {
    const initialHost = buildInitialDemoHostRecord(profile, nowIso);
    insertHost.run(
      initialHost.id,
      initialHost.name,
      initialHost.hostname,
      initialHost.os,
      initialHost.kernel,
      initialHost.architecture,
      initialHost.ipMasked,
      initialHost.status,
      initialHost.healthScore,
      initialHost.lastHeartbeat,
      initialHost.uptimeSeconds,
      initialHost.cpuPct,
      initialHost.ramPct,
      initialHost.ramUsedGb,
      initialHost.ramTotalGb,
      initialHost.diskPct,
      initialHost.diskUsedGb,
      initialHost.diskTotalGb,
      initialHost.netRxKbps,
      initialHost.netTxKbps,
      initialHost.agentVersion,
      null,
      initialHost.createdAt
    );

    let latestRaw: RawLocalTelemetry | null = null;
    for (let i = 24; i >= 0; i -= 1) {
      const ts = new Date(now - i * 15000).toISOString();
      const raw = generateDemoHostTelemetry(profile, 24 - i, ts);
      insertMetric.run(
        profile.id,
        ts,
        raw.cpuPct,
        raw.ramPct,
        raw.diskPct,
        raw.netRxKbps,
        raw.netTxKbps,
        raw.uptimeSeconds
      );
      latestRaw = raw;
    }

    if (latestRaw) {
      insertRaw.run(profile.id, JSON.stringify(latestRaw), latestRaw.collectedAt);
      const egress = sanitizeTelemetryForEgress(latestRaw, DEFAULT_PRIVACY_CONTROLS);
      const auditId = `aud-seed-${profile.id}`;
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
        'cicada-cloud-ingest.local',
        'transmitted',
        egress.fieldsSanitizedCount,
        egress.blockedFieldsCount,
        egress.sanitizedByteSize,
        computePayloadHash(egress.approvedPayload),
        JSON.stringify(egress.approvedPayload)
      );

      const insertBlocked = db.prepare(`
        INSERT INTO blocked_fields (id, audit_id, host_id, timestamp, field_path, category, rule_name, redacted_preview, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);
      for (const det of egress.sensitiveFieldsDetected.slice(0, 6)) {
        insertBlocked.run(
          `blk-${auditId}-${det.id}`,
          auditId,
          profile.id,
          nowIso,
          det.fieldPath,
          det.category,
          det.ruleName,
          `${det.originalSnippet} -> ${det.replacement}`
        );
      }
    }
  }

  // Seed initial demo alerts
  const seedAlerts: AlertIncident[] = [
    {
      id: 'alt-demo-01',
      hostId: 'demo-host-04',
      hostName: 'db-replica-us-03',
      metricType: 'disk',
      severity: 'high',
      status: 'open',
      title: 'Storage utilization above 82% on db-replica-us-03',
      description: 'WAL archive volume reached 83.0% capacity; approaching configured 90% critical threshold.',
      observedValue: '83.0%',
      thresholdValue: '80%',
      createdAt: new Date(now - 240000).toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      acknowledgedBy: null,
      isDemo: true,
    },
    {
      id: 'alt-demo-02',
      hostId: 'demo-host-02',
      hostName: 'ml-inference-node-04',
      metricType: 'ram',
      severity: 'medium',
      status: 'acknowledged',
      title: 'Sustained memory pressure on ml-inference-node-04',
      description: 'Model weights cache holding 74%+ memory footprint across inference workers.',
      observedValue: '78.4%',
      thresholdValue: '82%',
      createdAt: new Date(now - 720000).toISOString(),
      acknowledgedAt: new Date(now - 360000).toISOString(),
      resolvedAt: null,
      acknowledgedBy: 'SecOps Lead',
      isDemo: true,
    },
  ];

  const insertAlert = db.prepare(`
    INSERT INTO alerts (
      id, host_id, host_name, metric_type, severity, status, title, description,
      observed_value, threshold_value, created_at, acknowledged_at, resolved_at, acknowledged_by, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const alert of seedAlerts) {
    insertAlert.run(
      alert.id,
      alert.hostId,
      alert.hostName,
      alert.metricType,
      alert.severity,
      alert.status,
      alert.title,
      alert.description,
      alert.observedValue,
      alert.thresholdValue,
      alert.createdAt,
      alert.acknowledgedAt,
      alert.resolvedAt,
      alert.acknowledgedBy
    );
  }

  // Seed initial sample demo AI Insight
  const sampleInsight: AiAnalysisOutput = {
    id: 'ai-demo-seed-01',
    hostId: 'demo-host-04',
    hostName: 'db-replica-us-03',
    incidentId: 'alt-demo-01',
    summary: 'Sanitized telemetry indicates elevated storage allocation (83.0%) paired with steady 81% memory residency on host-db-replica.',
    observedMetrics: [
      'Observed disk usage at 83.0% (warning threshold: 80%).',
      'Observed RAM residency at 81.0% across 96 GB total memory.',
      'Observed network egress steady at 13,900 Kbps with zero CPU saturation (52.0%).',
    ],
    possibleExplanations: [
      'Possible explanation: PostgreSQL WAL segments or unrotated local backup snapshots may be accumulating faster than cleanup jobs.',
      'Possible explanation: Shared memory buffers plus active replication slots may be retaining steady RAM pages.',
    ],
    rootCauseHypotheses: [
      {
        hypothesis: 'WAL archive retention or delayed checkpoint pruning on replica volume',
        confidence: 'high',
        supportingEvidence: 'Disk usage elevated at 83.0% while CPU remains moderate at 52.0%.',
      },
      {
        hypothesis: 'Long-running analytical read query holding buffer cache pages',
        confidence: 'medium',
        supportingEvidence: 'RAM utilization sustained at 81.0% alongside steady outbound network throughput.',
      },
    ],
    troubleshootingSteps: [
      'Inspect PostgreSQL replication slot lag and WAL segment retention locally.',
      'Verify scheduled logrotate and backup pruning timers without exporting raw SQL logs.',
      'Consider expanding the replica storage volume before hitting the 90% critical threshold.',
    ],
    predictiveMaintenance: [
      'At current linear growth, storage may reach 90% critical saturation within 48-72 hours.',
      'Configure automated WAL archive pruning alerts at 85% disk occupancy.',
    ],
    modelUsed: 'demo-baseline-analyzer',
    privacyVerified: true,
    generatedAt: nowIso,
    isDemo: true,
  };

  db.prepare(`
    INSERT INTO ai_insights (
      id, host_id, host_name, incident_id, summary, observed_metrics_json,
      possible_explanations_json, root_cause_json, troubleshooting_json,
      predictive_json, model_used, privacy_verified, generated_at, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
  `).run(
    sampleInsight.id,
    sampleInsight.hostId,
    sampleInsight.hostName,
    sampleInsight.incidentId ?? null,
    sampleInsight.summary,
    JSON.stringify(sampleInsight.observedMetrics),
    JSON.stringify(sampleInsight.possibleExplanations),
    JSON.stringify(sampleInsight.rootCauseHypotheses),
    JSON.stringify(sampleInsight.troubleshootingSteps),
    JSON.stringify(sampleInsight.predictiveMaintenance),
    sampleInsight.modelUsed,
    sampleInsight.generatedAt
  );
}

export function listHosts(includeDemo: boolean): HostRecord[] {
  const db = getDb();
  const rows = (
    includeDemo
      ? db.prepare('SELECT * FROM hosts ORDER BY is_demo ASC, name ASC').all()
      : db.prepare('SELECT * FROM hosts WHERE is_demo = 0 ORDER BY name ASC').all()
  ) as Array<Record<string, unknown>>;

  return rows.map(mapHostRow);
}

export function getHostById(hostId: string): HostRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM hosts WHERE id = ?').get(hostId) as Record<string, unknown> | undefined;
  return row ? mapHostRow(row) : null;
}

export function mapHostRow(r: Record<string, unknown>): HostRecord {
  let deviceMeta: HostRecord['deviceMeta'] = null;
  if (r.device_meta_json) {
    try {
      deviceMeta = JSON.parse(String(r.device_meta_json)) as HostRecord['deviceMeta'];
    } catch {
      deviceMeta = null;
    }
  }
  return {
    id: String(r.id),
    name: String(r.name),
    hostname: String(r.hostname),
    os: String(r.os),
    kernel: String(r.kernel),
    architecture: String(r.architecture),
    ipMasked: String(r.ip_masked),
    status: String(r.status) as HostRecord['status'],
    healthScore: Number(r.health_score),
    lastHeartbeat: String(r.last_heartbeat),
    uptimeSeconds: Number(r.uptime_seconds),
    cpuPct: Number(r.cpu_pct),
    ramPct: Number(r.ram_pct),
    ramUsedGb: Number(r.ram_used_gb),
    ramTotalGb: Number(r.ram_total_gb),
    diskPct: Number(r.disk_pct),
    diskUsedGb: Number(r.disk_used_gb),
    diskTotalGb: Number(r.disk_total_gb),
    netRxKbps: Number(r.net_rx_kbps),
    netTxKbps: Number(r.net_tx_kbps),
    agentVersion: String(r.agent_version),
    deviceMeta,
    isDemo: Boolean(r.is_demo),
    createdAt: String(r.created_at),
  };
}

export function getHostMetricsHistory(hostId: string, limit = 60): MetricPoint[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM metrics WHERE host_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(hostId, limit) as Array<Record<string, unknown>>;

  return rows
    .reverse()
    .map((r) => ({
      id: Number(r.id),
      hostId: String(r.host_id),
      timestamp: String(r.timestamp),
      cpuPct: Number(r.cpu_pct),
      ramPct: Number(r.ram_pct),
      diskPct: Number(r.disk_pct),
      netRxKbps: Number(r.net_rx_kbps),
      netTxKbps: Number(r.net_tx_kbps),
      uptimeSeconds: Number(r.uptime_seconds),
      isDemo: Boolean(r.is_demo),
    }));
}

export function getLatestRawSnapshot(hostId: string): RawLocalTelemetry | null {
  const db = getDb();
  const row = db
    .prepare('SELECT raw_json FROM raw_local_snapshots WHERE host_id = ?')
    .get(hostId) as { raw_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.raw_json) as RawLocalTelemetry;
  } catch {
    return null;
  }
}

export function listAlerts(includeDemo: boolean): AlertIncident[] {
  const db = getDb();
  const rows = (
    includeDemo
      ? db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 200').all()
      : db.prepare('SELECT * FROM alerts WHERE is_demo = 0 ORDER BY created_at DESC LIMIT 200').all()
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    hostId: String(r.host_id),
    hostName: String(r.host_name),
    metricType: String(r.metric_type) as AlertIncident['metricType'],
    severity: String(r.severity) as AlertIncident['severity'],
    status: String(r.status) as AlertIncident['status'],
    title: String(r.title),
    description: String(r.description),
    observedValue: String(r.observed_value),
    thresholdValue: String(r.threshold_value),
    createdAt: String(r.created_at),
    acknowledgedAt: r.acknowledged_at ? String(r.acknowledged_at) : null,
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    acknowledgedBy: r.acknowledged_by ? String(r.acknowledged_by) : null,
    isDemo: Boolean(r.is_demo),
  }));
}

export function listEgressAudits(includeDemo: boolean, limit = 50): EgressAuditRecord[] {
  const db = getDb();
  const rows = (
    includeDemo
      ? db.prepare('SELECT * FROM egress_audits ORDER BY timestamp DESC LIMIT ?').all(limit)
      : db.prepare('SELECT * FROM egress_audits WHERE is_demo = 0 ORDER BY timestamp DESC LIMIT ?').all(limit)
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    hostId: String(r.host_id),
    hostName: String(r.host_name),
    timestamp: String(r.timestamp),
    destination: String(r.destination),
    status: String(r.status) as EgressAuditRecord['status'],
    fieldsSanitized: Number(r.fields_sanitized),
    fieldsBlocked: Number(r.fields_blocked),
    payloadBytes: Number(r.payload_bytes),
    payloadHash: String(r.payload_hash),
    approvedPayloadJson: String(r.approved_payload_json),
    isDemo: Boolean(r.is_demo),
  }));
}

export function listBlockedFields(includeDemo: boolean, limit = 80): BlockedFieldLogEntry[] {
  const db = getDb();
  const rows = (
    includeDemo
      ? db.prepare('SELECT * FROM blocked_fields ORDER BY timestamp DESC LIMIT ?').all(limit)
      : db.prepare('SELECT * FROM blocked_fields WHERE is_demo = 0 ORDER BY timestamp DESC LIMIT ?').all(limit)
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    auditId: String(r.audit_id),
    hostId: String(r.host_id),
    timestamp: String(r.timestamp),
    fieldPath: String(r.field_path),
    category: String(r.category) as BlockedFieldLogEntry['category'],
    ruleName: String(r.rule_name),
    redactedPreview: String(r.redacted_preview),
    isDemo: Boolean(r.is_demo),
  }));
}

export function listExportHistory(limit = 50): DataExportRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM export_history ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    reportType: String(r.report_type),
    format: String(r.format) as 'csv' | 'json',
    rowCount: Number(r.row_count),
    exportedBy: String(r.exported_by),
    timestamp: String(r.timestamp),
    isDemo: Boolean(r.is_demo),
  }));
}

export function listAiInsights(includeDemo: boolean, limit = 25): AiAnalysisOutput[] {
  const db = getDb();
  const rows = (
    includeDemo
      ? db.prepare('SELECT * FROM ai_insights ORDER BY generated_at DESC LIMIT ?').all(limit)
      : db.prepare('SELECT * FROM ai_insights WHERE is_demo = 0 ORDER BY generated_at DESC LIMIT ?').all(limit)
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    hostId: String(r.host_id),
    hostName: String(r.host_name),
    incidentId: r.incident_id ? String(r.incident_id) : undefined,
    summary: String(r.summary),
    observedMetrics: JSON.parse(String(r.observed_metrics_json)),
    possibleExplanations: JSON.parse(String(r.possible_explanations_json)),
    rootCauseHypotheses: JSON.parse(String(r.root_cause_json)),
    troubleshootingSteps: JSON.parse(String(r.troubleshooting_json)),
    predictiveMaintenance: JSON.parse(String(r.predictive_json)),
    modelUsed: String(r.model_used),
    privacyVerified: Boolean(r.privacy_verified),
    generatedAt: String(r.generated_at),
    isDemo: Boolean(r.is_demo),
  }));
}

export function pruneOldRecords(retentionDays: number): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();
  const res = db.prepare('DELETE FROM metrics WHERE timestamp < ?').run(cutoff);
  return Number(res.changes ?? 0);
}

export function listEnrollmentLinks(limit = 30): EnrollmentLinkRecord[] {
  const db = getDb();
  const nowMs = Date.now();
  const rows = db
    .prepare('SELECT * FROM enrollment_tokens ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const usedAt = r.used_at ? String(r.used_at) : null;
    const revokedAt = r.revoked_at ? String(r.revoked_at) : null;
    const expiresAt = String(r.expires_at);
    let status: EnrollmentLinkRecord['status'] = 'pending';
    if (revokedAt) {
      status = 'revoked';
    } else if (usedAt) {
      status = 'claimed';
    } else if (Date.parse(expiresAt) < nowMs) {
      status = 'expired';
    }
    return {
      id: String(r.id),
      label: String(r.label),
      shortCode: r.short_code ? String(r.short_code) : null,
      status,
      expiresAt,
      usedAt,
      claimedHostId: r.claimed_host_id ? String(r.claimed_host_id) : null,
      createdBy: String(r.created_by),
      createdAt: String(r.created_at),
    };
  });
}

export function recordTier2IngestEvent(event: Tier2IngestEvent): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO tier2_ingest_events (
      id, host_id, host_name, source_type, auth_method, cpu_pct, ram_pct, disk_pct,
      net_rx_kbps, net_tx_kbps, fields_sanitized, ingest_latency_ms, status, reason, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.hostId,
    event.hostName,
    event.sourceType,
    event.authMethod,
    event.cpuPct,
    event.ramPct,
    event.diskPct,
    event.netRxKbps,
    event.netTxKbps,
    event.fieldsSanitized,
    event.ingestLatencyMs,
    event.status,
    event.reason,
    event.timestamp
  );

  // Keep ledger bounded to last 300 entries
  db.prepare(
    `DELETE FROM tier2_ingest_events WHERE id NOT IN (SELECT id FROM tier2_ingest_events ORDER BY timestamp DESC LIMIT 300)`
  ).run();
}

export function listTier2IngestEvents(limit = 30): Tier2IngestEvent[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM tier2_ingest_events ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    hostId: String(r.host_id),
    hostName: String(r.host_name),
    sourceType: String(r.source_type) as Tier2IngestEvent['sourceType'],
    authMethod: String(r.auth_method),
    cpuPct: Number(r.cpu_pct),
    ramPct: Number(r.ram_pct),
    diskPct: Number(r.disk_pct),
    netRxKbps: Number(r.net_rx_kbps),
    netTxKbps: Number(r.net_tx_kbps),
    fieldsSanitized: Number(r.fields_sanitized),
    ingestLatencyMs: Number(r.ingest_latency_ms),
    status: String(r.status) as 'accepted' | 'rejected',
    reason: String(r.reason),
    timestamp: String(r.timestamp),
  }));
}

export function getTier2IngestCounts(): { accepted: number; rejected: number } {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
       FROM tier2_ingest_events`
    )
    .get() as { accepted: number | null; rejected: number | null } | undefined;

  return {
    accepted: Number(row?.accepted ?? 0),
    rejected: Number(row?.rejected ?? 0),
  };
}


