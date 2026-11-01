import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { parseNvidiaLine, parseLhm, createNvidiaStream } from '../../src/main/sensors.js';
import lhmTree from '../fixtures/lhm-data.json' with { type: 'json' };

test('parses an nvidia-smi CSV line', () => {
  assert.deepEqual(parseNvidiaLine('37, 58, 6123, 16376, 2610, 41, 162.35'), {
    util: 37, temp: 58, memUsed: 6123, memTotal: 16376, clock: 2610, fan: 41, power: 162.35
  });
});

test('nvidia-smi [N/A] fields become null; junk lines are ignored', () => {
  const r = parseNvidiaLine('12, 50, 900, 8192, 1500, [N/A], [N/A]');
  assert.equal(r.fan, null);
  assert.equal(r.power, null);
  assert.equal(parseNvidiaLine(''), null);
  assert.equal(parseNvidiaLine('NVIDIA-SMI has failed'), null);
});

test('LibreHardwareMonitor tree: CPU package temp and AMD GPU sensors', () => {
  const r = parseLhm(lhmTree);
  assert.equal(r.cpuTemp, 61.5);
  assert.deepEqual(r.gpu, { util: 44, temp: 63, clock: 2450, fan: 38, power: 210.4, memUsed: 7012, memTotal: 16368 });
});

test('LibreHardwareMonitor tree without RawValue falls back to formatted Value', () => {
  const strip = (n) => ({ ...n, RawValue: undefined, Children: (n.Children || []).map(strip) });
  assert.equal(parseLhm(strip(lhmTree)).cpuTemp, 61.5);
});

test('LibreHardwareMonitor tree with no GPU yields gpu null', () => {
  assert.deepEqual(parseLhm({ Children: [] }), { cpuTemp: null, gpu: null });
});

function fakeSpawn() {
  const procs = [];
  const fn = () => {
    const p = new EventEmitter();
    p.stdout = new PassThrough();
    p.kill = () => p.emit('exit');
    procs.push(p);
    return p;
  };
  return { fn, procs };
}

test('nvidia stream parses lines and stops its process', async () => {
  const { fn, procs } = fakeSpawn();
  const readings = [];
  const s = createNvidiaStream({ spawnFn: fn, onReading: (r) => readings.push(r) });
  s.start();
  procs[0].stdout.write('50, 60, 1000, 8000, 1800, 30, 120\n');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(readings[0].util, 50);
  s.stop();
  s.start();
  assert.equal(procs.length, 2, 'restart spawns a fresh process');
});

test('nvidia stream marks itself missing when nvidia-smi is not installed', () => {
  const { fn, procs } = fakeSpawn();
  const s = createNvidiaStream({ spawnFn: fn, onReading: () => {} });
  s.start();
  procs[0].emit('error', Object.assign(new Error('spawn nvidia-smi ENOENT'), { code: 'ENOENT' }));
  assert.equal(s.missing, true);
  s.start();
  assert.equal(procs.length, 1, 'never retried');
});
