import { GoogleGenAI, Type } from '@google/genai';
import { ENV, isGeminiConfigured } from '../config/env';
import type {
  AiAnalysisOutput,
  AlertIncident,
  DeviceTelemetryMeta,
  SanitizedCloudPayload,
} from '../../shared/types';

function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: ENV.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateTelemetryAnalysis(params: {
  hostName: string;
  hostId: string;
  sanitizedPayload: SanitizedCloudPayload;
  openAlerts: AlertIncident[];
  incident?: AlertIncident;
  deviceMeta?: DeviceTelemetryMeta | null;
}): Promise<AiAnalysisOutput> {
  const { hostName, hostId, sanitizedPayload, openAlerts, incident, deviceMeta } = params;

  if (!isGeminiConfigured()) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Set GEMINI_API_KEY in environment secrets to run live Gemini analysis.'
    );
  }

  const ai = createGeminiClient();
  const promptContext = {
    privacyGuarantee: 'Sanitized telemetry only. Raw usernames, paths, and credentials were stripped before egress.',
    hostToken: sanitizedPayload.hostToken,
    osFamily: sanitizedPayload.osFamily,
    deviceTelemetry: deviceMeta ?? null,
    metrics: {
      cpuPct: sanitizedPayload.cpuPct,
      ramPct: sanitizedPayload.ramPct,
      diskPct: sanitizedPayload.diskPct,
      netRxKbps: sanitizedPayload.netRxKbps,
      netTxKbps: sanitizedPayload.netTxKbps,
      loadAvg: sanitizedPayload.loadAvg,
      uptimeSeconds: sanitizedPayload.uptimeSeconds,
    },
    topSanitizedProcesses: sanitizedPayload.processes.slice(0, 6),
    activeAlerts: openAlerts.map((a) => ({
      severity: a.severity,
      metric: a.metricType,
      title: a.title,
      observed: a.observedValue,
      threshold: a.thresholdValue,
    })),
    focusIncident: incident
      ? {
          id: incident.id,
          severity: incident.severity,
          title: incident.title,
          description: incident.description,
        }
      : null,
  };

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Analyze this sanitized IT observability snapshot and return structured JSON diagnostics:\n${JSON.stringify(promptContext, null, 2)}`,
    config: {
      systemInstruction:
        'You are a senior SRE and cybersecurity observability analyst for CICADA 2026. ' +
        'Strictly distinguish verified facts in "observedMetrics" (citing only numbers present in the payload) ' +
        'from speculative causes in "possibleExplanations" and "rootCauseHypotheses" (prefixing hypotheses with careful language). ' +
        'Keep recommendations concise, actionable, and privacy-preserving.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING, description: 'Concise 1-2 sentence executive summary.' },
          observedMetrics: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Strictly factual observations directly from the numeric telemetry.',
          },
          possibleExplanations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Potential non-proven explanations separated clearly from facts.',
          },
          rootCauseHypotheses: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                hypothesis: { type: Type.STRING },
                confidence: { type: Type.STRING, description: 'high, medium, or low' },
                supportingEvidence: { type: Type.STRING },
              },
            },
          },
          troubleshootingSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          predictiveMaintenance: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as {
    summary?: string;
    observedMetrics?: string[];
    possibleExplanations?: string[];
    rootCauseHypotheses?: Array<{ hypothesis: string; confidence: string; supportingEvidence: string }>;
    troubleshootingSteps?: string[];
    predictiveMaintenance?: string[];
  };

  const normalizedHypotheses = (parsed.rootCauseHypotheses ?? []).map((h) => ({
    hypothesis: h.hypothesis,
    confidence: (['high', 'medium', 'low'].includes(h.confidence) ? h.confidence : 'medium') as
      | 'high'
      | 'medium'
      | 'low',
    supportingEvidence: h.supportingEvidence,
  }));

  return {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    hostId,
    hostName,
    incidentId: incident?.id,
    summary: parsed.summary || 'Telemetry analysis completed.',
    observedMetrics: parsed.observedMetrics ?? [],
    possibleExplanations: parsed.possibleExplanations ?? [],
    rootCauseHypotheses: normalizedHypotheses,
    troubleshootingSteps: parsed.troubleshootingSteps ?? [],
    predictiveMaintenance: parsed.predictiveMaintenance ?? [],
    modelUsed: 'gemini-4-hydrogen',
    privacyVerified: true,
    generatedAt: new Date().toISOString(),
    isDemo: sanitizedPayload.isDemo,
  };
}

export async function chatWithMonitoringAssistant(params: {
  question: string;
  sanitizedFleetSummary: unknown;
}): Promise<{ reply: string; modelUsed: string }> {
  if (!isGeminiConfigured()) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Configure GEMINI_API_KEY in Settings > Secrets to chat with live Gemini.'
    );
  }

  const ai = createGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Sanitized Fleet Telemetry Snapshot:\n${JSON.stringify(params.sanitizedFleetSummary, null, 2)}\n\nOperator Question: ${params.question}`,
    config: {
      systemInstruction:
        'You are the CICADA 2026 Smart Observability Assistant. Answer the operator question using ONLY the sanitized fleet telemetry provided. ' +
        'Clearly separate observed numbers ("Observed:") from hypotheses ("Possible explanation:"). Never invent hosts or metrics not present in the context.',
    },
  });

  return {
    reply: (response.text ?? 'No response generated.').trim(),
    modelUsed: 'gemini-4-hydrogen',
  };
}
