import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePersonalDeviceTelemetry,
  classifyNetworkQuality,
  isPersonalDeviceHost,
} from './insights';
import type { HostRecord, MetricPoint } from '../types';

const SAMPLE_PERSONAL_HOST: HostRecord = {
  id: 'host-web-1234',
  name: 'windows-device',
  hostname: 'client-host-web-1234',
  os: 'Windows (Desktop Web)',
  kernel: '8 logical cores',
  architecture: '8-core web-client',
  ipMasked: 'redacted-by-browser',
  status: 'online',
  healthScore: 95,
  lastHeartbeat: '2026-11-20T18:30:00.000Z',
  uptimeSeconds: 1800,
  cpuPct: 14.5,
  ramPct: 68.2,
  ramUsedGb: 0.08,
  ramTotalGb: 8,
  diskPct: 1.2,
  diskUsedGb: 0.4,
  diskTotalGb: 32,
  netRxKbps: 1240,
  netTxKbps: 140,
  agentVersion: 'cicada-browser-probe/1.0.0',
  deviceMeta: {
    deviceKind: 'workstation',
    batteryPct: 18,
    batteryCharging: false,
    networkType: '4g',
    downlinkMbps: 25,
    rttMs: 42,
    screen: '1920x1080',
    cores: 8,
  },
  isDemo: false,
  createdAt: '2026-11-20T18:00:00.000Z',
};

test('isPersonalDeviceHost distinguishes personal/mobile probes from servers and demo hosts', () => {
  assert.equal(isPersonalDeviceHost(SAMPLE_PERSONAL_HOST), true);
  assert.equal(
    isPersonalDeviceHost({ ...SAMPLE_PERSONAL_HOST, isDemo: true }),
    false
  );
  assert.equal(
    isPersonalDeviceHost({
      ...SAMPLE_PERSONAL_HOST,
      id: 'tier1-runtime-host',
      agentVersion: 'cicada-tier1-os/1.0.0',
      deviceMeta: null,
    }),
    false
  );
});

test('classifyNetworkQuality rates latency thresholds accurately', () => {
  assert.equal(classifyNetworkQuality(35), 'Excellent');
  assert.equal(classifyNetworkQuality(110), 'Good');
  assert.equal(classifyNetworkQuality(220), 'Fair');
  assert.equal(classifyNetworkQuality(410), 'Slow');
  assert.equal(classifyNetworkQuality(null), 'Unknown');
});

test('analyzePersonalDeviceTelemetry computes stats and low-battery warning', () => {
  const history: MetricPoint[] = [
    {
      hostId: 'host-web-1234',
      timestamp: '2026-11-20T18:28:00.000Z',
      cpuPct: 10,
      ramPct: 60,
      diskPct: 1,
      netRxKbps: 1000,
      netTxKbps: 100,
      uptimeSeconds: 1700,
      isDemo: false,
    },
    {
      hostId: 'host-web-1234',
      timestamp: '2026-11-20T18:29:00.000Z',
      cpuPct: 20,
      ramPct: 70,
      diskPct: 1.5,
      netRxKbps: 1500,
      netTxKbps: 150,
      uptimeSeconds: 1760,
      isDemo: false,
    },
  ];

  const report = analyzePersonalDeviceTelemetry(SAMPLE_PERSONAL_HOST, history);
  assert.equal(report.sampleCount, 2);
  assert.equal(report.avgCpuPct, 15);
  assert.equal(report.peakCpuPct, 20);
  assert.equal(report.avgRamPct, 65);
  assert.equal(report.networkQuality, 'Excellent');
  assert.equal(report.powerSummary, '18% · On battery');
  assert.ok(report.recommendations.some((r) => r.includes('Battery is low')));
});
