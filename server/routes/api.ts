import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { ENV, isFirebaseClientConfigured, isGeminiConfigured } from '../config/env';
import {
  getAppSettings,
  getDb,
  getHostById,
  getHostMetricsHistory,
  getLatestRawSnapshot,
  hashAgentKey,
  listAiInsights,
  listAlerts,
  listBlockedFields,
  listEgressAudits,
  listEnrollmentLinks,
  listExportHistory,
  listHosts,
  pruneOldRecords,
  recordTier2IngestEvent,
  saveAppSettings,
  seedDemoFleetData,
} from '../db/sqlite';
import {
  aiRateLimiter,
  requireAgentKey,
  requireOperatorAuth,
  signSessionToken,
} from '../middleware/security';
import {
  createSignedEnrollmentToken,
  generateShortPairingCode,
  hashEnrollmentToken,
  normalizePairingCode,
  verifySignedEnrollmentToken,
} from '../services/enrollment';
import { chatWithMonitoringAssistant, generateTelemetryAnalysis } from '../services/gemini';
import {
  broadcastWsEvent,
  clearDemoOverrides,
  getDemoOverridesSnapshot,
  setDemoHostOverride,
} from '../services/realtime';
import {
  isTier1LocalCollectorRunning,
  setTier1LocalCollectorEnabled,
} from '../services/tier1LocalCollector';
import { getTier2ControlPlaneStatus } from '../services/tier2ControlPlane';
import { classifyCollectorSource } from '../../shared/tier2/metrics';
import {
  canTransitionAlertStatus,
  computeHostHealthScore,
  evaluateMetricAlerts,
} from '../../shared/alerts/rules';
import {
  computePayloadHash,
  sanitizeTelemetryForEgress,
} from '../../shared/privacy/sanitizer';
import type {
  AlertStatus,
  AppSettings,
  RawLocalTelemetry,
} from '../../shared/types';

export function createApiRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const settings = getAppSettings();
    res.json({
      status: 'ok',
      service: 'cicada-2026-smart-observability',
      geminiConfigured: isGeminiConfigured(),
      firebaseConfigured: isFirebaseClientConfigured(),
      demoModeEnabled: settings.demoModeEnabled,
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/auth/session', requireOperatorAuth, (req: Request, res: Response) => {
    const operator = (req as Request & { operator?: { id: string; name: string; email: string; role: string } }).operator;
    const settings = getAppSettings();
    res.json({
      authenticated: true,
      provider: isFirebaseClientConfigured() ? 'firebase' : 'local',
      user: operator ?? {
        id: 'local-operator',
        name: settings.profile.displayName,
        email: settings.profile.email,
        role: settings.profile.role,
      },
    });
  });

  router.post('/auth/session', (req: Request, res: Response) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const role = String(req.body?.role || 'Observability Operator').trim();

    if (!name || !email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid name and email are required.' });
      return;
    }

    const user = {
      id: `op-${crypto.createHash('sha1').update(email).digest('hex').slice(0, 8)}`,
      name,
      email,
      role,
    };
    const token = signSessionToken(user);

    const settings = getAppSettings();
    saveAppSettings({
      ...settings,
      profile: {
        ...settings.profile,
        displayName: name,
        email,
        role,
      },
    });

    res.json({ authenticated: true, token, user });
  });

  router.get('/hosts', requireOperatorAuth, (req: Request, res: Response) => {
    const settings = getAppSettings();
    const includeDemoParam = req.query.includeDemo;
    const includeDemo =
      includeDemoParam !== undefined ? includeDemoParam === 'true' : settings.demoModeEnabled;
    res.json({
      hosts: listHosts(includeDemo),
      demoModeEnabled: settings.demoModeEnabled,
      localCollectorRunning: isTier1LocalCollectorRunning(),
    });
  });

  router.get('/hosts/:id', requireOperatorAuth, (req: Request, res: Response) => {
    const hostId = String(req.params.id);
    const host = getHostById(hostId);
    if (!host) {
      res.status(404).json({ error: 'Host not found.' });
      return;
    }
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 60)));
    const history = getHostMetricsHistory(hostId, limit);
    const rawSnapshot = getLatestRawSnapshot(hostId);
    res.json({ host, history, rawSnapshot });
  });

  router.delete('/hosts/cleanup/offline', requireOperatorAuth, (_req: Request, res: Response) => {
    const db = getDb();
    const offlineRows = db
      .prepare("SELECT id FROM hosts WHERE is_demo = 0 AND status = 'offline' AND id != 'tier1-runtime-host'")
      .all() as Array<{ id: string }>;
    const ids = offlineRows.map((r) => r.id);
    for (const hostId of ids) {
      db.prepare('DELETE FROM hosts WHERE id = ?').run(hostId);
      db.prepare('DELETE FROM metrics WHERE host_id = ?').run(hostId);
      db.prepare('DELETE FROM raw_local_snapshots WHERE host_id = ?').run(hostId);
      db.prepare('DELETE FROM tier2_ingest_events WHERE host_id = ?').run(hostId);
    }
    if (ids.length > 0) {
      broadcastWsEvent('host:removed', { hostIds: ids });
    }
    res.json({ deletedCount: ids.length, deletedIds: ids });
  });

  router.delete('/hosts/:id', requireOperatorAuth, (req: Request, res: Response) => {
    const hostId = String(req.params.id);
    const host = getHostById(hostId);
    if (!host) {
      res.status(404).json({ error: 'Host not found.' });
      return;
    }
    if (host.isDemo) {
      res.status(400).json({ error: 'Demo hosts are managed via Demo Mode controls.' });
      return;
    }
    const db = getDb();
    db.prepare('DELETE FROM hosts WHERE id = ?').run(hostId);
    db.prepare('DELETE FROM metrics WHERE host_id = ?').run(hostId);
    db.prepare('DELETE FROM raw_local_snapshots WHERE host_id = ?').run(hostId);
    db.prepare('DELETE FROM tier2_ingest_events WHERE host_id = ?').run(hostId);
    broadcastWsEvent('host:removed', { hostId });
    res.json({ deleted: true, hostId });
  });

  router.post('/agent/register', requireOperatorAuth, (req: Request, res: Response) => {
    const name = String(req.body?.name || '').trim();
    const hostname = String(req.body?.hostname || name).trim();
    const os = String(req.body?.os || 'Linux').trim();
    const architecture = String(req.body?.architecture || 'x86_64').trim();
    const ramTotalGb = Number(req.body?.ramTotalGb || 16);
    const diskTotalGb = Number(req.body?.diskTotalGb || 256);

    if (!name || name.length < 2 || name.length > 80) {
      res.status(400).json({ error: 'Host alias name must be between 2 and 80 characters.' });
      return;
    }

    const hostId = `host-${crypto.randomBytes(5).toString('hex')}`;
    const rawAgentKey = `cicada_ag_${crypto.randomBytes(20).toString('hex')}`;
    const keyHash = hashAgentKey(rawAgentKey);
    const nowIso = new Date().toISOString();

    const db = getDb();
    db.prepare(`
      INSERT INTO hosts (
        id, name, hostname, os, kernel, architecture, ip_masked, status, health_score,
        last_heartbeat, uptime_seconds, cpu_pct, ram_pct, ram_used_gb, ram_total_gb,
        disk_pct, disk_used_gb, disk_total_gb, net_rx_kbps, net_tx_kbps, agent_version,
        agent_key_hash, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', 100, ?, 0, 0, 0, 0, ?, 0, 0, ?, 0, 0, 'cicada-py/1.0.0', ?, 0, ?)
    `).run(hostId, name, hostname, os, 'pending', architecture, '0.0.x.x', nowIso, ramTotalGb, diskTotalGb, keyHash, nowIso);

    const host = getHostById(hostId);
    broadcastWsEvent('host:registered', { host });

    res.status(201).json({
      host,
      agentKey: rawAgentKey,
      instructions: `python3 agent/cicada_agent.py --server "${req.protocol}://${req.get('host')}" --host-id "${hostId}" --agent-key "${rawAgentKey}"`,
    });
  });

  const resolvePublicBaseUrl = (req: Request, overrideUrl?: unknown): string => {
    if (typeof overrideUrl === 'string' && overrideUrl.trim()) {
      try {
        const parsed = new URL(overrideUrl.trim());
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return parsed.origin;
        }
      } catch {
        // fall through to request host
      }
    }
    const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const hostHeader = req.get('host');
    if (hostHeader) return `${forwardedProto}://${hostHeader}`;
    return ENV.APP_URL.replace(/\/$/, '');
  };

  router.get('/agent/network-info', requireOperatorAuth, async (req: Request, res: Response) => {
    const requestOrigin = resolvePublicBaseUrl(req);
    let parsedHost = '';
    try {
      parsedHost = new URL(requestOrigin).hostname;
    } catch {
      parsedHost = '';
    }
    const isAiStudioDevHost = parsedHost.startsWith('ais-dev-');
    const isLocalhostOrigin =
      parsedHost === 'localhost' || parsedHost === '127.0.0.1' || parsedHost === '::1';
    const sharedAppUrl = isAiStudioDevHost
      ? requestOrigin.replace('://ais-dev-', '://ais-pre-')
      : null;

    let sharedAppReachable = false;
    let sharedAppHttpStatus: number | null = null;
    if (sharedAppUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1800);
        const probe = await fetch(`${sharedAppUrl}/api/health`, {
          redirect: 'manual',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        sharedAppHttpStatus = probe.status;
        sharedAppReachable = probe.status >= 200 && probe.status < 300;
      } catch {
        sharedAppReachable = false;
      }
    }

    const lanUrls: string[] = [];
    const ifaces = os.networkInterfaces();
    for (const entries of Object.values(ifaces)) {
      for (const iface of entries ?? []) {
        if (
          iface.family === 'IPv4' &&
          !iface.internal &&
          !iface.address.startsWith('169.254.')
        ) {
          lanUrls.push(`http://${iface.address}:${ENV.PORT}`);
        }
      }
    }

    res.json({
      requestOrigin,
      appUrl: ENV.APP_URL,
      isAiStudioDevHost,
      isLocalhostOrigin,
      sharedAppUrl,
      sharedAppReachable,
      sharedAppHttpStatus,
      lanUrls: [...new Set(lanUrls)].slice(0, 4),
    });
  });

  router.get('/agent/enrollment-links', requireOperatorAuth, (_req: Request, res: Response) => {
    res.json({ links: listEnrollmentLinks(30) });
  });

  router.post('/agent/enrollment-link', requireOperatorAuth, (req: Request, res: Response) => {
    const label = String(req.body?.label || '').trim();
    const ttlMinutes = Math.max(5, Math.min(1440, Number(req.body?.ttlMinutes || 30)));
    if (!label || label.length < 2 || label.length > 80) {
      res.status(400).json({ error: 'Device label must be between 2 and 80 characters.' });
      return;
    }

    const linkId = `lnk-${crypto.randomBytes(5).toString('hex')}`;
    const shortCode = generateShortPairingCode();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expMs = nowMs + ttlMinutes * 60 * 1000;
    const expiresAt = new Date(expMs).toISOString();
    const nonce = crypto.randomBytes(8).toString('hex');

    const signedToken = createSignedEnrollmentToken({ linkId, label, expMs, nonce });
    const tokenHash = hashEnrollmentToken(signedToken);
    const operator = (req as Request & { operator?: { name: string } }).operator?.name || 'SecOps Lead';

    const db = getDb();
    db.prepare(`
      INSERT INTO enrollment_tokens (id, label, short_code, token_hash, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(linkId, label, shortCode, tokenHash, expiresAt, operator, nowIso);

    const baseUrl = resolvePublicBaseUrl(req, req.body?.publicBaseUrl);
    const enrollmentUrl = `${baseUrl}/api/agent/enroll?token=${encodeURIComponent(signedToken)}`;
    const installerUrl = `${baseUrl}/api/agent/installer.sh?token=${encodeURIComponent(signedToken)}`;
    const psInstallerUrl = `${baseUrl}/api/agent/installer.ps1?token=${encodeURIComponent(signedToken)}`;
    const pairPageUrl = `${baseUrl}/?pairToken=${encodeURIComponent(signedToken)}`;
    const shortPairUrl = `${baseUrl}/?c=${encodeURIComponent(shortCode)}`;
    const pairCodePageUrl = `${baseUrl}/?pair=1`;

    res.status(201).json({
      link: {
        id: linkId,
        label,
        shortCode,
        status: 'pending',
        expiresAt,
        usedAt: null,
        claimedHostId: null,
        createdBy: operator,
        createdAt: nowIso,
      },
      shortCode,
      shortPairUrl,
      pairCodePageUrl,
      pairPageUrl,
      enrollmentUrl,
      installerCommand: `curl -fsSL "${installerUrl}" | bash`,
      powershellCommand: `irm "${psInstallerUrl}" | iex`,
      pythonCommand: `python3 agent/cicada_agent.py --enroll-url "${enrollmentUrl}"`,
    });
  });

  router.delete('/agent/enrollment-links/:id', requireOperatorAuth, (req: Request, res: Response) => {
    const linkId = String(req.params.id);
    const db = getDb();
    const nowIso = new Date().toISOString();
    const result = db
      .prepare('UPDATE enrollment_tokens SET revoked_at = ? WHERE id = ? AND used_at IS NULL')
      .run(nowIso, linkId);
    if (Number(result.changes ?? 0) === 0) {
      res.status(404).json({ error: 'Pending enrollment link not found or already claimed.' });
      return;
    }
    res.json({ ok: true, id: linkId });
  });

  const claimEnrollmentRowAndCreateHost = (
    req: Request,
    res: Response,
    row: {
      id: string;
      label: string;
      expires_at: string;
      used_at: string | null;
      revoked_at: string | null;
    }
  ) => {
    if (row.revoked_at) {
      res.status(403).json({ error: 'Enrollment link has been revoked.' });
      return;
    }
    if (row.used_at) {
      res.status(409).json({ error: 'Enrollment link has already been claimed by a device.' });
      return;
    }
    if (Date.parse(row.expires_at) < Date.now()) {
      res.status(401).json({ error: 'Enrollment link has expired.' });
      return;
    }

    const db = getDb();
    const hostId = `host-${crypto.randomBytes(5).toString('hex')}`;
    const rawAgentKey = `cicada_ag_${crypto.randomBytes(20).toString('hex')}`;
    const keyHash = hashAgentKey(rawAgentKey);
    const nowIso = new Date().toISOString();

    const customLabel =
      typeof req.body?.deviceLabel === 'string' && req.body.deviceLabel.trim().length >= 2
        ? req.body.deviceLabel.trim().slice(0, 80)
        : row.label;
    const hostname = String(req.body?.hostname || customLabel).trim().slice(0, 120);
    const osName = String(req.body?.os || 'Linux').trim().slice(0, 120);
    const kernel = String(req.body?.kernel || 'paired').trim().slice(0, 80);
    const architecture = String(req.body?.architecture || 'x86_64').trim().slice(0, 40);
    const ramTotalGb = Math.max(1, Number(req.body?.ramTotalGb || 16));
    const diskTotalGb = Math.max(1, Number(req.body?.diskTotalGb || 256));
    const agentVersion = String(req.body?.agentVersion || 'cicada-py/1.1.0').trim().slice(0, 60);
    const deviceMetaJson =
      req.body?.deviceMeta && typeof req.body.deviceMeta === 'object'
        ? JSON.stringify(req.body.deviceMeta).slice(0, 1024)
        : null;

    db.prepare(`
      INSERT INTO hosts (
        id, name, hostname, os, kernel, architecture, ip_masked, status, health_score,
        last_heartbeat, uptime_seconds, cpu_pct, ram_pct, ram_used_gb, ram_total_gb,
        disk_pct, disk_used_gb, disk_total_gb, net_rx_kbps, net_tx_kbps, agent_version,
        agent_key_hash, device_meta_json, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'redacted-by-collector', 'online', 100, ?, 0, 0, 0, 0, ?, 0, 0, ?, 0, 0, ?, ?, ?, 0, ?)
    `).run(
      hostId,
      customLabel,
      hostname,
      osName,
      kernel,
      architecture,
      nowIso,
      ramTotalGb,
      diskTotalGb,
      agentVersion,
      keyHash,
      deviceMetaJson,
      nowIso
    );

    db.prepare('UPDATE enrollment_tokens SET used_at = ?, claimed_host_id = ? WHERE id = ?').run(
      nowIso,
      hostId,
      row.id
    );

    const host = getHostById(hostId);
    broadcastWsEvent('host:registered', { host });

    res.status(201).json({
      ok: true,
      hostId,
      agentKey: rawAgentKey,
      serverUrl: resolvePublicBaseUrl(req),
      host,
    });
  };

  router.post('/agent/enroll', (req: Request, res: Response) => {
    const token = String(req.query.token || req.body?.token || '').trim();
    if (!token) {
      res.status(401).json({ error: 'Missing authenticated enrollment token.' });
      return;
    }

    const verified = verifySignedEnrollmentToken(token);
    if (!verified.valid) {
      res.status(401).json({ error: verified.reason });
      return;
    }

    const db = getDb();
    const tokenHash = hashEnrollmentToken(token);
    const row = db
      .prepare('SELECT id, label, token_hash, expires_at, used_at, revoked_at FROM enrollment_tokens WHERE id = ?')
      .get(verified.payload.linkId) as
      | {
          id: string;
          label: string;
          token_hash: string;
          expires_at: string;
          used_at: string | null;
          revoked_at: string | null;
        }
      | undefined;

    if (!row || row.token_hash !== tokenHash) {
      res.status(403).json({ error: 'Enrollment link not recognized.' });
      return;
    }

    claimEnrollmentRowAndCreateHost(req, res, row);
  });

  router.post('/agent/enroll-code', (req: Request, res: Response) => {
    const normalized = normalizePairingCode(String(req.body?.code || ''));
    if (!normalized) {
      res.status(400).json({ error: 'Enter a valid pairing code like CIC-7X4M (or the 4-character suffix).' });
      return;
    }

    const db = getDb();
    const row = db
      .prepare(
        'SELECT id, label, expires_at, used_at, revoked_at FROM enrollment_tokens WHERE short_code = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get(normalized) as
      | {
          id: string;
          label: string;
          expires_at: string;
          used_at: string | null;
          revoked_at: string | null;
        }
      | undefined;

    if (!row) {
      res.status(404).json({ error: `Pairing code ${normalized} was not found.` });
      return;
    }

    claimEnrollmentRowAndCreateHost(req, res, row);
  });

  router.get('/agent/collector.py', (_req: Request, res: Response) => {
    const collectorPath = path.resolve(process.cwd(), 'agent', 'cicada_agent.py');
    if (!fs.existsSync(collectorPath)) {
      res.status(404).send('# Collector script not found');
      return;
    }
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.sendFile(collectorPath);
  });

  router.get('/agent/installer.sh', (req: Request, res: Response) => {
    const token = String(req.query.token || '').trim();
    const verified = verifySignedEnrollmentToken(token);
    if (!verified.valid) {
      res.status(401).setHeader('Content-Type', 'text/plain; charset=utf-8').send(`echo "CICADA enrollment failed: ${verified.reason}" >&2; exit 1`);
      return;
    }

    const baseUrl = resolvePublicBaseUrl(req);
    const enrollUrl = `${baseUrl}/api/agent/enroll?token=${encodeURIComponent(token)}`;
    const collectorUrl = `${baseUrl}/api/agent/collector.py`;

    const script = `#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="$HOME/.cicada-collector"
mkdir -p "$INSTALL_DIR"
echo "[CICADA Tier-1 Collector] Downloading collector agent..."
curl -fsSL "${collectorUrl}" -o "$INSTALL_DIR/cicada_agent.py"
if [ ! -d "$INSTALL_DIR/.venv" ]; then
  python3 -m venv "$INSTALL_DIR/.venv"
fi
"$INSTALL_DIR/.venv/bin/pip" install --quiet --upgrade psutil requests
echo "[CICADA Tier-1 Collector] Pairing with SaaS control plane via authenticated link..."
exec "$INSTALL_DIR/.venv/bin/python" "$INSTALL_DIR/cicada_agent.py" \\
  --enroll-url "${enrollUrl}" \\
  --credentials-file "$INSTALL_DIR/credentials.json" \\
  --local-db "$INSTALL_DIR/agent_local_buffer.db"
`;
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.send(script);
  });

  router.get('/agent/installer.ps1', (req: Request, res: Response) => {
    const token = String(req.query.token || '').trim();
    const verified = verifySignedEnrollmentToken(token);
    if (!verified.valid) {
      res
        .status(401)
        .setHeader('Content-Type', 'text/plain; charset=utf-8')
        .send(`Write-Error "CICADA enrollment failed: ${verified.reason}"; exit 1`);
      return;
    }

    const baseUrl = resolvePublicBaseUrl(req);
    const enrollUrl = `${baseUrl}/api/agent/enroll?token=${encodeURIComponent(token)}`;
    const collectorUrl = `${baseUrl}/api/agent/collector.py`;

    const psScript = `$ErrorActionPreference = "Stop"
$InstallDir = Join-Path $HOME ".cicada-collector"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-Host "[CICADA Tier-1 Collector] Downloading collector agent..."
Invoke-WebRequest -Uri "${collectorUrl}" -OutFile (Join-Path $InstallDir "cicada_agent.py")
$VenvDir = Join-Path $InstallDir ".venv"
if (-not (Test-Path $VenvDir)) {
  python -m venv $VenvDir
}
& (Join-Path $VenvDir "Scripts\\pip.exe") install --quiet --upgrade psutil requests
Write-Host "[CICADA Tier-1 Collector] Pairing local Windows host with Tier-2 SaaS..."
& (Join-Path $VenvDir "Scripts\\python.exe") (Join-Path $InstallDir "cicada_agent.py") \`
  --enroll-url "${enrollUrl}" \`
  --credentials-file (Join-Path $InstallDir "credentials.json") \`
  --local-db (Join-Path $InstallDir "agent_local_buffer.db")
`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(psScript);
  });

  router.post('/agent/offline', requireAgentKey, (req: Request, res: Response) => {
    const hostId = String(req.body.hostId);
    const db = getDb();
    const host = getHostById(hostId);
    if (!host) {
      res.status(404).json({ error: 'Host not found.' });
      return;
    }
    db.prepare('UPDATE hosts SET status = ?, health_score = 0 WHERE id = ?').run('offline', hostId);
    broadcastWsEvent('host:updated', { hostId, status: 'offline' });
    res.json({ ok: true, hostId, status: 'offline' });
  });

  router.post('/agent/heartbeat', requireAgentKey, (req: Request, res: Response) => {
    const hostId = String(req.body.hostId);
    const uptimeSeconds = Math.max(0, Number(req.body.uptimeSeconds || 0));
    const os = req.body.os ? String(req.body.os) : undefined;
    const kernel = req.body.kernel ? String(req.body.kernel) : undefined;
    const agentVersion = req.body.agentVersion ? String(req.body.agentVersion) : 'cicada-py/1.0.0';
    const nowIso = new Date().toISOString();

    const db = getDb();
    const host = getHostById(hostId);
    if (!host) {
      res.status(404).json({ error: 'Host not found.' });
      return;
    }

    db.prepare(`
      UPDATE hosts
      SET status = CASE WHEN status = 'offline' THEN 'online' ELSE status END,
          last_heartbeat = ?,
          uptime_seconds = ?,
          os = COALESCE(?, os),
          kernel = COALESCE(?, kernel),
          agent_version = ?
      WHERE id = ?
    `).run(nowIso, uptimeSeconds, os ?? null, kernel ?? null, agentVersion, hostId);

    broadcastWsEvent('host:heartbeat', { hostId, timestamp: nowIso });
    res.json({ ok: true, hostId, timestamp: nowIso });
  });

  router.get('/tier2/status', requireOperatorAuth, (_req: Request, res: Response) => {
    res.json(getTier2ControlPlaneStatus());
  });

  router.post('/tier2/local-collector/toggle', requireOperatorAuth, (req: Request, res: Response) => {
    const enabled = Boolean(req.body?.enabled);
    const running = setTier1LocalCollectorEnabled(enabled);
    broadcastWsEvent('host:updated', { hostId: 'tier1-runtime-host', running });
    res.json({ ok: true, localCollectorRunning: running });
  });

  router.post('/tier2/browser-probe/register', requireOperatorAuth, (req: Request, res: Response) => {
    const label = String(req.body?.label || 'workstation-browser').trim().slice(0, 80);
    const osName = String(req.body?.os || 'Browser Runtime').trim().slice(0, 120);
    const architecture = String(req.body?.architecture || 'web-client').trim().slice(0, 40);
    const ramTotalGb = Math.max(1, Number(req.body?.ramTotalGb || 8));
    const cores = Math.max(1, Number(req.body?.cores || 4));
    const operator = (req as Request & { operator?: { name: string } }).operator?.name || 'SecOps Lead';

    const linkId = `lnk-${crypto.randomBytes(5).toString('hex')}`;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expMs = nowMs + 15 * 60 * 1000;
    const signedToken = createSignedEnrollmentToken({
      linkId,
      label,
      expMs,
      nonce: crypto.randomBytes(8).toString('hex'),
    });
    const tokenHash = hashEnrollmentToken(signedToken);

    const hostId = `host-web-${crypto.randomBytes(4).toString('hex')}`;
    const rawAgentKey = `cicada_ag_${crypto.randomBytes(20).toString('hex')}`;
    const keyHash = hashAgentKey(rawAgentKey);

    const db = getDb();
    db.prepare(`
      INSERT INTO enrollment_tokens (id, label, token_hash, expires_at, used_at, claimed_host_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(linkId, label, tokenHash, new Date(expMs).toISOString(), nowIso, hostId, operator, nowIso);

    const agentVersion = String(req.body?.agentVersion || 'cicada-browser-probe/1.0.0').trim().slice(0, 60);
    const deviceMetaJson =
      req.body?.deviceMeta && typeof req.body.deviceMeta === 'object'
        ? JSON.stringify(req.body.deviceMeta).slice(0, 1024)
        : null;

    db.prepare(`
      INSERT INTO hosts (
        id, name, hostname, os, kernel, architecture, ip_masked, status, health_score,
        last_heartbeat, uptime_seconds, cpu_pct, ram_pct, ram_used_gb, ram_total_gb,
        disk_pct, disk_used_gb, disk_total_gb, net_rx_kbps, net_tx_kbps, agent_version,
        agent_key_hash, device_meta_json, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'redacted-by-browser', 'online', 100, ?, 0, 0, 0, 0, ?, 0, 0, 1, 0, 0, ?, ?, ?, 0, ?)
    `).run(
      hostId,
      label,
      `client-${hostId}`,
      osName,
      `${cores} logical cores`,
      architecture,
      nowIso,
      ramTotalGb,
      agentVersion,
      keyHash,
      deviceMetaJson,
      nowIso
    );

    const host = getHostById(hostId);
    broadcastWsEvent('host:registered', { host });

    res.status(201).json({
      ok: true,
      hostId,
      agentKey: rawAgentKey,
      linkId,
      host,
    });
  });

  router.post('/metrics/ingest', requireAgentKey, (req: Request, res: Response) => {
    const ingestStartedMs = Date.now();
    const hostId = String(req.body.hostId);
    const host = getHostById(hostId);
    if (!host) {
      res.status(404).json({ error: 'Host not found.' });
      return;
    }

    const cpuPct = Math.min(100, Math.max(0, Number(req.body.cpuPct ?? 0)));
    const ramPct = Math.min(100, Math.max(0, Number(req.body.ramPct ?? 0)));
    const diskPct = Math.min(100, Math.max(0, Number(req.body.diskPct ?? 0)));
    const ramUsedGb = Math.max(0, Number(req.body.ramUsedGb ?? (ramPct / 100) * host.ramTotalGb));
    const ramTotalGb = Math.max(1, Number(req.body.ramTotalGb ?? host.ramTotalGb));
    const diskUsedGb = Math.max(0, Number(req.body.diskUsedGb ?? (diskPct / 100) * host.diskTotalGb));
    const diskTotalGb = Math.max(1, Number(req.body.diskTotalGb ?? host.diskTotalGb));
    const netRxKbps = Math.max(0, Number(req.body.netRxKbps ?? 0));
    const netTxKbps = Math.max(0, Number(req.body.netTxKbps ?? 0));
    const uptimeSeconds = Math.max(0, Number(req.body.uptimeSeconds ?? host.uptimeSeconds));
    const nowIso = new Date().toISOString();

    const settings = getAppSettings();
    const status =
      cpuPct >= settings.thresholds.cpuCritical || ramPct >= settings.thresholds.ramCritical
        ? 'degraded'
        : 'online';
    const healthScore = computeHostHealthScore(status, cpuPct, ramPct, diskPct);

    const db = getDb();
    const prevCpu = host.cpuPct;
    const prevRam = host.ramPct;

    const incomingDeviceMeta =
      req.body?.deviceMeta && typeof req.body.deviceMeta === 'object'
        ? req.body.deviceMeta
        : null;
    const deviceMetaJson = incomingDeviceMeta
      ? JSON.stringify(incomingDeviceMeta).slice(0, 1024)
      : null;

    db.prepare(`
      UPDATE hosts
      SET status = ?, health_score = ?, last_heartbeat = ?, uptime_seconds = ?,
          cpu_pct = ?, ram_pct = ?, ram_used_gb = ?, ram_total_gb = ?,
          disk_pct = ?, disk_used_gb = ?, disk_total_gb = ?,
          net_rx_kbps = ?, net_tx_kbps = ?,
          os = COALESCE(?, os), kernel = COALESCE(?, kernel),
          device_meta_json = COALESCE(?, device_meta_json)
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
      diskPct,
      diskUsedGb,
      diskTotalGb,
      netRxKbps,
      netTxKbps,
      req.body.os ? String(req.body.os) : null,
      req.body.kernel ? String(req.body.kernel) : null,
      deviceMetaJson,
      hostId
    );

    db.prepare(`
      INSERT INTO metrics (host_id, timestamp, cpu_pct, ram_pct, disk_pct, net_rx_kbps, net_tx_kbps, uptime_seconds, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(hostId, nowIso, cpuPct, ramPct, diskPct, netRxKbps, netTxKbps, uptimeSeconds);

    const rawSnapshot: RawLocalTelemetry = {
      hostId,
      hostAlias: host.name,
      hostname: String(req.body.hostname || host.hostname),
      os: String(req.body.os || host.os),
      kernel: String(req.body.kernel || host.kernel),
      localIp: String(req.body.localIp || 'redacted-by-agent'),
      operatorUser: String(req.body.operatorUser || 'agent-local'),
      homeDir: String(req.body.homeDir || '/opt/cicada-agent'),
      uptimeSeconds,
      cpuPct,
      ramPct,
      ramUsedGb,
      ramTotalGb,
      diskPct,
      diskUsedGb,
      diskTotalGb,
      netRxKbps,
      netTxKbps,
      loadAvg: Array.isArray(req.body.loadAvg) ? req.body.loadAvg : [0.5, 0.5, 0.5],
      processes: Array.isArray(req.body.processes) ? req.body.processes.slice(0, 12) : [],
      collectedAt: nowIso,
      isDemo: false,
    };

    db.prepare(`
      INSERT INTO raw_local_snapshots (host_id, raw_json, collected_at, is_demo)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(host_id) DO UPDATE SET raw_json = excluded.raw_json, collected_at = excluded.collected_at
    `).run(hostId, JSON.stringify(rawSnapshot), nowIso);

    const egress = sanitizeTelemetryForEgress(rawSnapshot, settings.privacy);
    const auditId = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    db.prepare(`
      INSERT INTO egress_audits (
        id, host_id, host_name, timestamp, destination, status, fields_sanitized,
        fields_blocked, payload_bytes, payload_hash, approved_payload_json, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      auditId,
      hostId,
      host.name,
      nowIso,
      'cicada-cloud-ingest',
      settings.privacy.cloudSyncEnabled ? 'transmitted' : 'blocked_by_policy',
      egress.fieldsSanitizedCount,
      egress.blockedFieldsCount,
      egress.sanitizedByteSize,
      computePayloadHash(egress.approvedPayload),
      JSON.stringify(egress.approvedPayload)
    );

    const alerts = evaluateMetricAlerts({
      host: { id: hostId, name: host.name, isDemo: false },
      current: { cpuPct, ramPct, diskPct, netRxKbps, netTxKbps, timestamp: nowIso },
      previous: { cpuPct: prevCpu, ramPct: prevRam },
      thresholds: settings.thresholds,
    });

    for (const candidate of alerts) {
      const alertId = `alt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

    const ingestEvent = {
      id: `t2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      hostId,
      hostName: host.name,
      sourceType: classifyCollectorSource(host.agentVersion),
      authMethod: 'X-Agent-Key (SHA-256)',
      cpuPct,
      ramPct,
      diskPct,
      netRxKbps,
      netTxKbps,
      fieldsSanitized: egress.fieldsSanitizedCount + egress.blockedFieldsCount,
      ingestLatencyMs: Math.max(1, Date.now() - ingestStartedMs),
      status: 'accepted' as const,
      reason: 'Authenticated Tier-1 collector payload accepted',
      timestamp: nowIso,
    };
    recordTier2IngestEvent(ingestEvent);
    broadcastWsEvent('tier2:ingest', ingestEvent);

    broadcastWsEvent('metrics:tick', {
      hosts: [
        {
          id: hostId,
          cpuPct,
          ramPct,
          diskPct,
          netRxKbps,
          netTxKbps,
          uptimeSeconds,
          status,
          healthScore,
          timestamp: nowIso,
          deviceMeta: incomingDeviceMeta ?? host.deviceMeta ?? null,
          isDemo: false,
        },
      ],
      timestamp: nowIso,
    });

    res.json({ ok: true, auditId, alertsTriggered: alerts.length });
  });

  router.get('/metrics/history', requireOperatorAuth, (req: Request, res: Response) => {
    const settings = getAppSettings();
    const hostId = req.query.hostId ? String(req.query.hostId) : null;
    const includeDemo =
      req.query.includeDemo !== undefined ? req.query.includeDemo === 'true' : settings.demoModeEnabled;
    const limit = Math.min(500, Math.max(10, Number(req.query.limit || 120)));

    const db = getDb();
    let rows: Array<Record<string, unknown>>;
    if (hostId) {
      rows = db
        .prepare('SELECT * FROM metrics WHERE host_id = ? ORDER BY timestamp DESC LIMIT ?')
        .all(hostId, limit) as Array<Record<string, unknown>>;
    } else if (includeDemo) {
      rows = db
        .prepare('SELECT * FROM metrics ORDER BY timestamp DESC LIMIT ?')
        .all(limit) as Array<Record<string, unknown>>;
    } else {
      rows = db
        .prepare('SELECT * FROM metrics WHERE is_demo = 0 ORDER BY timestamp DESC LIMIT ?')
        .all(limit) as Array<Record<string, unknown>>;
    }

    res.json({
      metrics: rows.reverse().map((r) => ({
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
      })),
    });
  });

  router.get('/alerts', requireOperatorAuth, (req: Request, res: Response) => {
    const settings = getAppSettings();
    const includeDemo =
      req.query.includeDemo !== undefined ? req.query.includeDemo === 'true' : settings.demoModeEnabled;
    res.json({ alerts: listAlerts(includeDemo) });
  });

  const handleAlertTransition = (targetStatus: AlertStatus) => (req: Request, res: Response) => {
    const alertId = String(req.params.id);
    const db = getDb();
    const row = db.prepare('SELECT status FROM alerts WHERE id = ?').get(alertId) as
      | { status: AlertStatus }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Alert not found.' });
      return;
    }

    if (!canTransitionAlertStatus(row.status, targetStatus)) {
      res.status(400).json({ error: `Cannot transition alert from ${row.status} to ${targetStatus}.` });
      return;
    }

    const nowIso = new Date().toISOString();
    const operator = (req as Request & { operator?: { name: string } }).operator?.name || 'SecOps Lead';

    if (targetStatus === 'acknowledged') {
      db.prepare('UPDATE alerts SET status = ?, acknowledged_at = ?, acknowledged_by = ? WHERE id = ?').run(
        targetStatus,
        nowIso,
        operator,
        alertId
      );
    } else if (targetStatus === 'resolved') {
      db.prepare('UPDATE alerts SET status = ?, resolved_at = ? WHERE id = ?').run(
        targetStatus,
        nowIso,
        alertId
      );
    } else {
      db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run(targetStatus, alertId);
    }

    broadcastWsEvent('alert:updated', { id: alertId, status: targetStatus });
    res.json({ ok: true, id: alertId, status: targetStatus });
  };

  router.post('/alerts/:id/acknowledge', requireOperatorAuth, handleAlertTransition('acknowledged'));
  router.post('/alerts/:id/resolve', requireOperatorAuth, handleAlertTransition('resolved'));
  router.post('/alerts/:id/dismiss', requireOperatorAuth, handleAlertTransition('dismissed'));

  router.get('/egress/preview/:hostId', requireOperatorAuth, (req: Request, res: Response) => {
    const hostId = String(req.params.hostId);
    const raw = getLatestRawSnapshot(hostId);
    if (!raw) {
      res.status(404).json({ error: 'No local telemetry snapshot found for this host.' });
      return;
    }
    const settings = getAppSettings();
    const proof = sanitizeTelemetryForEgress(raw, settings.privacy);
    res.json({ proof });
  });

  router.post('/egress/test', requireOperatorAuth, (req: Request, res: Response) => {
    const rawInput = req.body?.rawTelemetry as RawLocalTelemetry | undefined;
    if (!rawInput || !rawInput.hostId || !Array.isArray(rawInput.processes)) {
      res.status(400).json({ error: 'Valid rawTelemetry payload is required.' });
      return;
    }
    const settings = getAppSettings();
    const proof = sanitizeTelemetryForEgress(rawInput, settings.privacy);
    res.json({ proof });
  });

  router.post('/egress/transmit', requireOperatorAuth, (req: Request, res: Response) => {
    const hostId = String(req.body?.hostId || '');
    const customRaw = req.body?.rawTelemetry as RawLocalTelemetry | undefined;
    const raw = customRaw ?? getLatestRawSnapshot(hostId);

    if (!raw) {
      res.status(404).json({ error: 'No local raw snapshot available for transmission.' });
      return;
    }

    const settings = getAppSettings();
    const proof = sanitizeTelemetryForEgress(raw, settings.privacy);
    const nowIso = new Date().toISOString();
    const auditId = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const status = settings.privacy.cloudSyncEnabled ? 'transmitted' : 'blocked_by_policy';

    const db = getDb();
    db.prepare(`
      INSERT INTO egress_audits (
        id, host_id, host_name, timestamp, destination, status, fields_sanitized,
        fields_blocked, payload_bytes, payload_hash, approved_payload_json, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditId,
      raw.hostId,
      raw.hostAlias,
      nowIso,
      settings.privacy.cloudSyncEnabled ? 'cicada-cloud-ingest.local' : 'blocked-locally',
      status,
      proof.fieldsSanitizedCount,
      proof.blockedFieldsCount,
      proof.sanitizedByteSize,
      computePayloadHash(proof.approvedPayload),
      JSON.stringify(proof.approvedPayload),
      raw.isDemo ? 1 : 0
    );

    const insertBlocked = db.prepare(`
      INSERT INTO blocked_fields (id, audit_id, host_id, timestamp, field_path, category, rule_name, redacted_preview, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const det of proof.sensitiveFieldsDetected) {
      insertBlocked.run(
        `blk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        auditId,
        raw.hostId,
        nowIso,
        det.fieldPath,
        det.category,
        det.ruleName,
        `${det.originalSnippet} -> ${det.replacement}`,
        raw.isDemo ? 1 : 0
      );
    }

    broadcastWsEvent('egress:logged', { auditId, hostId: raw.hostId, status });
    res.json({ ok: true, auditId, status, proof });
  });

  router.get('/egress/logs', requireOperatorAuth, (req: Request, res: Response) => {
    const settings = getAppSettings();
    const includeDemo =
      req.query.includeDemo !== undefined ? req.query.includeDemo === 'true' : settings.demoModeEnabled;
    res.json({
      audits: listEgressAudits(includeDemo, 50),
      blockedFields: listBlockedFields(includeDemo, 80),
      exports: listExportHistory(30),
    });
  });

  router.get('/ai/insights', requireOperatorAuth, (req: Request, res: Response) => {
    const settings = getAppSettings();
    const includeDemo =
      req.query.includeDemo !== undefined ? req.query.includeDemo === 'true' : settings.demoModeEnabled;
    res.json({
      insights: listAiInsights(includeDemo, 25),
      geminiConfigured: isGeminiConfigured(),
    });
  });

  router.post('/ai/analyze', requireOperatorAuth, aiRateLimiter, async (req: Request, res: Response) => {
    const hostId = String(req.body?.hostId || '');
    const incidentId = req.body?.incidentId ? String(req.body.incidentId) : undefined;
    const host = getHostById(hostId);

    if (!host) {
      res.status(404).json({ error: 'Host not found.' });
      return;
    }

    const raw = getLatestRawSnapshot(hostId);
    if (!raw) {
      res.status(400).json({ error: 'No telemetry snapshot available to sanitize and analyze.' });
      return;
    }

    const settings = getAppSettings();
    // Privacy-first guarantee: ONLY the sanitized payload ever reaches Gemini!
    const proof = sanitizeTelemetryForEgress(raw, settings.privacy);
    const alerts = listAlerts(settings.demoModeEnabled).filter((a) => a.hostId === hostId);
    const incident = incidentId ? alerts.find((a) => a.id === incidentId) : undefined;

    if (!isGeminiConfigured()) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Set GEMINI_API_KEY in Settings > Secrets to generate live Gemini diagnostics. Pre-seeded DEMO DATA insights remain available below.',
        geminiConfigured: false,
      });
      return;
    }

    try {
      const analysis = await generateTelemetryAnalysis({
        hostName: host.name,
        hostId,
        sanitizedPayload: proof.approvedPayload,
        openAlerts: alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged'),
        incident,
        deviceMeta: host.deviceMeta ?? null,
      });

      const db = getDb();
      db.prepare(`
        INSERT INTO ai_insights (
          id, host_id, host_name, incident_id, summary, observed_metrics_json,
          possible_explanations_json, root_cause_json, troubleshooting_json,
          predictive_json, model_used, privacy_verified, generated_at, is_demo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        analysis.id,
        analysis.hostId,
        analysis.hostName,
        analysis.incidentId ?? null,
        analysis.summary,
        JSON.stringify(analysis.observedMetrics),
        JSON.stringify(analysis.possibleExplanations),
        JSON.stringify(analysis.rootCauseHypotheses),
        JSON.stringify(analysis.troubleshootingSteps),
        JSON.stringify(analysis.predictiveMaintenance),
        analysis.modelUsed,
        analysis.generatedAt,
        analysis.isDemo ? 1 : 0
      );

      res.json({ analysis, sanitizedPayloadUsed: proof.approvedPayload });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini analysis request failed.';
      res.status(502).json({ error: msg });
    }
  });

  router.post('/ai/chat', requireOperatorAuth, aiRateLimiter, async (req: Request, res: Response) => {
    const question = String(req.body?.question || '').trim();
    if (!question || question.length > 1000) {
      res.status(400).json({ error: 'Question must be between 1 and 1000 characters.' });
      return;
    }

    if (!isGeminiConfigured()) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server. Set GEMINI_API_KEY in environment secrets to query the Gemini assistant.',
        geminiConfigured: false,
      });
      return;
    }

    const settings = getAppSettings();
    const hosts = listHosts(settings.demoModeEnabled);
    const sanitizedFleetSummary = hosts.map((h) => {
      const raw = getLatestRawSnapshot(h.id);
      if (raw) {
        return {
          ...sanitizeTelemetryForEgress(raw, settings.privacy).approvedPayload,
          deviceMeta: h.deviceMeta ?? null,
        };
      }
      return {
        hostToken: h.id,
        displayLabel: h.name,
        status: h.status,
        cpuPct: h.cpuPct,
        ramPct: h.ramPct,
        diskPct: h.diskPct,
        deviceMeta: h.deviceMeta ?? null,
      };
    });

    try {
      const result = await chatWithMonitoringAssistant({
        question,
        sanitizedFleetSummary: {
          hosts: sanitizedFleetSummary,
          activeAlerts: listAlerts(settings.demoModeEnabled).filter((a) => a.status === 'open').slice(0, 10),
        },
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini chat failed.';
      res.status(502).json({ error: msg });
    }
  });

  router.get('/reports/export', requireOperatorAuth, (req: Request, res: Response) => {
    const reportType = String(req.query.type || 'metrics');
    const format = req.query.format === 'json' ? 'json' : 'csv';
    const hostId = req.query.hostId ? String(req.query.hostId) : null;
    const settings = getAppSettings();
    const includeDemo = settings.demoModeEnabled;
    const db = getDb();

    let rows: Array<Record<string, unknown>> = [];
    if (reportType === 'alerts') {
      rows = listAlerts(includeDemo).filter((a) => !hostId || a.hostId === hostId) as unknown as Array<
        Record<string, unknown>
      >;
    } else if (reportType === 'egress') {
      rows = listEgressAudits(includeDemo, 200).filter(
        (e) => !hostId || e.hostId === hostId
      ) as unknown as Array<Record<string, unknown>>;
    } else if (reportType === 'hosts') {
      rows = listHosts(includeDemo) as unknown as Array<Record<string, unknown>>;
    } else {
      rows = (
        hostId
          ? db.prepare('SELECT * FROM metrics WHERE host_id = ? ORDER BY timestamp DESC LIMIT 200').all(hostId)
          : db
              .prepare(
                includeDemo
                  ? 'SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 300'
                  : 'SELECT * FROM metrics WHERE is_demo = 0 ORDER BY timestamp DESC LIMIT 300'
              )
              .all()
      ) as Array<Record<string, unknown>>;
    }

    const operator = (req as Request & { operator?: { name: string } }).operator?.name || 'SecOps Lead';
    const exportId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO export_history (id, report_type, format, row_count, exported_by, timestamp, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(exportId, reportType, format, rows.length, operator, nowIso, includeDemo ? 1 : 0);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="cicada-${reportType}-report.json"`);
      res.send(JSON.stringify({ exportedAt: nowIso, reportType, rowCount: rows.length, rows }, null, 2));
      return;
    }

    const headers = rows.length > 0 ? Object.keys(rows[0]) : ['empty'];
    const escapeCsv = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csvLines = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cicada-${reportType}-report.csv"`);
    res.send(csvLines.join('\n'));
  });

  router.get('/settings', requireOperatorAuth, (_req: Request, res: Response) => {
    res.json({
      settings: getAppSettings(),
      geminiConfigured: isGeminiConfigured(),
      firebaseConfigured: isFirebaseClientConfigured(),
    });
  });

  router.put('/settings', requireOperatorAuth, (req: Request, res: Response) => {
    const incoming = req.body?.settings as Partial<AppSettings> | undefined;
    if (!incoming) {
      res.status(400).json({ error: 'Missing settings payload.' });
      return;
    }

    const current = getAppSettings();
    const merged: AppSettings = {
      ...current,
      ...incoming,
      monitoringIntervalSec: Math.max(2, Math.min(300, Number(incoming.monitoringIntervalSec ?? current.monitoringIntervalSec))),
      retentionDays: Math.max(1, Math.min(365, Number(incoming.retentionDays ?? current.retentionDays))),
      profile: { ...current.profile, ...(incoming.profile ?? {}) },
      thresholds: { ...current.thresholds, ...(incoming.thresholds ?? {}) },
      privacy: { ...current.privacy, ...(incoming.privacy ?? {}) },
      agentConfig: { ...current.agentConfig, ...(incoming.agentConfig ?? {}) },
    };

    saveAppSettings(merged);
    const pruned = pruneOldRecords(merged.retentionDays);
    broadcastWsEvent('settings:updated', { settings: merged });
    res.json({ settings: merged, prunedMetrics: pruned });
  });

  // Hackathon Demo Mode Endpoints
  router.get('/demo/state', requireOperatorAuth, (_req: Request, res: Response) => {
    const settings = getAppSettings();
    res.json({
      demoModeEnabled: settings.demoModeEnabled,
      overrides: getDemoOverridesSnapshot(),
    });
  });

  router.post('/demo/toggle', requireOperatorAuth, (req: Request, res: Response) => {
    const enabled = Boolean(req.body?.enabled);
    const current = getAppSettings();
    const next = saveAppSettings({ ...current, demoModeEnabled: enabled });
    broadcastWsEvent('demo:toggled', { demoModeEnabled: enabled });
    res.json({ demoModeEnabled: next.demoModeEnabled });
  });

  router.post('/demo/host-state', requireOperatorAuth, (req: Request, res: Response) => {
    const hostId = String(req.body?.hostId || '');
    const offline = Boolean(req.body?.offline);
    if (!hostId.startsWith('demo-')) {
      res.status(400).json({ error: 'Only demo hosts can be toggled here.' });
      return;
    }

    setDemoHostOverride(hostId, { offline });
    const db = getDb();
    const nowIso = new Date().toISOString();
    if (offline) {
      db.prepare('UPDATE hosts SET status = ?, health_score = 0 WHERE id = ?').run('offline', hostId);
      const host = getHostById(hostId);
      if (host) {
        const alertId = `alt-demo-off-${Date.now()}`;
        db.prepare(`
          INSERT INTO alerts (
            id, host_id, host_name, metric_type, severity, status, title, description,
            observed_value, threshold_value, created_at, is_demo
          ) VALUES (?, ?, ?, 'offline', 'critical', 'open', ?, ?, 'Offline', '90s timeout', ?, 1)
        `).run(
          alertId,
          hostId,
          host.name,
          `Demo host offline: ${host.name}`,
          `Simulated network partition caused ${host.name} heartbeat timeout.`,
          nowIso
        );
        broadcastWsEvent('alert:created', { id: alertId, hostId, severity: 'critical' });
      }
    } else {
      db.prepare('UPDATE hosts SET status = ?, health_score = 92, last_heartbeat = ? WHERE id = ?').run(
        'online',
        nowIso,
        hostId
      );
    }

    broadcastWsEvent('host:updated', { hostId, status: offline ? 'offline' : 'online' });
    res.json({ ok: true, hostId, offline });
  });

  router.post('/demo/trigger-incident', requireOperatorAuth, (req: Request, res: Response) => {
    const scenario = String(req.body?.scenario || 'cpu_spike');
    const hostId = String(req.body?.hostId || 'demo-host-01');
    const host = getHostById(hostId);
    if (!host || !host.isDemo) {
      res.status(404).json({ error: 'Target demo host not found.' });
      return;
    }

    const db = getDb();
    const nowIso = new Date().toISOString();
    const alertId = `alt-sim-${Date.now()}`;

    if (scenario === 'cpu_spike') {
      setDemoHostOverride(hostId, { cpuSpikePct: 96.4 });
      db.prepare('UPDATE hosts SET cpu_pct = 96.4, status = ?, health_score = 48 WHERE id = ?').run(
        'degraded',
        hostId
      );
      db.prepare(`
        INSERT INTO alerts (
          id, host_id, host_name, metric_type, severity, status, title, description,
          observed_value, threshold_value, created_at, is_demo
        ) VALUES (?, ?, ?, 'cpu', 'critical', 'open', ?, ?, '96.4%', '92%', ?, 1)
      `).run(
        alertId,
        hostId,
        host.name,
        `Critical CPU saturation on ${host.name}`,
        'Simulated runaway worker loop pushed CPU utilization to 96.4% across all cores.',
        nowIso
      );
    } else if (scenario === 'memory_leak') {
      setDemoHostOverride(hostId, { ramSpikePct: 95.1 });
      db.prepare('UPDATE hosts SET ram_pct = 95.1, status = ?, health_score = 52 WHERE id = ?').run(
        'degraded',
        hostId
      );
      db.prepare(`
        INSERT INTO alerts (
          id, host_id, host_name, metric_type, severity, status, title, description,
          observed_value, threshold_value, created_at, is_demo
        ) VALUES (?, ?, ?, 'ram', 'critical', 'open', ?, ?, '95.1%', '94%', ?, 1)
      `).run(
        alertId,
        hostId,
        host.name,
        `Critical memory exhaustion on ${host.name}`,
        'Simulated heap leak pushed memory consumption to 95.1%.',
        nowIso
      );
    } else if (scenario === 'disk_full') {
      setDemoHostOverride(hostId, { diskSpikePct: 92.8 });
      db.prepare('UPDATE hosts SET disk_pct = 92.8, status = ? WHERE id = ?').run('degraded', hostId);
      db.prepare(`
        INSERT INTO alerts (
          id, host_id, host_name, metric_type, severity, status, title, description,
          observed_value, threshold_value, created_at, is_demo
        ) VALUES (?, ?, ?, 'disk', 'high', 'open', ?, ?, '92.8%', '90%', ?, 1)
      `).run(
        alertId,
        hostId,
        host.name,
        `Low disk space alert on ${host.name}`,
        'Simulated log burst consumed 92.8% of primary root storage.',
        nowIso
      );
    } else {
      setDemoHostOverride(hostId, { netSpikeKbps: 64200 });
      db.prepare('UPDATE hosts SET net_rx_kbps = 64200, net_tx_kbps = 54570 WHERE id = ?').run(hostId);
      db.prepare(`
        INSERT INTO alerts (
          id, host_id, host_name, metric_type, severity, status, title, description,
          observed_value, threshold_value, created_at, is_demo
        ) VALUES (?, ?, ?, 'network', 'high', 'open', ?, ?, '118,770 Kbps', '45,000 Kbps', ?, 1)
      `).run(
        alertId,
        hostId,
        host.name,
        `Network traffic anomaly on ${host.name}`,
        'Simulated anomalous egress burst reached 118.7 Mbps.',
        nowIso
      );
    }

    broadcastWsEvent('alert:created', { id: alertId, hostId, scenario });
    res.json({ ok: true, alertId, scenario, hostId });
  });

  router.post('/demo/reset', requireOperatorAuth, (_req: Request, res: Response) => {
    clearDemoOverrides();
    seedDemoFleetData();
    broadcastWsEvent('demo:reset', { timestamp: new Date().toISOString() });
    res.json({ ok: true });
  });

  return router;
}
