export type HostStatus = 'online' | 'degraded' | 'offline';
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';
export type NavPageId =
  | 'overview'
  | 'monitoring'
  | 'hosts'
  | 'connect-devices'
  | 'tier2-saas'
  | 'alerts'
  | 'ai-insights'
  | 'egress-proof'
  | 'reports'
  | 'settings'
  | 'demo-mode';

export interface ProcessEntry {
  pid: number;
  name: string;
  cpuPct: number;
  memPct: number;
  user?: string;
  cmdline: string;
}

export interface RawLocalTelemetry {
  hostId: string;
  hostAlias: string;
  hostname: string;
  os: string;
  kernel: string;
  localIp: string;
  operatorUser: string;
  homeDir: string;
  uptimeSeconds: number;
  cpuPct: number;
  ramPct: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
  netRxKbps: number;
  netTxKbps: number;
  loadAvg: [number, number, number];
  processes: ProcessEntry[];
  envHints?: Record<string, string>;
  collectedAt: string;
  isDemo: boolean;
}

export interface PrivacyControls {
  cloudSyncEnabled: boolean;
  shareHostnames: boolean;
  shareProcessNames: boolean;
  shareProcessArgs: boolean;
  shareNetworkRates: boolean;
  redactUsernames: boolean;
  redactFilePaths: boolean;
  redactCredentials: boolean;
  redactInternalIps: boolean;
}

export type SensitiveCategory =
  | 'username'
  | 'file_path'
  | 'credential'
  | 'process_arg'
  | 'ip_address'
  | 'hostname'
  | 'email';

export interface SensitiveFieldDetection {
  id: string;
  fieldPath: string;
  category: SensitiveCategory;
  originalSnippet: string;
  replacement: string;
  action: 'redacted' | 'blocked' | 'hashed';
  ruleName: string;
}

export interface SanitizedProcessEntry {
  pid: number;
  name: string;
  cpuPct: number;
  memPct: number;
  sanitizedCmd: string;
}

export interface SanitizedCloudPayload {
  hostToken: string;
  displayLabel: string;
  osFamily: string;
  uptimeSeconds: number;
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  netRxKbps: number | null;
  netTxKbps: number | null;
  loadAvg: [number, number, number];
  processes: SanitizedProcessEntry[];
  collectedAt: string;
  privacyPolicyHash: string;
  isDemo: boolean;
}

export interface EgressProofResult {
  rawLocal: RawLocalTelemetry;
  sensitiveFieldsDetected: SensitiveFieldDetection[];
  fieldsSanitizedCount: number;
  blockedFieldsCount: number;
  approvedPayload: SanitizedCloudPayload;
  policyControls: PrivacyControls;
  rawByteSize: number;
  sanitizedByteSize: number;
  generatedAt: string;
}

export interface EgressAuditRecord {
  id: string;
  hostId: string;
  hostName: string;
  timestamp: string;
  destination: string;
  status: 'transmitted' | 'blocked_by_policy' | 'preview_only';
  fieldsSanitized: number;
  fieldsBlocked: number;
  payloadBytes: number;
  payloadHash: string;
  approvedPayloadJson: string;
  isDemo: boolean;
}

export interface BlockedFieldLogEntry {
  id: string;
  auditId: string;
  hostId: string;
  timestamp: string;
  fieldPath: string;
  category: SensitiveCategory;
  ruleName: string;
  redactedPreview: string;
  isDemo: boolean;
}

export interface DataExportRecord {
  id: string;
  reportType: string;
  format: 'csv' | 'json';
  rowCount: number;
  exportedBy: string;
  timestamp: string;
  isDemo: boolean;
}

export interface DeviceTelemetryMeta {
  deviceKind: 'phone' | 'tablet' | 'laptop' | 'server' | 'workstation' | 'edge';
  batteryPct?: number | null;
  batteryCharging?: boolean | null;
  networkType?: string;
  downlinkMbps?: number | null;
  rttMs?: number | null;
  screen?: string;
  cores?: number | null;
}

export interface HostRecord {
  id: string;
  name: string;
  hostname: string;
  os: string;
  kernel: string;
  architecture: string;
  ipMasked: string;
  status: HostStatus;
  healthScore: number;
  lastHeartbeat: string;
  uptimeSeconds: number;
  cpuPct: number;
  ramPct: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
  netRxKbps: number;
  netTxKbps: number;
  agentVersion: string;
  deviceMeta?: DeviceTelemetryMeta | null;
  isDemo: boolean;
  createdAt: string;
}

export interface MetricPoint {
  id?: number;
  hostId: string;
  timestamp: string;
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  netRxKbps: number;
  netTxKbps: number;
  uptimeSeconds: number;
  isDemo: boolean;
}

export interface AlertIncident {
  id: string;
  hostId: string;
  hostName: string;
  metricType: 'cpu' | 'ram' | 'disk' | 'network' | 'offline' | 'anomaly';
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  observedValue: string;
  thresholdValue: string;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  acknowledgedBy: string | null;
  isDemo: boolean;
}

export interface AlertThresholds {
  cpuWarning: number;
  cpuCritical: number;
  ramWarning: number;
  ramCritical: number;
  diskWarning: number;
  diskCritical: number;
  networkSpikeKbps: number;
  offlineTimeoutSec: number;
}

export interface AppSettings {
  profile: {
    displayName: string;
    email: string;
    role: string;
    organization: string;
  };
  monitoringIntervalSec: number;
  retentionDays: number;
  theme: 'dark' | 'light';
  demoModeEnabled: boolean;
  thresholds: AlertThresholds;
  privacy: PrivacyControls;
  agentConfig: {
    heartbeatIntervalSec: number;
    collectProcessArgsLocally: boolean;
    localSqliteBufferMaxMb: number;
  };
}

export interface AiAnalysisOutput {
  id: string;
  hostId: string;
  hostName: string;
  incidentId?: string;
  summary: string;
  observedMetrics: string[];
  possibleExplanations: string[];
  rootCauseHypotheses: Array<{
    hypothesis: string;
    confidence: 'high' | 'medium' | 'low';
    supportingEvidence: string;
  }>;
  troubleshootingSteps: string[];
  predictiveMaintenance: string[];
  modelUsed: string;
  privacyVerified: boolean;
  generatedAt: string;
  isDemo: boolean;
}

export interface AuthSession {
  authenticated: boolean;
  provider: 'local' | 'firebase';
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

export interface EnrollmentLinkRecord {
  id: string;
  label: string;
  shortCode?: string | null;
  status: 'pending' | 'claimed' | 'expired' | 'revoked';
  expiresAt: string;
  usedAt: string | null;
  claimedHostId: string | null;
  createdBy: string;
  createdAt: string;
}

export type CollectorSourceType =
  | 'linux_os_collector'
  | 'mobile_probe'
  | 'browser_probe'
  | 'python_psutil'
  | 'registered_agent';

export interface Tier2IngestEvent {
  id: string;
  hostId: string;
  hostName: string;
  sourceType: CollectorSourceType;
  authMethod: string;
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  netRxKbps: number;
  netTxKbps: number;
  fieldsSanitized: number;
  ingestLatencyMs: number;
  status: 'accepted' | 'rejected';
  reason: string;
  timestamp: string;
}

export interface Tier2ControlPlaneStatus {
  tier: 'tier-2-cloud-saas';
  uptimeSeconds: number;
  localCollectorRunning: boolean;
  localCollectorHostId: string;
  activeRealCollectors: number;
  totalAcceptedPackets: number;
  totalRejectedAuth: number;
  wsClientsConnected: number;
  pendingEnrollmentLinks: number;
  claimedEnrollmentLinks: number;
  egressVerifiedRealCount: number;
  openRealAlertsCount: number;
  realHosts: HostRecord[];
  recentIngestEvents: Tier2IngestEvent[];
}

