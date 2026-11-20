import { useState, type FormEvent } from 'react';
import { Send, ShieldCheck, Sparkles } from 'lucide-react';
import type { AiAnalysisOutput, AlertIncident, HostRecord } from '../../../shared/types';
import { api } from '../../services/api';
import { formatDateTime } from '../../utils/format';

interface AiInsightsViewProps {
  hosts: HostRecord[];
  alerts: AlertIncident[];
  insights: AiAnalysisOutput[];
  geminiConfigured: boolean;
  onRefreshInsights: () => void;
}

export function AiInsightsView({
  hosts,
  alerts,
  insights,
  geminiConfigured,
  onRefreshInsights,
}: AiInsightsViewProps) {
  const [selectedHostId, setSelectedHostId] = useState(hosts[0]?.id ?? '');
  const [selectedIncidentId, setSelectedIncidentId] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: 'user' | 'assistant'; text: string; model?: string }>
  >([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const effectiveHostId = hosts.some((h) => h.id === selectedHostId)
    ? selectedHostId
    : hosts[0]?.id ?? '';

  const hostAlerts = alerts.filter((a) => a.hostId === effectiveHostId);

  const handleAnalyze = async () => {
    if (!effectiveHostId) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      await api.analyzeWithGemini({
        hostId: effectiveHostId,
        incidentId: selectedIncidentId || undefined,
      });
      onRefreshInsights();
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Gemini analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleChat = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setChatError(null);
    setChatHistory((prev) => [...prev, { role: 'user', text: q }]);
    setQuestion('');
    setChatLoading(true);
    try {
      const res = await api.chatWithGemini(q);
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', text: res.reply, model: res.modelUsed },
      ]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Gemini assistant query failed.');
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Control Banner */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <span>Privacy-Verified Gemini Telemetry Diagnostics</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              All host metrics pass through Egress Proof sanitization on the server before reaching Gemini. Raw credentials and paths never leave your host boundary.
            </p>
          </div>
          <div className="text-xs font-mono">
            {geminiConfigured ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                Server Gemini API Ready
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                GEMINI_API_KEY Not Configured (Demo Baseline Shown)
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="ai-host-select" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Target Host
            </label>
            <select
              id="ai-host-select"
              value={effectiveHostId}
              onChange={(e) => {
                setSelectedHostId(e.target.value);
                setSelectedIncidentId('');
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.isDemo ? 'DEMO DATA' : 'Agent'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ai-incident-select" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Optional Incident Context
            </label>
            <select
              id="ai-incident-select"
              value={selectedIncidentId}
              onChange={(e) => setSelectedIncidentId(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="">General Host Health</option>
              {hostAlerts.map((a) => (
                <option key={a.id} value={a.id}>
                  [{a.severity.toUpperCase()}] {a.title}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing || !effectiveHostId}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-60 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{analyzing ? 'Analyzing Sanitized Snapshot…' : 'Analyze with Gemini'}</span>
          </button>
        </div>

        {analyzeError && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            {analyzeError}
          </div>
        )}
      </div>

      {/* Main Grid: Structured Insights + Natural Language Assistant */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          {insights.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800/80 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.hostName}
                    </h3>
                    {item.isDemo && (
                      <span className="text-[10px] font-mono font-semibold text-purple-600 dark:text-purple-400">
                        DEMO DATA
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                    {item.modelUsed} · {formatDateTime(item.generatedAt)}
                  </div>
                </div>
                {item.privacyVerified && (
                  <div className="inline-flex items-center gap-1 text-xs font-medium text-cyan-600 dark:text-cyan-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Sanitized Payload Only</span>
                  </div>
                )}
              </div>

              <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                {item.summary}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                <div>
                  <h4 className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 mb-2">
                    Verified Observed Metrics (Facts)
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                    {item.observedMetrics.map((obs, idx) => (
                      <li key={idx}>{obs}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-2">
                    Possible Explanations (Hypotheses)
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                    {item.possibleExplanations.map((exp, idx) => (
                      <li key={idx}>{exp}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {item.rootCauseHypotheses.length > 0 && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80">
                  <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                    Root-Cause Hypotheses
                  </h4>
                  <div className="space-y-2">
                    {item.rootCauseHypotheses.map((h, idx) => (
                      <div key={idx} className="text-xs">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {h.hypothesis}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 ml-2 font-mono">
                          (Confidence: {h.confidence})
                        </span>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          Evidence: {h.supportingEvidence}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                <div>
                  <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                    Troubleshooting Recommendations
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 list-decimal pl-4">
                    {item.troubleshootingSteps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                    Predictive Maintenance
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                    {item.predictiveMaintenance.map((pm, idx) => (
                      <li key={idx}>{pm}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
          {insights.length === 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No AI diagnostics generated yet. Select a host above and click Analyze with Gemini.
            </div>
          )}
        </div>

        {/* Natural-Language Monitoring Assistant */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] p-5 flex flex-col h-[540px]">
          <div className="pb-3 border-b border-slate-200 dark:border-slate-800/80">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Monitoring Assistant
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Ask natural-language questions over sanitized fleet telemetry.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-3">
            {chatHistory.length === 0 && (
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <p>Try asking:</p>
                <button
                  type="button"
                  onClick={() => setQuestion('Which host currently has the highest disk or memory pressure and why?')}
                  className="block w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 text-slate-700 dark:text-slate-300"
                >
                  Which host currently has the highest disk or memory pressure?
                </button>
                <button
                  type="button"
                  onClick={() => setQuestion('Summarize active incidents and distinguish observed metrics from hypotheses.')}
                  className="block w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 text-slate-700 dark:text-slate-300"
                >
                  Summarize active incidents and hypotheses.
                </button>
              </div>
            )}

            {chatHistory.map((msg, idx) => (
              <div
                key={idx}
                className={`rounded-lg p-3 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-cyan-600 text-white ml-6'
                    : 'bg-slate-100 dark:bg-slate-800/70 text-slate-800 dark:text-slate-200 mr-4 whitespace-pre-wrap'
                }`}
              >
                {msg.text}
                {msg.model && (
                  <div className="mt-1.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {msg.model}
                  </div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="text-xs text-slate-500 dark:text-slate-400">Querying Gemini…</div>
            )}
            {chatError && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                {chatError}
              </div>
            )}
          </div>

          <form onSubmit={handleChat} className="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about fleet metrics…"
              aria-label="Ask monitoring assistant"
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#070B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={chatLoading || !question.trim()}
              aria-label="Send question"
              className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
