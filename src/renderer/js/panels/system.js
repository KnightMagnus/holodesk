// Hardware panels: CPU, GPU, memory, storage, network, board, processes.
import { bytes, rate, uptime, reading, clamp } from '/shared/format.js';
import { $, bind, el, esc, setText } from '../lib/dom.js';
import { createGauge } from '../ui/gauge.js';
import { drawSpark, history } from '../ui/spark.js';

const SLOTS = 40;

export function createSystemPanels(api) {
  const gauges = { cpu: createGauge($('#g-cpu'), 'CPU LOAD'), gpu: createGauge($('#g-gpu'), 'GPU LOAD'), mem: createGauge($('#g-mem'), 'RAM') };
  const cpuHist = history(SLOTS);
  const rxHist = history(SLOTS);
  const txHist = history(SLOTS);
  let info = null;
  let threadBars = [];
  let procRows = [];
  let volumeKey = '';
  let cpuLoad = 0;

  function renderInfo(i) {
    info = i;
    const c = i.cpu;
    bind('cpuName', c.name);
    bind('cpuSocket', c.socket ? `SOCKET ${c.socket}` : '');
    bind('cpuCores', `${c.cores} / ${c.threads}`);
    bind('cpuBase', `${reading(c.base, '', 1)} / ${reading(c.max, ' GHz', 1)}`);
    bind('cpuCache', `${bytes(c.cache.l2)} / ${bytes(c.cache.l3)}`);

    const threads = $('#threads');
    threads.classList.toggle('dense', c.threads > 16);
    threads.replaceChildren(...Array.from({ length: c.threads }, () => {
      const cell = el('div', 'thread');
      cell.append(el('i'));
      return cell;
    }));
    threadBars = [...threads.querySelectorAll('i')];

    const g = i.gpus[i.mainGpu] || {};
    bind('gpuName', g.model || 'No GPU detected');
    bind('gpuVendor', (g.vendor || '').toUpperCase().replace(/ CORPORATION| INC\.?/g, ''));
    bind('gpuDriver', g.driver || '—');
    $('#displays').innerHTML = i.displays.map((d, n) =>
      `<div class="li"><span>${esc(d.model || `Display ${n + 1}`)}${d.main ? ' · PRIMARY' : ''}</span><span>${d.resX}×${d.resY} @ ${d.hz || '?'}Hz</span></div>`).join('');

    const mods = i.mem.modules;
    bind('memTotal', bytes(i.mem.total));
    bind('memType', mods[0] ? `${mods[0].type} · ${mods[0].speed || '?'} MT/s` : '');
    $('#dimms').innerHTML = mods.map((m) =>
      `<div class="dimm"><b>${bytes(m.size, 0)}</b> ${esc(m.type)} ${m.speed ? `${m.speed} MT/s` : ''}<br>${esc(m.maker || '')} ${esc(m.part || '')}<br><span class="slot">${esc(m.slot || '')}</span></div>`).join('');

    $('#disks').innerHTML = i.disks.map((d) =>
      `<div class="li"><span>${esc(d.name)}</span><span>${bytes(d.size, 0)} · ${esc(d.type)}${d.iface ? ` · ${esc(d.iface)}` : ''}${d.temp ? ` · ${d.temp}°C` : ''}</span></div>`).join('');

    const n = i.nets[0] || {};
    bind('netIface', (n.name || n.iface || '').toUpperCase());
    bind('netIp', n.ip4 || '—');
    bind('host', i.os.host);

    const rows = [
      ['OPERATING SYSTEM', `${i.os.distro} ${i.os.release}`],
      ['BUILD / ARCH', `${i.os.build} · ${i.os.arch}`],
      ['MOTHERBOARD', `${i.board.maker} ${i.board.model}`],
      ['BIOS', `${i.bios.vendor} ${i.bios.version}${i.bios.date ? ` (${i.bios.date})` : ''}`],
      ['AUDIO', i.audio[0] || '—'],
      ['VIRTUALIZATION', c.virtualization ? 'ENABLED' : 'DISABLED']
    ];
    $('#board').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd></div>`).join('');
  }

  function ensureProcRows(n) {
    const host = $('#procs');
    while (procRows.length < n) {
      const row = el('div', 'proc');
      row.innerHTML = '<span class="n"></span><div class="meter"><i></i></div><span class="c"></span><span class="m"></span>';
      host.append(row);
      procRows.push({ row, name: row.children[0], bar: row.querySelector('i'), cpu: row.children[2], mem: row.children[3] });
    }
    procRows.forEach((r, i) => {
      r.row.hidden = i >= n;
    });
  }

  function renderVolumes(drives) {
    const key = drives.map((d) => d.mount).join('|');
    const host = $('#volumes');
    if (key !== volumeKey) {
      volumeKey = key;
      host.innerHTML = drives.map((d) =>
        `<div class="meter-row"><span>${esc(d.mount)}</span><div class="meter"><i></i></div><b></b></div>`).join('');
    }
    [...host.children].forEach((row, i) => {
      const d = drives[i];
      const p = d.used / d.size;
      row.querySelector('.meter').classList.toggle('warn', p > 0.9);
      row.querySelector('i').style.transform = `scaleX(${clamp(p, 0, 1).toFixed(3)})`;
      setText(row.querySelector('b'), `${bytes(d.used, 1)} / ${bytes(d.size, 1)}`);
    });
  }

  function renderSnapshot(s) {
    cpuLoad = s.cpu.load / 100;
    gauges.cpu(s.cpu.load);
    bind('cpuTemp', reading(s.cpu.temp, '°C'));
    bind('cpuClock', reading(s.cpu.speed, ' GHz', 2));
    s.cpu.cores.forEach((v, i) => {
      if (threadBars[i]) threadBars[i].style.transform = `scaleY(${clamp(v / 100, 0.02, 1).toFixed(2)})`;
    });
    cpuHist.push(s.cpu.load);
    drawSpark($('#cpu-spark'), [{ data: cpuHist.data }], { max: 100, slots: SLOTS });

    const memPct = (s.mem.used / s.mem.total) * 100;
    gauges.mem(memPct);
    bind('memUsed', `${bytes(s.mem.used)} (${memPct.toFixed(0)}%)`);
    bind('memSwap', s.mem.swapTotal ? `${bytes(s.mem.swapUsed)} / ${bytes(s.mem.swapTotal)}` : '—');

    const g = s.gpu;
    if (g) {
      gauges.gpu(g.util ?? 0, g.util == null ? 'N/A' : undefined);
      bind('gpuTemp', reading(g.temp, '°C'));
      bind('gpuClock', reading(g.clock, ' MHz'));
      bind('gpuFan', `${reading(g.fan, '%')} / ${reading(g.power, ' W')}`);
      const total = g.memTotal || info?.gpus[info.mainGpu]?.vram;
      if (total && g.memUsed != null) {
        $('#vram-bar').style.transform = `scaleX(${clamp(g.memUsed / total, 0, 1).toFixed(3)})`;
        bind('gpuVram', `${(g.memUsed / 1024).toFixed(1)} / ${(total / 1024).toFixed(0)} GB`);
      }
    } else {
      gauges.gpu(0, 'N/A');
    }

    rxHist.push(s.net.rx);
    txHist.push(s.net.tx);
    bind('netRx', rate(s.net.rx));
    bind('netTx', rate(s.net.tx));
    drawSpark($('#net-spark'), [{ data: rxHist.data }, { data: txHist.data }], {
      max: Math.max(65536, ...rxHist.data, ...txHist.data) * 1.15,
      slots: SLOTS
    });

    if (s.drives.length) renderVolumes(s.drives);

    ensureProcRows(s.procs.length);
    s.procs.forEach((p, i) => {
      const r = procRows[i];
      setText(r.name, p.name);
      setText(r.cpu, `${p.cpu.toFixed(1)}%`);
      setText(r.mem, bytes(p.mem, 0));
      r.bar.style.transform = `scaleX(${clamp(p.cpu / 100, 0.01, 1).toFixed(3)})`;
    });
    bind('uptime', uptime(s.uptime));
    bind('procCount', s.procCount ?? '—');
  }

  return {
    get cpuLoad() {
      return cpuLoad;
    },
    async start() {
      api.system.onTelemetry(renderSnapshot);
      renderInfo(await api.system.info());
      renderSnapshot(await api.system.snapshot());
    }
  };
}
