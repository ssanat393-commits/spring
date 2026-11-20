import type {
  AiAnalysisOutput,
  AlertIncident,
  AppSettings,
  AuthSession,
  BlockedFieldLogEntry,
  DataExportRecord,
  EgressAuditRecord,
  EgressProofResult,
  EnrollmentLinkRecord,
  HostRecord,
  MetricPoint,
  RawLocalTelemetry,
  Tier2ControlPlaneStatus,
} from '../../shared/types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('cicada_session_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export const api = {
  getHealth: () =>
    requestJson<{
      status: string;
      geminiConfigured: boolean;
      firebaseConfigured: boolean;
      demoModeEnabled: boolean;
    }>('/api/health'),

  getSession: () => requestJson<AuthSession>('/api/auth/session'),

  updateSession: (payload: { name: string; email: string; role: string }) =>
    requestJson<{ authenticated: boolean; token: string; user: AuthSession['user'] }>(
      '/api/auth/session',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  getHosts: (includeDemo?: boolean) =>
    requestJson<{ hosts: HostRecord[]; demoModeEnabled: boolean; localCollectorRunning?: boolean }>(
      includeDemo === undefined ? '/api/hosts' : `/api/hosts?includeDemo=${includeDemo}`
    ),

  getHostDetail: (hostId: string, limit = 60) =>
    requestJson<{ host: HostRecord; history: MetricPoint[]; rawSnapshot: RawLocalTelemetry | null }>(
      `/api/hosts/${encodeURIComponent(hostId)}?limit=${limit}`
    ),

  registerHost: (payload: {
    name: string;
    hostname: string;
    os: string;
    architecture: string;
    ramTotalGb: number;
    diskTotalGb: number;
  }) =>
    requestJson<{ host: HostRecord; agentKey: string; instructions: string }>(
      '/api/agent/register',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  getNetworkInfo: () =>
    requestJson<{
      requestOrigin: string;
      appUrl: string;
      isAiStudioDevHost: boolean;
      isLocalhostOrigin?: boolean;
      sharedAppUrl: string | null;
      sharedAppReachable: boolean;
      sharedAppHttpStatus?: number | null;
      lanUrls: string[];
    }>('/api/agent/network-info'),

  getEnrollmentLinks: () =>
    requestJson<{ links: EnrollmentLinkRecord[] }>('/api/agent/enrollment-links'),

  createEnrollmentLink: (payload: { label: string; ttlMinutes: number; publicBaseUrl?: string }) =>
    requestJson<{
      link: EnrollmentLinkRecord;
      shortCode: string;
      shortPairUrl: string;
      pairCodePageUrl: string;
      pairPageUrl: string;
      enrollmentUrl: string;
      installerCommand: string;
      powershellCommand: string;
      pythonCommand: string;
    }>('/api/agent/enrollment-link', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  enrollWithToken: async (
    token: string,
    payload: {
      hostname: string;
      os: string;
      kernel: string;
      architecture: string;
      ramTotalGb: number;
      diskTotalGb: number;
      agentVersion: string;
      deviceMeta?: HostRecord['deviceMeta'];
    }
  ) => {
    const res = await fetch(`/api/agent/enroll?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(
        (data as { error?: string }).error || `Enrollment failed (${res.status})`,
        res.status
      );
    }
    return data as {
      ok: boolean;
      hostId: string;
      agentKey: string;
      serverUrl: string;
      host: HostRecord;
    };
  },

  enrollWithCode: async (
    code: string,
    payload: {
      deviceLabel?: string;
      hostname: string;
      os: string;
      kernel: string;
      architecture: string;
      ramTotalGb: number;
      diskTotalGb: number;
      agentVersion: string;
      deviceMeta?: HostRecord['deviceMeta'];
    }
  ) => {
    const res = await fetch('/api/agent/enroll-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(
        (data as { error?: string }).error || `Pairing code failed (${res.status})`,
        res.status
      );
    }
    return data as {
      ok: boolean;
      hostId: string;
      agentKey: string;
      serverUrl: string;
      host: HostRecord;
    };
  },

  revokeEnrollmentLink: (id: string) =>
    requestJson<{ ok: boolean; id: string }>(`/api/agent/enrollment-links/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getTier2Status: () => requestJson<Tier2ControlPlaneStatus>('/api/tier2/status'),

  toggleTier1LocalCollector: (enabled: boolean) =>
    requestJson<{ ok: boolean; localCollectorRunning: boolean }>('/api/tier2/local-collector/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  registerBrowserProbe: (payload: {
    label: string;
    os: string;
    architecture: string;
    ramTotalGb: number;
    cores: number;
    agentVersion?: string;
    deviceMeta?: HostRecord['deviceMeta'];
  }) =>
    requestJson<{ ok: boolean; hostId: string; agentKey: string; linkId: string; host: HostRecord }>(
      '/api/tier2/browser-probe/register',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  ingestCollectorTelemetry: async (
    agentKey: string,
    payload: Record<string, unknown>
  ): Promise<{ ok: boolean; auditId: string }> => {
    const res = await fetch('/api/metrics/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Key': agentKey,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(
        (data as { error?: string }).error || `Ingest failed (${res.status})`,
        res.status
      );
    }
    return data as { ok: boolean; auditId: string };
  },

  setAgentOffline: async (hostId: string, agentKey: string): Promise<{ ok: boolean }> => {
    const res = await fetch('/api/agent/offline', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Key': agentKey,
      },
      body: JSON.stringify({ hostId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `Offline update failed (${res.status})`);
    }
    return data as { ok: boolean };
  },

  deleteHost: (hostId: string) =>
    requestJson<{ deleted: boolean; hostId: string }>(`/api/hosts/${encodeURIComponent(hostId)}`, {
      method: 'DELETE',
    }),

  cleanupOfflineHosts: () =>
    requestJson<{ deletedCount: number; deletedIds: string[] }>('/api/hosts/cleanup/offline', {
      method: 'DELETE',
    }),

  getMetricsHistory: (hostId?: string, limit = 120) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (hostId) qs.set('hostId', hostId);
    return requestJson<{ metrics: MetricPoint[] }>(`/api/metrics/history?${qs.toString()}`);
  },

  getAlerts: () => requestJson<{ alerts: AlertIncident[] }>('/api/alerts'),

  acknowledgeAlert: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/alerts/${encodeURIComponent(id)}/acknowledge`, {
      method: 'POST',
    }),

  resolveAlert: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/alerts/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
    }),

  dismissAlert: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/alerts/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
    }),

  getEgressPreview: (hostId: string) =>
    requestJson<{ proof: EgressProofResult }>(`/api/egress/preview/${encodeURIComponent(hostId)}`),

  testEgressSanitization: (rawTelemetry: RawLocalTelemetry) =>
    requestJson<{ proof: EgressProofResult }>('/api/egress/test', {
      method: 'POST',
      body: JSON.stringify({ rawTelemetry }),
    }),

  transmitSanitizedEgress: (payload: { hostId?: string; rawTelemetry?: RawLocalTelemetry }) =>
    requestJson<{ ok: boolean; auditId: string; status: string; proof: EgressProofResult }>(
      '/api/egress/transmit',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  getEgressLogs: () =>
    requestJson<{
      audits: EgressAuditRecord[];
      blockedFields: BlockedFieldLogEntry[];
      exports: DataExportRecord[];
    }>('/api/egress/logs'),

  getAiInsights: () =>
    requestJson<{ insights: AiAnalysisOutput[]; geminiConfigured: boolean }>('/api/ai/insights'),

  analyzeWithGemini: (payload: { hostId: string; incidentId?: string }) =>
    requestJson<{ analysis: AiAnalysisOutput; sanitizedPayloadUsed: unknown }>('/api/ai/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  chatWithGemini: (question: string) =>
    requestJson<{ reply: string; modelUsed: string }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  getSettings: () =>
    requestJson<{
      settings: AppSettings;
      geminiConfigured: boolean;
      firebaseConfigured: boolean;
    }>('/api/settings'),

  saveSettings: (settings: AppSettings) =>
    requestJson<{ settings: AppSettings; prunedMetrics: number }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    }),

  toggleDemoMode: (enabled: boolean) =>
    requestJson<{ demoModeEnabled: boolean }>('/api/demo/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  setDemoHostState: (hostId: string, offline: boolean) =>
    requestJson<{ ok: boolean }>('/api/demo/host-state', {
      method: 'POST',
      body: JSON.stringify({ hostId, offline }),
    }),

  triggerDemoIncident: (hostId: string, scenario: string) =>
    requestJson<{ ok: boolean; alertId: string }>('/api/demo/trigger-incident', {
      method: 'POST',
      body: JSON.stringify({ hostId, scenario }),
    }),

  resetDemoFleet: () => requestJson<{ ok: boolean }>('/api/demo/reset', { method: 'POST' }),
};
