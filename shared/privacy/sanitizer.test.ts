import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRIVACY_CONTROLS, sanitizeTelemetryForEgress } from './sanitizer';
import type { RawLocalTelemetry } from '../types';

const SAMPLE_RAW: RawLocalTelemetry = {
  hostId: 'host-real-01',
  hostAlias: 'billing-core-01',
  hostname: 'billing-core-01.corp.internal',
  os: 'Ubuntu 24.04 LTS',
  kernel: '6.8.0',
  localIp: '10.12.44.88',
  operatorUser: 'alice.chen',
  homeDir: '/Users/alice.chen/workspace',
  uptimeSeconds: 86400,
  cpuPct: 74.2,
  ramPct: 68.5,
  ramUsedGb: 21.9,
  ramTotalGb: 32,
  diskPct: 55.0,
  diskUsedGb: 220,
  diskTotalGb: 400,
  netRxKbps: 4200,
  netTxKbps: 1900,
  loadAvg: [1.42, 1.25, 1.08],
  processes: [
    {
      pid: 101,
      name: 'python3',
      cpuPct: 35.4,
      memPct: 18.2,
      user: 'alice.chen',
      cmdline:
        'python3 /Users/alice.chen/app/worker.py --bind 10.12.44.88 --token=ghp_1234567890abcdef1234567890 --dsn=postgresql://admin:SecretPass123@10.12.44.88:5432/prod',
    },
    {
      pid: 202,
      name: 'node',
      cpuPct: 12.1,
      memPct: 8.4,
      user: 'alice.chen',
      cmdline: 'node /home/alice.chen/srv.js --api-key=AIzaSyTestFakeKey123456789012345',
    },
  ],
  envHints: {
    GEMINI_API_KEY: 'AIzaSySecretEnvKey1234567890123456',
    DB_PASSWORD: 'MySuperSecretPassword',
  },
  collectedAt: '2026-11-20T06:00:00.000Z',
  isDemo: false,
};

test('sanitizeTelemetryForEgress strips usernames, personal paths, credentials, and IPs from approved payload', () => {
  const result = sanitizeTelemetryForEgress(SAMPLE_RAW, DEFAULT_PRIVACY_CONTROLS);
  const serialized = JSON.stringify(result.approvedPayload);

  assert.equal(serialized.includes('alice.chen'), false);
  assert.equal(serialized.includes('/Users/alice.chen'), false);
  assert.equal(serialized.includes('/home/alice.chen'), false);
  assert.equal(serialized.includes('ghp_1234567890'), false);
  assert.equal(serialized.includes('SecretPass123'), false);
  assert.equal(serialized.includes('AIzaSyTestFakeKey'), false);
  assert.equal(serialized.includes('10.12.44.88'), false);
  assert.equal(serialized.includes('billing-core-01.corp.internal'), false);
  assert.ok(result.fieldsSanitizedCount >= 1);
  assert.ok(result.blockedFieldsCount >= 4);
  assert.equal(result.approvedPayload.cpuPct, 74.2);
});

test('sanitizeTelemetryForEgress sanitizes process args even when shareProcessArgs is enabled', () => {
  const result = sanitizeTelemetryForEgress(SAMPLE_RAW, {
    ...DEFAULT_PRIVACY_CONTROLS,
    shareProcessArgs: true,
    shareHostnames: true,
  });

  const cmd0 = result.approvedPayload.processes[0].sanitizedCmd;
  const cmd1 = result.approvedPayload.processes[1].sanitizedCmd;

  assert.ok(cmd0.includes('[REDACTED_PERSONAL_PATH]'));
  assert.ok(cmd0.includes('[REDACTED_SECRET]'));
  assert.ok(cmd0.includes('[REDACTED_IP]'));
  assert.equal(cmd0.includes('10.12.44.88'), false);
  assert.equal(cmd0.includes('SecretPass123'), false);
  assert.equal(cmd1.includes('AIzaSyTestFakeKey'), false);
  assert.equal(result.approvedPayload.displayLabel, 'billing-core-01.corp.internal');
});

test('sanitizeTelemetryForEgress withholds network rates when shareNetworkRates is false', () => {
  const result = sanitizeTelemetryForEgress(SAMPLE_RAW, {
    ...DEFAULT_PRIVACY_CONTROLS,
    shareNetworkRates: false,
  });

  assert.equal(result.approvedPayload.netRxKbps, null);
  assert.equal(result.approvedPayload.netTxKbps, null);
});
