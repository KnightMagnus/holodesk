import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetry } from '../../src/main/telemetry.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeSi(overrides = {}) {
  const calls = {};
  const count = (name, value) => async () => {
    calls[name] = (calls[name] || 0) + 1;
    return typeof value === 'function' ? value() : value;
  };
  return {
    calls,
    si: {
      currentLoad: count('currentLoad', { currentLoad: 25, cpus: [{ load: 20 }, { load: 30 }] }),
      networkStats: count('networkStats', [{ rx_sec: 100, tx_sec: 50 }, { rx_sec: null, tx_sec: 5 }]),
      processes: count('processes', { all: 3, list: [{ name: 'Idle', cpu: 99, memRss: 1 }, { name: 'a', cpu: 5, memRss: 2 }, { name: 'b', cpu: 9, memRss: 4 }] }),
      cpuTemperature: count('cpuTemperature', { main: null }),
      mem: count('mem', { swapused: 1, swaptotal: 2 }),
      fsSize: count('fsSize', [{ mount: 'C:', size: 10, used: 5 }, { mount: '/snap/x', size: 1, used: 1 }]),
      powerShellStart: () => { calls.psStart = (calls.psStart || 0) + 1; },
      powerShellRelease: () => { calls.psRelease = (calls.psRelease || 0) + 1; },
      ...overrides
    }
  };
}

const quietNvidia = () => ({ start() {}, stop() {} });
const noLhm = async () => null;

test('start polls every probe once and pushes snapshots; stop halts everything', async () => {
  const { si, calls } = fakeSi();
  const updates = [];
  const t = createTelemetry({ si, platform: 'linux', createNvidia: quietNvidia, fetchLhm: noLhm, onUpdate: (s) => updates.push(s) });
  t.start();
  await wait(30);
  const s = t.snapshot();
  assert.equal(s.cpu.load, 25);
  assert.deepEqual(s.cpu.cores, [20, 30]);
  assert.deepEqual(s.net, { rx: 100, tx: 55 });
  assert.deepEqual(s.procs.map((p) => p.name), ['b', 'a'], 'idle process filtered, sorted by cpu');
  assert.equal(s.procs[0].mem, 4096, 'memRss KB converted to bytes');
  assert.deepEqual(s.drives.map((d) => d.mount), ['C:']);
  assert.ok(updates.length >= 1);
  t.stop();
  const before = calls.currentLoad;
  await wait(1200);
  assert.equal(calls.currentLoad, before, 'no polling after stop');
});

test('persistent PowerShell is only used on Windows and released on stop', async () => {
  const { si, calls } = fakeSi();
  const t = createTelemetry({ si, platform: 'win32', createNvidia: quietNvidia, fetchLhm: noLhm });
  t.start();
  t.start();
  assert.equal(calls.psStart, 1);
  t.stop();
  assert.equal(calls.psRelease, 1);
  const linux = fakeSi();
  const t2 = createTelemetry({ si: linux.si, platform: 'linux', createNvidia: quietNvidia, fetchLhm: noLhm });
  t2.start();
  t2.stop();
  assert.equal(linux.calls.psStart, undefined);
});

test('a probe that hangs does not stay busy forever', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0;
  const { si } = fakeSi({
    fsSize: () => {
      calls++;
      return new Promise(() => {});
    }
  });
  const tel = createTelemetry({ si, platform: 'linux', createNvidia: quietNvidia, fetchLhm: noLhm });
  tel.start();
  assert.equal(calls, 1);
  t.mock.timers.tick(60000); // interval fires while the first call is still pending
  assert.equal(calls, 1, 'no overlapping calls');
  t.mock.timers.tick(120000); // deadline releases the probe, next interval runs it again
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(60000);
  assert.ok(calls >= 2, `expected a retry after the deadline, got ${calls} calls`);
  tel.stop();
});

test('LibreHardwareMonitor supplies CPU temp and GPU when present', async () => {
  const { si } = fakeSi();
  const tree = { Children: [
    { HardwareId: '/intelcpu/0', Children: [{ SensorId: '/intelcpu/0/temperature/0', Type: 'Temperature', Text: 'CPU Package', RawValue: 70 }] },
    { HardwareId: '/gpu-intel/0', Children: [{ SensorId: '/gpu-intel/0/load/0', Type: 'Load', Text: 'D3D 3D', RawValue: 12 }] }
  ] };
  const t = createTelemetry({ si, platform: 'linux', createNvidia: quietNvidia, fetchLhm: async () => tree });
  t.start();
  await wait(30);
  const s = t.snapshot();
  assert.equal(s.cpu.temp, 70);
  assert.equal(s.sources.cpuTemp, 'LibreHardwareMonitor');
  assert.equal(s.gpu.util, 12);
  t.stop();
});

test('NVIDIA readings win over LibreHardwareMonitor for the same fields', async () => {
  const { si } = fakeSi();
  const createNvidia = ({ onReading }) => ({
    start: () => onReading({ util: 90, temp: 70, memUsed: null, memTotal: null, clock: null, fan: null, power: null }),
    stop() {}
  });
  const tree = { Children: [{ HardwareId: '/gpu-nvidia/0', Children: [
    { SensorId: '/gpu-nvidia/0/load/0', Type: 'Load', Text: 'GPU Core', RawValue: 10 },
    { SensorId: '/gpu-nvidia/0/temperature/0', Type: 'Temperature', Text: 'GPU Core', RawValue: 50 },
    { SensorId: '/gpu-nvidia/0/power/0', Type: 'Power', Text: 'GPU Package', RawValue: 200 }
  ] }] };
  const t = createTelemetry({ si, platform: 'linux', createNvidia, fetchLhm: async () => tree });
  t.start();
  await wait(30);
  const gpu = t.snapshot().gpu;
  assert.equal(gpu.util, 90, 'nvidia-smi wins');
  assert.equal(gpu.temp, 70);
  assert.equal(gpu.power, 200, 'LHM fills the gap');
  assert.equal(t.snapshot().sources.gpu, 'nvidia-smi');
  t.stop();
});
