import type { HostRecord, RawLocalTelemetry } from '../types';

export interface DemoHostProfile {
  id: string;
  name: string;
  hostname: string;
  os: string;
  kernel: string;
  architecture: string;
  localIp: string;
  ipMasked: string;
  operatorUser: string;
  homeDir: string;
  ramTotalGb: number;
  diskTotalGb: number;
  baseCpu: number;
  baseRam: number;
  baseDisk: number;
  baseNetRx: number;
  baseNetTx: number;
  uptimeStartSec: number;
}

export const DEMO_HOST_PROFILES: DemoHostProfile[] = [
  {
    id: 'demo-host-01',
    name: 'prod-api-eu-01',
    hostname: 'eu-west-core-01.internal.corp',
    os: 'Ubuntu 24.04.1 LTS',
    kernel: '6.8.0-45-generic',
    architecture: 'x86_64',
    localIp: '10.24.18.42',
    ipMasked: '10.24.x.x',
    operatorUser: 'a.sharma',
    homeDir: '/home/a.sharma/ops-deploy',
    ramTotalGb: 64,
    diskTotalGb: 512,
    baseCpu: 44,
    baseRam: 58,
    baseDisk: 61,
    baseNetRx: 8400,
    baseNetTx: 6100,
    uptimeStartSec: 1842900,
  },
  {
    id: 'demo-host-02',
    name: 'ml-inference-node-04',
    hostname: 'gpu-worker-04.prod.local',
    os: 'Debian 12.6 Bookworm',
    kernel: '6.1.0-25-amd64',
    architecture: 'x86_64',
    localIp: '10.24.19.108',
    ipMasked: '10.24.x.x',
    operatorUser: 'priya.nair',
    homeDir: '/home/priya.nair/model-weights',
    ramTotalGb: 128,
    diskTotalGb: 2048,
    baseCpu: 68,
    baseRam: 74,
    baseDisk: 72,
    baseNetRx: 14200,
    baseNetTx: 9800,
    uptimeStartSec: 954200,
  },
  {
    id: 'demo-host-03',
    name: 'edge-gateway-02',
    hostname: 'edge-gw-blr-02.dmz.local',
    os: 'Ubuntu 22.04.4 LTS',
    kernel: '5.15.0-119-generic',
    architecture: 'arm64',
    localIp: '172.16.40.15',
    ipMasked: '172.16.x.x',
    operatorUser: 'rohan.verma',
    homeDir: '/home/rohan.verma/gateway-certs',
    ramTotalGb: 16,
    diskTotalGb: 128,
    baseCpu: 31,
    baseRam: 48,
    baseDisk: 53,
    baseNetRx: 19600,
    baseNetTx: 18400,
    uptimeStartSec: 3120400,
  },
  {
    id: 'demo-host-04',
    name: 'db-replica-us-03',
    hostname: 'pg-replica-03.vault.internal',
    os: 'Red Hat Enterprise Linux 9.4',
    kernel: '5.14.0-427-el9',
    architecture: 'x86_64',
    localIp: '10.24.22.77',
    ipMasked: '10.24.x.x',
    operatorUser: 'dba_karthik',
    homeDir: '/home/dba_karthik/pg-backups',
    ramTotalGb: 96,
    diskTotalGb: 1024,
    baseCpu: 52,
    baseRam: 81,
    baseDisk: 83,
    baseNetRx: 11200,
    baseNetTx: 13900,
    uptimeStartSec: 4210000,
  },
];

export interface DemoSimulationOverrides {
  offline?: boolean;
  cpuSpikePct?: number;
  ramSpikePct?: number;
  diskSpikePct?: number;
  netSpikeKbps?: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function generateDemoHostTelemetry(
  profile: DemoHostProfile,
  tick: number,
  timestampIso: string,
  overrides: DemoSimulationOverrides = {}
): RawLocalTelemetry {
  const phase = tick * 0.45 + profile.name.length;
  const cpuWave = Math.sin(phase) * 9 + Math.cos(phase * 0.5) * 5;
  const ramWave = Math.sin(phase * 0.3) * 4;
  const netWave = Math.abs(Math.sin(phase * 0.8)) * 4500;

  const cpuPct = overrides.cpuSpikePct ?? clamp(profile.baseCpu + cpuWave, 6, 98);
  const ramPct = overrides.ramSpikePct ?? clamp(profile.baseRam + ramWave, 15, 97);
  const diskPct = overrides.diskSpikePct ?? clamp(profile.baseDisk + (tick % 10) * 0.05, 10, 96);
  const netRxKbps = overrides.netSpikeKbps ?? Math.round(profile.baseNetRx + netWave);
  const netTxKbps = overrides.netSpikeKbps
    ? Math.round(overrides.netSpikeKbps * 0.85)
    : Math.round(profile.baseNetTx + netWave * 0.72);

  return {
    hostId: profile.id,
    hostAlias: profile.name,
    hostname: profile.hostname,
    os: profile.os,
    kernel: profile.kernel,
    localIp: profile.localIp,
    operatorUser: profile.operatorUser,
    homeDir: profile.homeDir,
    uptimeSeconds: profile.uptimeStartSec + tick * 3,
    cpuPct: Number(cpuPct.toFixed(1)),
    ramPct: Number(ramPct.toFixed(1)),
    ramUsedGb: Number(((ramPct / 100) * profile.ramTotalGb).toFixed(1)),
    ramTotalGb: profile.ramTotalGb,
    diskPct: Number(diskPct.toFixed(1)),
    diskUsedGb: Number(((diskPct / 100) * profile.diskTotalGb).toFixed(1)),
    diskTotalGb: profile.diskTotalGb,
    netRxKbps,
    netTxKbps,
    loadAvg: [
      Number(((cpuPct / 100) * 4.2).toFixed(2)),
      Number(((cpuPct / 100) * 3.8).toFixed(2)),
      Number(((cpuPct / 100) * 3.4).toFixed(2)),
    ],
    processes: [
      {
        pid: 1420,
        name: 'uvicorn-worker',
        cpuPct: Number((cpuPct * 0.42).toFixed(1)),
        memPct: Number((ramPct * 0.24).toFixed(1)),
        user: profile.operatorUser,
        cmdline: `/home/${profile.operatorUser}/.venv/bin/python -m uvicorn app:main --env-file /home/${profile.operatorUser}/secrets/.env --token=ghp_demoToken981273645123456`,
      },
      {
        pid: 2811,
        name: 'postgres-sync',
        cpuPct: Number((cpuPct * 0.19).toFixed(1)),
        memPct: Number((ramPct * 0.31).toFixed(1)),
        user: 'postgres',
        cmdline: `pg_dump postgresql://replica:${profile.operatorUser}_pwd99@${profile.localIp}:5432/prod_telemetry`,
      },
      {
        pid: 3904,
        name: 'node-exporter',
        cpuPct: Number((cpuPct * 0.08).toFixed(1)),
        memPct: 3.4,
        user: profile.operatorUser,
        cmdline: `node /Users/${profile.operatorUser}/agent/dist/index.js --api-key=AIzaSyDemoKeyValue123456789012345`,
      },
      {
        pid: 5112,
        name: 'nginx-ingress',
        cpuPct: Number((cpuPct * 0.11).toFixed(1)),
        memPct: 5.1,
        user: 'www-data',
        cmdline: `nginx: worker process -c ${profile.homeDir}/nginx.conf`,
      },
    ],
    envHints: {
      GEMINI_API_KEY: 'AIzaSyLocalSecretShouldNeverLeaveHost999',
      DB_PASSWORD: `super_secret_${profile.operatorUser}_2026`,
      ADMIN_EMAIL: `${profile.operatorUser}@internal.corp`,
    },
    collectedAt: timestampIso,
    isDemo: true,
  };
}

export function buildInitialDemoHostRecord(profile: DemoHostProfile, nowIso: string): HostRecord {
  return {
    id: profile.id,
    name: profile.name,
    hostname: profile.hostname,
    os: profile.os,
    kernel: profile.kernel,
    architecture: profile.architecture,
    ipMasked: profile.ipMasked,
    status: 'online',
    healthScore: 94,
    lastHeartbeat: nowIso,
    uptimeSeconds: profile.uptimeStartSec,
    cpuPct: profile.baseCpu,
    ramPct: profile.baseRam,
    ramUsedGb: Number(((profile.baseRam / 100) * profile.ramTotalGb).toFixed(1)),
    ramTotalGb: profile.ramTotalGb,
    diskPct: profile.baseDisk,
    diskUsedGb: Number(((profile.baseDisk / 100) * profile.diskTotalGb).toFixed(1)),
    diskTotalGb: profile.diskTotalGb,
    netRxKbps: profile.baseNetRx,
    netTxKbps: profile.baseNetTx,
    agentVersion: 'cicada-demo-sim/2026.1',
    isDemo: true,
    createdAt: nowIso,
  };
}
