import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionAlertStatus,
  computeHostHealthScore,
  DEFAULT_THRESHOLDS,
  evaluateMetricAlerts,
  findStaleRealHostIds,
  isHostHeartbeatStale,
} from './rules';

test('evaluateMetricAlerts emits critical CPU and high network alerts when thresholds exceeded', () => {
  const alerts = evaluateMetricAlerts({
    host: { id: 'h-1', name: 'api-01', isDemo: true },
    current: {
      cpuPct: 95.4,
      ramPct: 60.0,
      diskPct: 50.0,
      netRxKbps: 30000,
      netTxKbps: 20000,
      timestamp: '2026-11-20T06:10:00.000Z',
    },
    previous: { cpuPct: 40.0, ramPct: 58.0 },
    thresholds: DEFAULT_THRESHOLDS,
  });

  assert.equal(alerts.some((a) => a.metricType === 'cpu' && a.severity === 'critical'), true);
  assert.equal(alerts.some((a) => a.metricType === 'network' && a.severity === 'high'), true);
  assert.equal(alerts.some((a) => a.metricType === 'anomaly' && a.severity === 'medium'), true);
});

test('isHostHeartbeatStale accurately detects offline hosts', () => {
  const now = Date.parse('2026-11-20T06:10:00.000Z');
  assert.equal(isHostHeartbeatStale('2026-11-20T06:08:00.000Z', now, 90), true);
  assert.equal(isHostHeartbeatStale('2026-11-20T06:09:30.000Z', now, 90), false);
});

test('findStaleRealHostIds ignores demo hosts, already-offline hosts, and excluded hosts', () => {
  const now = Date.parse('2026-11-20T06:10:00.000Z');
  const stale = findStaleRealHostIds(
    [
      { id: 'host-real-stale', isDemo: false, status: 'online', lastHeartbeat: '2026-11-20T06:08:00.000Z' },
      { id: 'host-real-fresh', isDemo: false, status: 'online', lastHeartbeat: '2026-11-20T06:09:40.000Z' },
      { id: 'host-real-offline', isDemo: false, status: 'offline', lastHeartbeat: '2026-11-20T06:00:00.000Z' },
      { id: 'demo-host-01', isDemo: true, status: 'online', lastHeartbeat: '2026-11-20T06:00:00.000Z' },
      { id: 'tier1-runtime-host', isDemo: false, status: 'online', lastHeartbeat: '2026-11-20T06:00:00.000Z' },
    ],
    now,
    45,
    ['tier1-runtime-host']
  );
  assert.deepEqual(stale, ['host-real-stale']);
});

test('computeHostHealthScore drops to 0 when offline and scales down under load', () => {
  assert.equal(computeHostHealthScore('offline', 20, 20, 20), 0);
  assert.equal(computeHostHealthScore('online', 40, 50, 50), 100);
  assert.ok(computeHostHealthScore('degraded', 95, 92, 88) < 60);
});

test('canTransitionAlertStatus enforces valid lifecycle transitions', () => {
  assert.equal(canTransitionAlertStatus('open', 'acknowledged'), true);
  assert.equal(canTransitionAlertStatus('acknowledged', 'resolved'), true);
  assert.equal(canTransitionAlertStatus('resolved', 'acknowledged'), false);
  assert.equal(canTransitionAlertStatus('open', 'open'), false);
});
