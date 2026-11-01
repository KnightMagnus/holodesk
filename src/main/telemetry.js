// Hardware telemetry.
//
// On Windows most systeminformation calls shell out to PowerShell/WMI. Polled naively
// that costs more CPU than the numbers are worth (it is what made eDEX-UI heavy). So:
//   - each metric polls on its own interval, sized to how fast it changes
//   - one persistent PowerShell session is shared (si.powerShellStart)
//   - NVIDIA stats stream from a single nvidia-smi process
//   - LibreHardwareMonitor is used when present for temps WMI cannot read
//   - polls never overlap, and everything stops while the window is hidden
//   - probes that keep returning nothing are retired for the session
import os from 'node:os';
import { createNvidiaStream, parseLhm, LHM_URL } from './sensors.js';

export function createTelemetry({
  si,
  platform = process.platform,
  onUpdate,
  log = () => {},
  createNvidia = createNvidiaStream,
  fetchLhm = defaultFetchLhm
}) {
  const latest = {
    cpu: { load: 0, cores: [], temp: null, speed: null },
    mem: { used: 0, total: os.totalmem(), swapUsed: null, swapTotal: null },
    gpu: null,
    net: { rx: 0, tx: 0 },
    drives: [],
    procs: [],
    procCount: null,
    uptime: os.uptime(),
    sources: { gpu: null, cpuTemp: null }
  };
  let staticInfo = null;
  let running = false;
  let psStarted = false;
  const timers = [];
  let lhmGpu = null;
  let nvGpu = null;

  const mergeGpu = () => {
    // nvidia-smi is authoritative for NVIDIA; LHM fills gaps and covers AMD/Intel
    if (nvGpu) {
      latest.gpu = { ...lhmGpu, ...Object.fromEntries(Object.entries(nvGpu).filter(([, v]) => v !== null)) };
      latest.sources.gpu = 'nvidia-smi';
    } else if (lhmGpu) {
      latest.gpu = lhmGpu;
      latest.sources.gpu = 'LibreHardwareMonitor';
    }
  };

  const nv = createNvidia({
    onReading: (r) => {
      nvGpu = r;
      mergeGpu();
    }
  });

  function probe(name, everyMs, fn, { retireAfterEmpty = 0 } = {}) {
    let busy = false;
    let empties = 0;
    let retired = false;
    const run = async () => {
      if (!running || busy || retired) return;
      busy = true;
      let timer;
      try {
        // systeminformation never settles a command if its PowerShell session is released
        // mid-flight, so cap every poll or the probe would stay busy forever.
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), Math.max(8000, everyMs * 2));
        });
        const got = await Promise.race([fn(), deadline]);
        if (retireAfterEmpty && (got === null || got === undefined)) {
          if (++empties >= retireAfterEmpty) {
            retired = true;
            log(`telemetry: ${name} unavailable, disabled`);
          }
        } else {
          empties = 0;
        }
      } catch (err) {
        log(`telemetry: ${name} failed: ${err.message}`);
      } finally {
        clearTimeout(timer);
        busy = false;
      }
    };
    return { name, everyMs, run };
  }

  let lhmNextTry = 0;
  const probes = [
    probe('cpu', 1000, async () => {
      const l = await si.currentLoad();
      latest.cpu.load = l.currentLoad;
      latest.cpu.cores = l.cpus.map((c) => c.load);
      latest.mem.total = os.totalmem();
      latest.mem.used = latest.mem.total - os.freemem();
      latest.uptime = os.uptime();
      const speeds = os.cpus().map((c) => c.speed).filter(Boolean);
      latest.cpu.speed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length / 1000 : null;
      onUpdate?.(snapshot());
      return true;
    }),
    probe('net', 2000, async () => {
      const stats = await si.networkStats('*');
      latest.net = stats.reduce((a, n) => ({ rx: a.rx + (n.rx_sec || 0), tx: a.tx + (n.tx_sec || 0) }), { rx: 0, tx: 0 });
      return true;
    }),
    // Cheap localhost probe; when LHM is not running, retry only every 30s.
    probe('lhm', 2000, async () => {
      if (Date.now() < lhmNextTry) return true;
      const tree = await fetchLhm().catch(() => null);
      if (!tree) {
        lhmNextTry = Date.now() + 30000;
        if (latest.sources.cpuTemp === 'LibreHardwareMonitor') {
          latest.cpu.temp = null;
          latest.sources.cpuTemp = null;
        }
        if (lhmGpu && !nvGpu) {
          latest.gpu = null;
          latest.sources.gpu = null;
        }
        lhmGpu = null;
        return true;
      }
      const r = parseLhm(tree);
      lhmGpu = r.gpu;
      if (r.cpuTemp !== null) {
        latest.cpu.temp = r.cpuTemp;
        latest.sources.cpuTemp = 'LibreHardwareMonitor';
      }
      mergeGpu();
      return true;
    }),
    probe('procs', 5000, async () => {
      const p = await si.processes();
      latest.procCount = p.all;
      latest.procs = p.list
        .filter((x) => x.name && !/^(System Idle Process|Idle)$/i.test(x.name))
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 6)
        .map((x) => ({ name: x.name, cpu: x.cpu, mem: x.memRss * 1024 }));
      return true;
    }),
    probe('temp', 10000, async () => {
      if (latest.sources.cpuTemp === 'LibreHardwareMonitor') return true;
      const t = await si.cpuTemperature();
      latest.cpu.temp = t.main > 0 ? t.main : null;
      if (latest.cpu.temp !== null) latest.sources.cpuTemp = 'system';
      return latest.cpu.temp;
    }, { retireAfterEmpty: 3 }),
    probe('swap', 15000, async () => {
      const m = await si.mem();
      latest.mem.swapUsed = m.swapused;
      latest.mem.swapTotal = m.swaptotal;
      return true;
    }),
    probe('drives', 60000, async () => {
      const fs = await si.fsSize();
      latest.drives = fs
        .filter((f) => f.size > 0 && !/^\/(snap|boot|run|sys|proc|dev)/.test(f.mount))
        .slice(0, 6)
        .map((f) => ({ mount: f.mount, size: f.size, used: f.used }));
      return true;
    })
  ];

  function snapshot() {
    return structuredClone(latest);
  }

  async function loadStatic() {
    if (staticInfo) return staticInfo;
    const [cpu, memLayout, graphics, disks, osInfo, board, bios, nets, audio] = await Promise.all([
      si.cpu(), si.memLayout(), si.graphics(), si.diskLayout(), si.osInfo(),
      si.baseboard(), si.bios(), si.networkInterfaces(), si.audio().catch(() => [])
    ]);
    const gpus = graphics.controllers.map((g) => ({ model: g.model, vendor: g.vendor, vram: g.vram, driver: g.driverVersion }));
    const mainGpu = Math.max(0, gpus.findIndex((g) => /nvidia|geforce|radeon|amd|intel arc/i.test(g.model)));
    staticInfo = {
      cpu: {
        name: `${cpu.manufacturer} ${cpu.brand}`.trim(),
        cores: cpu.physicalCores,
        threads: cpu.cores,
        base: cpu.speed,
        max: cpu.speedMax,
        socket: cpu.socket,
        cache: { l2: cpu.cache?.l2, l3: cpu.cache?.l3 },
        virtualization: Boolean(cpu.virtualization)
      },
      mem: {
        total: os.totalmem(),
        modules: memLayout.filter((m) => m.size).map((m) => ({
          size: m.size, type: m.type, speed: m.clockSpeed, maker: m.manufacturer, part: (m.partNum || '').trim(), slot: m.bank
        }))
      },
      gpus,
      mainGpu,
      displays: graphics.displays.map((d) => ({ model: d.model, resX: d.currentResX, resY: d.currentResY, hz: d.currentRefreshRate, main: d.main })),
      disks: disks.map((d) => ({ name: d.name, type: d.type, size: d.size, iface: d.interfaceType, temp: d.temperature })),
      os: { distro: osInfo.distro, release: osInfo.release, build: osInfo.build || osInfo.kernel, arch: osInfo.arch, host: osInfo.hostname },
      board: { maker: board.manufacturer, model: board.model },
      bios: { vendor: bios.vendor, version: bios.version, date: bios.releaseDate },
      nets: (Array.isArray(nets) ? nets : [nets])
        .filter((n) => !n.internal && n.ip4 && !n.virtual)
        .map((n) => ({ iface: n.iface, name: n.ifaceName, ip4: n.ip4, type: n.type })),
      audio: (audio || []).map((a) => a.name).filter(Boolean).slice(0, 2)
    };
    return staticInfo;
  }

  return {
    loadStatic,
    snapshot,
    get running() {
      return running;
    },

    start() {
      if (running) return;
      running = true;
      if (platform === 'win32' && !psStarted && si.powerShellStart) {
        si.powerShellStart();
        psStarted = true;
      }
      nv.start();
      for (const p of probes) {
        p.run();
        timers.push(setInterval(p.run, p.everyMs));
      }
    },

    // Also ends the helper processes so a minimized HOLODESK holds none.
    stop() {
      running = false;
      while (timers.length) clearInterval(timers.pop());
      nv.stop();
      if (psStarted) si.powerShellRelease?.();
      psStarted = false;
    }
  };
}

async function defaultFetchLhm() {
  const res = await fetch(LHM_URL, { signal: AbortSignal.timeout(1000) });
  if (!res.ok) return null;
  return res.json();
}
