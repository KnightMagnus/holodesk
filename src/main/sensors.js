// Optional hardware sensor sources that are cheaper or more complete than WMI.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const NVIDIA_FIELDS = 'utilization.gpu,temperature.gpu,memory.used,memory.total,clocks.gr,fan.speed,power.draw';

const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function parseNvidiaLine(line) {
  const parts = String(line).trim().split(',').map((s) => num(s.trim()));
  if (parts.length < 7 || parts.every((p) => p === null)) return null;
  const [util, temp, memUsed, memTotal, clock, fan, power] = parts;
  return { util, temp, memUsed, memTotal, clock, fan, power };
}

/**
 * One long-running `nvidia-smi --loop-ms` process instead of spawning nvidia-smi
 * every poll. Emits a parsed reading per line. Marks itself missing on machines
 * without an NVIDIA driver so it is never retried.
 */
export function createNvidiaStream({ intervalMs = 2000, spawnFn = spawn, onReading }) {
  let child = null;
  let missing = false;
  return {
    get missing() {
      return missing;
    },
    start() {
      if (child || missing) return;
      const args = [`--query-gpu=${NVIDIA_FIELDS}`, '--format=csv,noheader,nounits', `--loop-ms=${intervalMs}`];
      const proc = spawnFn('nvidia-smi', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      child = proc;
      proc.on('error', (err) => {
        if (err.code === 'ENOENT') missing = true;
        if (child === proc) child = null;
      });
      proc.on('exit', () => {
        if (child === proc) child = null;
      });
      // multi-GPU systems print one line per GPU per tick; the first is the primary
      let lastTick = 0;
      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        const now = Date.now();
        if (now - lastTick < intervalMs / 2) return;
        const reading = parseNvidiaLine(line);
        if (!reading) return;
        lastTick = now;
        onReading(reading);
      });
    },
    stop() {
      const proc = child;
      child = null;
      proc?.kill();
    }
  };
}

// ---------------------------------------------------------------------------
// LibreHardwareMonitor (https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
// If the user runs it with Options > Remote Web Server enabled, it serves a sensor tree
// at :8085/data.json. It reads CPU temperatures that WMI cannot (without admin) and
// covers AMD and Intel GPUs that nvidia-smi does not.

export const LHM_URL = 'http://127.0.0.1:8085/data.json';

function sensorValue(node) {
  if (typeof node.RawValue === 'number') return node.RawValue;
  return num(node.Value);
}

export function parseLhm(tree) {
  const sensors = [];
  (function walk(node, hardware) {
    if (!node || typeof node !== 'object') return;
    const hw = node.HardwareId || hardware;
    if (node.SensorId && node.Type) sensors.push({ id: node.SensorId, type: node.Type, name: node.Text || '', hw: hw || node.SensorId, value: sensorValue(node) });
    for (const c of node.Children || []) walk(c, hw);
  })(tree, null);

  const pick = (hwRe, type, nameRe) => {
    const hits = sensors.filter((s) => hwRe.test(s.hw) && s.type === type && s.value !== null);
    return (nameRe && hits.find((s) => nameRe.test(s.name))) || hits[0] || null;
  };
  const CPU = /\/(amdcpu|intelcpu)\//;
  const GPU = /\/gpu-(nvidia|amd|intel)\//;

  const cpuTemp = pick(CPU, 'Temperature', /package|tctl|tdie/i)?.value ?? null;
  const gpuTemp = pick(GPU, 'Temperature', /core|hot ?spot/i);
  let gpu = null;
  if (gpuTemp || pick(GPU, 'Load')) {
    gpu = {
      util: pick(GPU, 'Load', /^gpu core$|d3d 3d/i)?.value ?? null,
      temp: gpuTemp?.value ?? null,
      clock: pick(GPU, 'Clock', /core/i)?.value ?? null,
      fan: pick(GPU, 'Control', /fan/i)?.value ?? null,
      power: pick(GPU, 'Power', /package|total|core/i)?.value ?? null,
      memUsed: pick(GPU, 'SmallData', /memory used|dedicated memory used/i)?.value ?? null,
      memTotal: pick(GPU, 'SmallData', /memory total|dedicated memory total/i)?.value ?? null
    };
  }
  return { cpuTemp, gpu };
}
