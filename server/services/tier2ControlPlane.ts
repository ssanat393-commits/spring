import {
  getDb,
  getTier2IngestCounts,
  listAlerts,
  listEgressAudits,
  listEnrollmentLinks,
  listHosts,
  listTier2IngestEvents,
  recordTier2IngestEvent,
} from '../db/sqlite';
import type { Tier2ControlPlaneStatus } from '../../shared/types';
import { broadcastWsEvent, getWsClientCount } from './realtime';
import { isTier1LocalCollectorRunning, TIER1_RUNTIME_HOST_ID } from './tier1LocalCollector';

const tier2BootMs = Date.now();

export function recordTier2AuthRejection(hostId: string, reason: string): void {
  const event = {
    id: `t2-rej-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    hostId: hostId || 'unknown',
    hostName: hostId || 'unauthenticated-caller',
    sourceType: 'registered_agent' as const,
    authMethod: 'X-Agent-Key (SHA-256)',
    cpuPct: 0,
    ramPct: 0,
    diskPct: 0,
    netRxKbps: 0,
    netTxKbps: 0,
    fieldsSanitized: 0,
    ingestLatencyMs: 1,
    status: 'rejected' as const,
    reason,
    timestamp: new Date().toISOString(),
  };
  recordTier2IngestEvent(event);
  broadcastWsEvent('tier2:ingest', event);
}

export function getTier2ControlPlaneStatus(): Tier2ControlPlaneStatus {
  const realHosts = listHosts(false);
  const links = listEnrollmentLinks(100);
  const counts = getTier2IngestCounts();
  const realAlerts = listAlerts(false).filter((a) => a.status === 'open' || a.status === 'acknowledged');
  const realAudits = listEgressAudits(false, 200).filter((a) => a.status === 'transmitted');

  const db = getDb();
  const activeRealCollectors = realHosts.filter((h) => h.status !== 'offline').length;
  const hostRowsCount = (
    db.prepare('SELECT COUNT(*) as c FROM tier2_ingest_events').get() as { c: number }
  ).c;
  void hostRowsCount;

  return {
    tier: 'tier-2-cloud-saas',
    uptimeSeconds: Math.floor((Date.now() - tier2BootMs) / 1000),
    localCollectorRunning: isTier1LocalCollectorRunning(),
    localCollectorHostId: TIER1_RUNTIME_HOST_ID,
    activeRealCollectors,
    totalAcceptedPackets: counts.accepted,
    totalRejectedAuth: counts.rejected,
    wsClientsConnected: getWsClientCount(),
    pendingEnrollmentLinks: links.filter((l) => l.status === 'pending').length,
    claimedEnrollmentLinks: links.filter((l) => l.status === 'claimed').length,
    egressVerifiedRealCount: realAudits.length,
    openRealAlertsCount: realAlerts.length,
    realHosts,
    recentIngestEvents: listTier2IngestEvents(30),
  };
}
