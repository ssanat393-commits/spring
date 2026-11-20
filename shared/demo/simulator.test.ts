import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_HOST_PROFILES, generateDemoHostTelemetry } from './simulator';

test('DEMO_HOST_PROFILES includes at least 3 simulated hosts', () => {
  assert.ok(DEMO_HOST_PROFILES.length >= 3);
});

test('generateDemoHostTelemetry marks payloads as isDemo and respects spike overrides', () => {
  const raw = generateDemoHostTelemetry(
    DEMO_HOST_PROFILES[0],
    5,
    '2026-11-20T06:12:00.000Z',
    { cpuSpikePct: 96.8 }
  );

  assert.equal(raw.isDemo, true);
  assert.equal(raw.cpuPct, 96.8);
  assert.ok(raw.processes.length >= 3);
  assert.ok(raw.envHints && Object.keys(raw.envHints).length > 0);
});
