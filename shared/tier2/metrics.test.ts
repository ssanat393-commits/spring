import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyCollectorSource,
  computeCpuUsageFromProcStat,
  parseProcNetDevTotals,
  parseProcStatTotals,
  parsePsOutput,
} from './metrics';

test('classifyCollectorSource distinguishes runtime OS, mobile probe, browser probe, and python psutil collectors', () => {
  assert.equal(classifyCollectorSource('cicada-tier1-os/1.0.0'), 'linux_os_collector');
  assert.equal(classifyCollectorSource('cicada-mobile-probe/1.0.0'), 'mobile_probe');
  assert.equal(classifyCollectorSource('cicada-browser-probe/1.0.0'), 'browser_probe');
  assert.equal(classifyCollectorSource('cicada-py/1.1.0'), 'python_psutil');
  assert.equal(classifyCollectorSource('custom-agent/2.0'), 'registered_agent');
});

test('parseProcStatTotals and computeCpuUsageFromProcStat compute accurate CPU percentage delta', () => {
  const prev = parseProcStatTotals('cpu  1000 0 200 8800 0 0 0 0 0 0\ncpu0 500 0 100 4400');
  const curr = parseProcStatTotals('cpu  1350 0 350 9300 0 0 0 0 0 0\ncpu0 650 0 150 4650');
  assert.ok(prev && curr);
  // total delta = (1350+350+9300) - (1000+200+8800) = 11000 - 10000 = 1000
  // idle delta = 9300 - 8800 = 500 -> busy = 50%
  assert.equal(computeCpuUsageFromProcStat(prev, curr), 50);
});

test('parseProcNetDevTotals ignores loopback and aggregates non-loopback RX/TX bytes', () => {
  const sample = [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets',
    '    lo: 9999999   100    0    0    0     0          0         0  9999999   100',
    '  eth0: 1200000    50    0    0    0     0          0         0   450000    30',
    ' wlan0:  300000    20    0    0    0     0          0         0    50000    10',
  ].join('\n');

  const totals = parseProcNetDevTotals(sample);
  assert.equal(totals.rxBytes, 1500000);
  assert.equal(totals.txBytes, 500000);
});

test('parsePsOutput parses live ps process table safely', () => {
  const psText = [
    '  PID COMMAND         %CPU %MEM USER     COMMAND',
    '  142 node             3.4  1.8 root     tsx server.ts --token=secret',
    '   88 python3          1.1  0.6 appuser  python3 /home/appuser/collector.py',
  ].join('\n');

  const procs = parsePsOutput(psText, 5);
  assert.equal(procs.length, 2);
  assert.equal(procs[0].pid, 142);
  assert.equal(procs[0].name, 'node');
  assert.equal(procs[0].cpuPct, 3.4);
  assert.equal(procs[1].user, 'appuser');
});
