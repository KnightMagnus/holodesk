// EHREN — renderer
(() => {
const api = window.ehren;
const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const STAGE_W = 3440, STAGE_H = 1440;

// ============================================================ helpers
const fmtBytes = (b, d = 1) => {
  if (b == null || isNaN(b)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i >= 3 ? d : 0)} ${u[i]}`;
};
const fmtRate = (b) => b == null ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB/s` : `${(b / 1024).toFixed(0)} KB/s`;
const fmtUptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return `${d ? d + 'd ' : ''}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (v, unit = '', d = 0) => (v == null || v < 0 || isNaN(v)) ? 'N/A' : `${Number(v).toFixed(d)}${unit}`;

// ============================================================ stage scaling (3440×1440 native)
function fit() {
  const s = Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H);
  const st = $('#stage');
  st.style.transform = `translate(${(innerWidth - STAGE_W * s) / 2}px, ${(innerHeight - STAGE_H * s) / 2}px) scale(${s})`;
  const bg = $('#bgCanvas'); bg.width = innerWidth; bg.height = innerHeight;
}
addEventListener('resize', fit); fit();

// ============================================================ background field
const bgDots = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), v: 0.00004 + Math.random() * 0.00012, r: Math.random() * 1.6 + 0.4 }));
function drawBg(t) {
  const c = $('#bgCanvas'), x = c.getContext('2d'), W = c.width, H = c.height, h = theme.h;
  x.clearRect(0, 0, W, H);
  // perspective floor grid
  x.strokeStyle = `hsla(${h},100%,60%,0.05)`; x.lineWidth = 1;
  const hz = H * 0.62;
  for (let i = -30; i <= 30; i++) { x.beginPath(); x.moveTo(W / 2 + i * 40, hz); x.lineTo(W / 2 + i * 260, H); x.stroke(); }
  for (let j = 0; j < 14; j++) { const y = hz + Math.pow(j / 14, 2) * (H - hz) + ((t * 0.02) % 1) * 4; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
  for (const d of bgDots) {
    d.y -= d.v * 16; if (d.y < 0) { d.y = 1; d.x = Math.random(); }
    x.fillStyle = `hsla(${h},100%,70%,${0.15 + 0.35 * theme.g})`;
    x.fillRect(d.x * W, d.y * H, d.r, d.r);
  }
}

// ============================================================ clock
function tick() {
  const n = new Date();
  $('#time').textContent = n.toLocaleTimeString([], { hour12: false });
  $('#date').textContent = n.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase();
}
setInterval(tick, 1000); tick();

// ============================================================ gauges
function makeGauge(el, label) {
  const R = 84, C = 2 * Math.PI * R, ARC = C * 0.75;
  el.innerHTML = `
    <svg viewBox="0 0 200 200">
      <circle class="ticks" cx="100" cy="100" r="97" stroke-width="5" stroke-dasharray="1 4.08"/>
      <g transform="rotate(135 100 100)">
        <circle class="track" cx="100" cy="100" r="${R}" stroke-width="12" stroke-dasharray="${ARC} ${C}"/>
        <circle class="val" cx="100" cy="100" r="${R}" stroke-width="12" stroke-dasharray="${ARC} ${C}" stroke-dashoffset="${ARC}"/>
      </g>
      <g class="spin"><circle class="inner" cx="100" cy="100" r="68" stroke-width="2"/></g>
      <g class="spin rev"><circle class="track" cx="100" cy="100" r="60" stroke-width="2" stroke-dasharray="40 30 10 30"/></g>
    </svg>
    <div class="num"><b>0</b><span>${label}</span></div>`;
  const v = el.querySelector('.val'), b = el.querySelector('b');
  return (pct, text) => {
    pct = clamp(pct || 0, 0, 100);
    v.setAttribute('stroke-dashoffset', ARC * (1 - pct / 100));
    b.textContent = text ?? `${Math.round(pct)}%`;
    el.classList.toggle('hot', pct >= 90); el.classList.toggle('warm', pct >= 75 && pct < 90);
  };
}
const gCpu = makeGauge($('#gCpu'), 'CPU LOAD');
const gGpu = makeGauge($('#gGpu'), 'GPU LOAD');
const gMem = makeGauge($('#gMem'), 'RAM');

// ============================================================ sparklines
function spark(cv, series, max, opts = {}) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, h = theme.h;
  x.clearRect(0, 0, W, H);
  x.strokeStyle = `hsla(${h},100%,60%,0.10)`; x.lineWidth = 1;
  for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(0, H * i / 4); x.lineTo(W, H * i / 4); x.stroke(); }
  for (let i = 1; i < 12; i++) { x.beginPath(); x.moveTo(W * i / 12, 0); x.lineTo(W * i / 12, H); x.stroke(); }
  series.forEach((s, si) => {
    const data = s.data; if (!data.length) return;
    const n = opts.n || data.length, step = W / (n - 1);
    const off = n - data.length;
    const lightness = si ? 82 : 62;
    x.beginPath();
    data.forEach((v, i) => { const px = (off + i) * step, py = H - 4 - (v / max) * (H - 10); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.strokeStyle = `hsla(${h},100%,${lightness}%,${si ? 0.75 : 1})`; x.lineWidth = 2;
    x.shadowColor = `hsl(${h},100%,60%)`; x.shadowBlur = 8; x.stroke(); x.shadowBlur = 0;
    if (!si) {
      x.lineTo(W, H); x.lineTo(off * step, H); x.closePath();
      const gr = x.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, `hsla(${h},100%,60%,0.30)`); gr.addColorStop(1, `hsla(${h},100%,60%,0)`);
      x.fillStyle = gr; x.fill();
    }
  });
  if (opts.labels) {
    x.font = '14px "Share Tech Mono", monospace'; x.fillStyle = `hsla(${h},60%,80%,0.6)`;
    opts.labels.forEach(([i, txt]) => x.fillText(txt, (i / (opts.n - 1)) * W + 3, 14));
  }
}

// ============================================================ system: static
let SYS = null, DYN = null, WX = null;
async function loadStatic() {
  SYS = await api.sysStatic();
  const c = SYS.cpu;
  $('#cpuName').textContent = c.name;
  $('#cpuSocket').textContent = c.socket ? `SOCKET ${c.socket}` : '';
  $('#cpuCores').textContent = `${c.cores} / ${c.threads}`;
  $('#cpuBase').textContent = `${val(c.base, '', 1)} / ${val(c.max, ' GHz', 1)}`;
  $('#cpuCache').textContent = `${fmtBytes(c.cache.l2)} / ${fmtBytes(c.cache.l3)}`;
  const bars = $('#cpuCoresBars');
  bars.classList.toggle('many', c.threads > 16);
  bars.innerHTML = Array.from({ length: c.threads }, () => '<div class="core-bar"><i style="height:0"></i></div>').join('');

  const g = SYS.gpus.find(x => /nvidia|amd|radeon|geforce|intel arc/i.test(x.model)) || SYS.gpus[0] || {};
  SYS.mainGpuIndex = SYS.gpus.indexOf(g);
  $('#gpuName').textContent = g.model || 'Unknown GPU';
  $('#gpuVendor').textContent = (g.vendor || '').toUpperCase().replace(/ CORPORATION| INC\.?/g, '');
  $('#gpuDriver').textContent = g.driver || '—';
  $('#displays').innerHTML = SYS.displays.map((d, i) =>
    `<div class="li"><span>${esc(d.model || 'Display ' + (i + 1))}${d.main ? ' · PRIMARY' : ''}</span><span>${d.resX}×${d.resY} @ ${d.hz || '?'}Hz</span></div>`).join('');

  const mods = SYS.mem.modules;
  $('#memTotal').textContent = fmtBytes(SYS.mem.total);
  $('#memType').textContent = mods[0] ? `${mods[0].type} · ${mods[0].speed || '?'} MT/s` : '';
  $('#memModules').innerHTML = mods.map(m =>
    `<div class="dimm"><b>${fmtBytes(m.size, 0)}</b> ${esc(m.type)} ${m.speed ? m.speed + ' MT/s' : ''}<br>${esc(m.maker || '')} ${esc(m.part || '')}<br><span style="color:var(--txt-dim)">${esc(m.slot || '')}</span></div>`).join('');

  $('#disks').innerHTML = SYS.disks.map(d =>
    `<div class="li"><span>${esc(d.name)}</span><span>${fmtBytes(d.size, 0)} · ${esc(d.type)}${d.iface ? ' · ' + esc(d.iface) : ''}${d.temp ? ' · ' + d.temp + '°C' : ''}</span></div>`).join('');

  const n = SYS.nets[0] || {};
  $('#netIface').textContent = (n.name || n.iface || '').toUpperCase().slice(0, 34);
  $('#netIp').textContent = n.ip4 || '—';

  const rows = [
    ['OPERATING SYSTEM', `${SYS.os.distro} ${SYS.os.release}`],
    ['BUILD / ARCH', `${SYS.os.build || SYS.os.kernel} · ${SYS.os.arch}`],
    ['MOTHERBOARD', `${SYS.board.maker} ${SYS.board.model}`],
    ['BIOS', `${SYS.bios.vendor} ${SYS.bios.version} (${SYS.bios.date || '—'})`],
    ['SYSTEM', `${SYS.system.maker} ${SYS.system.model}`],
    ['AUDIO', SYS.audio[0] || '—'],
    ['VIRTUALIZATION', SYS.cpu.virtualization ? 'ENABLED' : 'DISABLED']
  ];
  $('#board').innerHTML = rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b style="font-size:16px;max-width:62%;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v)}</b></div>`).join('');
  $('#tHost').textContent = SYS.os.host;
}

// ============================================================ system: dynamic
const hist = { cpu: [], rx: [], tx: [] };
async function loadDynamic() {
  try { DYN = await api.sysDynamic(); } catch (e) { return; }
  const d = DYN;
  gCpu(d.cpu.load);
  $('#cpuTemp').textContent = val(d.cpu.temp, '°C');
  $('#cpuClock').textContent = val(d.cpu.speed, ' GHz', 2);
  document.querySelectorAll('#cpuCoresBars i').forEach((el, i) => el.style.height = `${clamp(d.cpu.cores[i] || 0, 2, 100)}%`);
  if (!hist.cpu.length) hist.cpu.push(...Array(39).fill(d.cpu.load));
  hist.cpu.push(d.cpu.load); if (hist.cpu.length > 40) hist.cpu.shift();
  spark($('#cpuSpark'), [{ data: hist.cpu }], 100, { n: 40 });

  const memPct = d.mem.used / d.mem.total * 100;
  gMem(memPct);
  $('#memUsed').textContent = `${fmtBytes(d.mem.used)} (${memPct.toFixed(0)}%)`;
  $('#memSwap').textContent = `${fmtBytes(d.mem.swapUsed)} / ${fmtBytes(d.mem.swapTotal)}`;

  const g = d.gpu && SYS ? d.gpu[SYS.mainGpuIndex] || d.gpu[0] : null;
  if (g) {
    gGpu(g.util ?? 0, g.util == null ? 'N/A' : undefined);
    $('#gpuTemp').textContent = val(g.temp, '°C');
    $('#gpuClock').textContent = val(g.clock, ' MHz');
    $('#gpuFan').textContent = `${val(g.fan, '%')} / ${val(g.power, ' W')}`;
    const tot = g.memTotal || (SYS.gpus[SYS.mainGpuIndex] || {}).vram;
    if (tot) {
      const used = g.memUsed ?? 0;
      $('#gpuVramBar').style.width = `${clamp(used / tot * 100, 0, 100)}%`;
      $('#gpuVram').textContent = `${(used / 1024).toFixed(1)} / ${(tot / 1024).toFixed(0)} GB`;
    }
  }

  if (!hist.rx.length) { hist.rx.push(...Array(39).fill(d.net.rx)); hist.tx.push(...Array(39).fill(d.net.tx)); }
  hist.rx.push(d.net.rx); hist.tx.push(d.net.tx);
  if (hist.rx.length > 40) { hist.rx.shift(); hist.tx.shift(); }
  $('#netRx').textContent = fmtRate(d.net.rx);
  $('#netTx').textContent = fmtRate(d.net.tx);
  spark($('#netSpark'), [{ data: hist.rx }, { data: hist.tx }], Math.max(65536, ...hist.rx, ...hist.tx) * 1.15, { n: 40 });

  $('#vols').innerHTML = d.drives.map(v => {
    const p = v.used / v.size * 100;
    return `<div class="bar-row"><span>${esc(v.mount)}</span><div class="bar ${p > 90 ? 'warn' : ''}"><i style="width:${p}%"></i></div><b>${fmtBytes(v.used, 1)} / ${fmtBytes(v.size, 1)}</b></div>`;
  }).join('');

  $('#procs').innerHTML = d.procs.map(p =>
    `<div class="proc"><span class="n">${esc(p.name)}</span><div class="bar"><i style="width:${clamp(p.cpu, 1, 100)}%"></i></div><span class="c">${p.cpu.toFixed(1)}%</span><span class="m">${fmtBytes(p.mem * 1024, 0)}</span></div>`).join('');
  $('#tUptime').textContent = fmtUptime(d.uptime);
  $('#tProcs').textContent = d.procCount ?? '—';
}

// ============================================================ weather
const WMO = {
  0: ['Clear', 'sun'], 1: ['Mostly clear', 'sun'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'], 48: ['Rime fog', 'fog'], 51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'],
  56: ['Freezing drizzle', 'rain'], 57: ['Freezing drizzle', 'rain'], 61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'], 71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'], 80: ['Showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Violent showers', 'rain'],
  85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'], 95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm', 'storm'], 99: ['Thunderstorm', 'storm']
};
function wxIcon(cv, kind, day = true) {
  const x = cv.getContext('2d'), W = cv.width, s = W / 150, h = theme.h;
  x.clearRect(0, 0, W, W); x.save(); x.scale(s, s);
  x.lineWidth = 4; x.lineCap = 'round'; x.strokeStyle = `hsl(${h},100%,68%)`; x.shadowColor = `hsl(${h},100%,60%)`; x.shadowBlur = 12;
  const sun = (cx, cy, r) => {
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
    if (day) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; x.beginPath(); x.moveTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8)); x.lineTo(cx + Math.cos(a) * (r + 18), cy + Math.sin(a) * (r + 18)); x.stroke(); }
    else { x.beginPath(); x.arc(cx + r * 0.5, cy - r * 0.4, r * 0.8, 0, 7); x.fillStyle = '#01060d'; x.fill(); }
  };
  const cloud = (ox, oy) => {
    x.beginPath(); x.moveTo(ox + 28, oy + 60);
    x.arc(ox + 34, oy + 44, 18, Math.PI * 0.6, Math.PI * 1.5); x.arc(ox + 64, oy + 32, 26, Math.PI * 1.15, Math.PI * 1.95);
    x.arc(ox + 94, oy + 46, 16, Math.PI * 1.45, Math.PI * 0.45); x.closePath();
    x.fillStyle = 'rgba(1,10,20,0.85)'; x.fill(); x.stroke();
  };
  if (kind === 'sun') sun(75, 75, 26);
  else if (kind === 'partly') { sun(56, 54, 20); cloud(22, 42); }
  else if (kind === 'fog') { cloud(14, 18); [96, 110, 124].forEach((y, i) => { x.beginPath(); x.moveTo(26 + i * 6, y); x.lineTo(124 - i * 6, y); x.stroke(); }); }
  else {
    cloud(14, 20);
    if (kind === 'rain') [44, 66, 88, 110].forEach((px, i) => { x.beginPath(); x.moveTo(px, 100 + (i % 2) * 6); x.lineTo(px - 8, 122 + (i % 2) * 6); x.stroke(); });
    if (kind === 'snow') [44, 70, 96].forEach((px, i) => { for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; x.beginPath(); x.moveTo(px - Math.cos(a) * 7, 112 + (i % 2) * 8 - Math.sin(a) * 7); x.lineTo(px + Math.cos(a) * 7, 112 + (i % 2) * 8 + Math.sin(a) * 7); x.stroke(); } });
    if (kind === 'storm') { x.beginPath(); x.moveTo(78, 92); x.lineTo(64, 116); x.lineTo(80, 116); x.lineTo(68, 140); x.stroke(); }
  }
  x.restore();
}
async function loadWeather() {
  try { WX = await api.weather(); } catch (e) { $('#wxLoc').textContent = 'WEATHER OFFLINE'; return; }
  const { loc, units, w } = WX, c = w.current, d = w.daily, imp = units === 'imperial';
  const tU = imp ? '°F' : '°C', sU = imp ? 'mph' : 'km/h';
  const [cond, kind] = WMO[c.weather_code] || ['—', 'cloud'];
  $('#wxLoc').textContent = `${loc.name}${loc.region ? ', ' + loc.region : ''}`.toUpperCase();
  $('#wxTemp').textContent = `${Math.round(c.temperature_2m)}${tU}`;
  $('#wxCond').textContent = cond;
  $('#wxHL').textContent = `H ${Math.round(d.temperature_2m_max[0])}°  ·  L ${Math.round(d.temperature_2m_min[0])}°`;
  $('#wxFeels').textContent = `${Math.round(c.apparent_temperature)}${tU}`;
  $('#wxHum').textContent = `${c.relative_humidity_2m}%`;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  $('#wxWind').textContent = `${Math.round(c.wind_speed_10m)} ${sU} ${dirs[Math.round(c.wind_direction_10m / 45) % 8]}`;
  $('#wxPres').textContent = imp ? `${(c.surface_pressure * 0.02953).toFixed(2)} inHg` : `${Math.round(c.surface_pressure)} hPa`;
  $('#wxUv').textContent = `${Math.round(d.uv_index_max[0])} / ${d.precipitation_probability_max[0] ?? 0}%`;
  const hm = (s) => new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#wxSun').textContent = `${hm(d.sunrise[0])} / ${hm(d.sunset[0])}`;
  wxIcon($('#wxIcon'), kind, !!c.is_day);

  // next 24h temperature curve
  const nowIdx = Math.max(0, w.hourly.time.findIndex(t => new Date(t) >= new Date()) - 1);
  const temps = w.hourly.temperature_2m.slice(nowIdx, nowIdx + 24);
  const rain = w.hourly.precipitation_probability.slice(nowIdx, nowIdx + 24);
  const mn = Math.min(...temps) - 3, mx = Math.max(...temps) + 3;
  const labels = [0, 6, 12, 18].map(i => [i, `${new Date(w.hourly.time[nowIdx + i]).toLocaleTimeString([], { hour: 'numeric' })} ${Math.round(temps[i])}°`]);
  spark($('#wxSpark'), [{ data: temps.map(t => t - mn) }, { data: rain.map(r => r / 100 * (mx - mn) * 0.5) }], mx - mn, { n: 24, labels });

  $('#wxDays').innerHTML = d.time.slice(1, 7).map((t, i) =>
    `<div class="wx-day"><div class="d">${new Date(t + 'T12:00').toLocaleDateString([], { weekday: 'short' }).toUpperCase()}</div><canvas width="92" height="92" data-k="${(WMO[d.weather_code[i + 1]] || [])[1] || 'cloud'}"></canvas><div class="t">${Math.round(d.temperature_2m_max[i + 1])}° <i>${Math.round(d.temperature_2m_min[i + 1])}°</i></div></div>`).join('');
  document.querySelectorAll('.wx-day canvas').forEach(cv => wxIcon(cv, cv.dataset.k, true));
}

// ============================================================ theme + core state
const theme = { h: 198, g: 0.35 };
const sphere = new EhrenSphere($('#sphere'));
let state = 'idle', level = 0, levelTarget = 0;
const STATES = {
  idle: ['STANDBY', 'CLICK THE CORE OR PRESS CTRL + SPACE TO SPEAK'],
  listening: ['LISTENING', 'SPEAK NOW · CLICK THE CORE TO CANCEL'],
  thinking: ['PROCESSING', 'ROUTING THROUGH UPLINK'],
  speaking: ['EHREN', 'TRANSMITTING RESPONSE']
};
function setState(s) {
  state = s; sphere.state = s;
  $('#stateText').textContent = STATES[s][0];
  $('#stateSub').textContent = STATES[s][1];
  $('#btnMic').classList.toggle('live', s === 'listening');
}

let analyser = null, freq = null, timeBuf = null, synthSpeaking = false, synthPulse = 0;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  // audio level
  if (analyser && (state === 'listening' || state === 'speaking')) {
    analyser.getByteTimeDomainData(timeBuf); analyser.getByteFrequencyData(freq);
    let sum = 0; for (let i = 0; i < timeBuf.length; i++) { const v = (timeBuf[i] - 128) / 128; sum += v * v; }
    levelTarget = clamp(Math.sqrt(sum / timeBuf.length) * 4.2, 0, 1);
    sphere.spectrum = freq;
  } else if (synthSpeaking) {
    synthPulse *= 0.9;
    const syl = Math.abs(Math.sin(now / 95) * Math.sin(now / 233 + 1)) * 0.55;
    levelTarget = clamp(0.25 + syl + synthPulse, 0, 1);
    sphere.spectrum = null;
  } else if (state === 'thinking') { levelTarget = 0.18 + Math.sin(now / 180) * 0.08; sphere.spectrum = null; }
  else if (!window.__EHREN_DEMO) { levelTarget = 0; sphere.spectrum = null; }
  level += (levelTarget - level) * (levelTarget > level ? 0.45 : 0.12);
  sphere.level = level;

  // reactive blue theme
  const cpu = DYN ? DYN.cpu.load / 100 : 0;
  const hueTarget = { idle: 198, listening: 188, thinking: 212, speaking: 196 - level * 8 }[state];
  theme.h += (hueTarget - theme.h) * 0.06;
  const gTarget = 0.28 + cpu * 0.15 + level * 0.65 + (state === 'thinking' ? 0.15 + Math.sin(now / 200) * 0.1 : 0);
  theme.g += (gTarget - theme.g) * 0.12;
  sphere.hue = theme.h;
  root.style.setProperty('--h', theme.h.toFixed(1));
  root.style.setProperty('--g', theme.g.toFixed(3));
  $('#coreAmp').textContent = `AMP ${level.toFixed(2)}`;

  sphere.draw(dt);
  drawBg(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ============================================================ config
let CFG = null;
async function loadCfg() {
  CFG = await api.cfgGet();
  const linked = CFG.provider && CFG.hasKey[CFG.provider];
  const up = $('#tUplink');
  up.textContent = linked ? (CFG.provider === 'anthropic' ? 'CLAUDE' : 'CHATGPT') : 'OFFLINE';
  up.classList.toggle('off', !linked);
  $('#coreModel').textContent = linked ? (CFG.models[CFG.provider] || '').toUpperCase() : 'NO UPLINK';
  $('#coreVoice').textContent = `VOICE · ${CFG.voiceEngine === 'openai' ? 'OPENAI' : 'WINDOWS'}`;
  return CFG;
}

// ============================================================ audio / voice
let actx = null;
function audioCtx() {
  if (!actx) {
    actx = new AudioContext();
    analyser = actx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.7;
    freq = new Uint8Array(analyser.frequencyBinCount); timeBuf = new Uint8Array(analyser.fftSize);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
let micStream = null, micSrc = null;
async function micOn() {
  audioCtx();
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  micSrc = actx.createMediaStreamSource(micStream); micSrc.connect(analyser);
  return micStream;
}
function micOff() {
  try { micSrc && micSrc.disconnect(); } catch { }
  micStream && micStream.getTracks().forEach(t => t.stop());
  micStream = micSrc = null;
}

let cancelListen = null;
async function listen() {
  if (state === 'listening') { cancelListen && cancelListen(); return; }
  stopSpeaking();
  setState('listening');
  try {
    const useWhisper = CFG.voiceEngine === 'openai' && CFG.hasKey.openai;
    let text;
    if (useWhisper) text = await recordWhisper();
    else {
      micOn().catch(() => { });   // drives the sphere visuals while Windows recognizes
      cancelListen = () => api.cancelListen();
      text = await api.listenSystem();
    }
    micOff(); cancelListen = null;
    if (!text || !text.trim()) { setState('idle'); sysMsg('NO SPEECH DETECTED'); return; }
    handleInput(text.trim());
  } catch (e) {
    micOff(); cancelListen = null; setState('idle'); sysMsg(`VOICE ERROR · ${e.message}`, true);
  }
}
function recordWhisper() {
  return new Promise(async (resolve, reject) => {
    const stream = await micOn().catch(reject); if (!stream) return;
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = []; let heard = false, quietSince = performance.now(), start = performance.now(), cancelled = false;
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(iv);
      if (cancelled || !heard) return resolve('');
      try {
        const buf = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
        setState('thinking');
        resolve(await api.transcribe({ audio: new Uint8Array(buf), mime: 'audio/webm' }));
      } catch (e) { reject(e); }
    };
    cancelListen = () => { cancelled = true; rec.state !== 'inactive' && rec.stop(); };
    rec.start(250);
    const iv = setInterval(() => {
      const now = performance.now();
      if (level > 0.12) { heard = true; quietSince = now; }
      if ((heard && now - quietSince > 1300) || (!heard && now - start > 7000) || now - start > 20000) rec.state !== 'inactive' && rec.stop();
    }, 100);
  });
}

const cleanForSpeech = (t) => t.replace(/```[\s\S]*?```/g, ' code block omitted. ').replace(/[*_#>`~]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/https?:\/\/\S+/g, 'link');
let ttsSource = null;
function stopSpeaking() {
  speechSynthesis.cancel(); synthSpeaking = false;
  try { ttsSource && ttsSource.stop(); } catch { }
  ttsSource = null;
}
async function speak(text) {
  if (!CFG.autoSpeak) return setState('idle');
  const clean = cleanForSpeech(text);
  setState('speaking');
  if (CFG.voiceEngine === 'openai' && CFG.hasKey.openai) {
    try {
      const bytes = await api.tts({ text: clean, voice: CFG.openaiVoice });
      const ctx = audioCtx();
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      ttsSource = ctx.createBufferSource(); ttsSource.buffer = buf;
      ttsSource.connect(analyser); analyser.connect(ctx.destination);
      ttsSource.onended = () => { try { analyser.disconnect(ctx.destination); } catch { } if (state === 'speaking') setState('idle'); };
      ttsSource.start();
      return;
    } catch (e) { sysMsg(`OPENAI VOICE FAILED · USING WINDOWS VOICE`, true); }
  }
  const u = new SpeechSynthesisUtterance(clean);
  const v = speechSynthesis.getVoices().find(v => v.name === CFG.systemVoice);
  if (v) u.voice = v;
  u.rate = 1.03; u.pitch = 0.92;
  u.onboundary = () => { synthPulse = 0.35; };
  u.onend = u.onerror = () => { synthSpeaking = false; if (state === 'speaking') setState('idle'); };
  synthSpeaking = true;
  speechSynthesis.speak(u);
}

// ============================================================ comms
const history = [];
function addMsg(role, text) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = `<span class="who">${role === 'user' ? 'YOU' : 'EHREN'} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>${esc(text)}`;
  $('#log').appendChild(el); $('#log').scrollTop = 1e9;
}
function sysMsg(text, err) {
  const el = document.createElement('div');
  el.className = `msg sys${err ? ' err' : ''}`; el.textContent = text;
  $('#log').appendChild(el); $('#log').scrollTop = 1e9;
  $('#ticker').textContent = text;
}
function buildContext() {
  const L = [`Local time: ${new Date().toString()}`];
  if (SYS) L.push(`CPU: ${SYS.cpu.name} (${SYS.cpu.cores}C/${SYS.cpu.threads}T)`, `GPU: ${SYS.gpus.map(g => g.model).join(', ')}`,
    `RAM: ${fmtBytes(SYS.mem.total)}`, `OS: ${SYS.os.distro} ${SYS.os.release}`, `Board: ${SYS.board.maker} ${SYS.board.model}`,
    `Displays: ${SYS.displays.map(d => `${d.resX}x${d.resY}@${d.hz}Hz`).join(', ')}`);
  if (DYN) {
    L.push(`CPU load ${DYN.cpu.load.toFixed(0)}%, temp ${val(DYN.cpu.temp, 'C')}; RAM used ${fmtBytes(DYN.mem.used)}`);
    const g = DYN.gpu && DYN.gpu[SYS?.mainGpuIndex ?? 0];
    if (g) L.push(`GPU load ${val(g.util, '%')}, temp ${val(g.temp, 'C')}`);
    L.push(`Drives: ${DYN.drives.map(d => `${d.mount} ${fmtBytes(d.size - d.used)} free of ${fmtBytes(d.size)}`).join('; ')}`);
    L.push(`Top processes: ${DYN.procs.map(p => p.name).join(', ')}; uptime ${fmtUptime(DYN.uptime)}`);
  }
  if (WX) {
    const c = WX.w.current, u = WX.units === 'imperial' ? 'F' : 'C';
    L.push(`Weather in ${WX.loc.name}: ${(WMO[c.weather_code] || ['?'])[0]}, ${Math.round(c.temperature_2m)}${u}, feels ${Math.round(c.apparent_temperature)}${u}, humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)}`);
    L.push(`Forecast: ${WX.w.daily.time.slice(0, 5).map((t, i) => `${t} ${(WMO[WX.w.daily.weather_code[i]] || ['?'])[0]} ${Math.round(WX.w.daily.temperature_2m_max[i])}/${Math.round(WX.w.daily.temperature_2m_min[i])}${u}`).join('; ')}`);
  }
  return L.join('\n');
}

async function handleInput(text) {
  addMsg('user', text);
  // built-in command: "play <something>" → media feed
  const m = text.match(/^(?:hey ehren,?\s*)?(?:play|put on|youtube)\s+(.+?)(?:\s+on youtube)?[.!]?$/i);
  if (m) {
    const q = m[1];
    $('#ytQuery').value = q;
    const res = await ytSearch(q);
    if (res && res[0]) { playVideo(res[0]); const r = `Playing ${res[0].title}.`; addMsg('ai', r); return speak(r); }
  }
  if (!CFG.provider || !CFG.hasKey[CFG.provider]) {
    const r = 'My uplink is offline. Open settings and link Claude or ChatGPT, and I will be fully operational.';
    addMsg('ai', r); return speak(r);
  }
  history.push({ role: 'user', content: text });
  while (history.length > 24) history.shift();
  setState('thinking');
  try {
    const reply = await api.chat({ messages: history, context: buildContext() });
    history.push({ role: 'assistant', content: reply });
    addMsg('ai', reply);
    speak(reply);
  } catch (e) {
    history.pop();
    setState('idle'); sysMsg(`UPLINK ERROR · ${e.message}`, true);
  }
}

$('#inputBar').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#prompt').value.trim(); if (!v) return;
  $('#prompt').value = ''; audioCtx(); stopSpeaking(); handleInput(v);
});
$('#btnMic').addEventListener('click', listen);
$('#core').addEventListener('click', () => state === 'speaking' ? (stopSpeaking(), setState('idle')) : listen());
$('#btnClear').addEventListener('click', () => { history.length = 0; $('#log').innerHTML = ''; });
addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); listen(); }
  if (e.key === 'Escape' && !$('#overlay').classList.contains('hidden')) closeOverlay();
});

// ============================================================ media feed (YouTube)
let ytList = [];
async function ytSearch(q) {
  $('#ytResults').innerHTML = '<div class="yt-empty">SCANNING…</div>';
  try {
    ytList = await api.ytSearch(q);
    renderYt();
    return ytList;
  } catch (e) { $('#ytResults').innerHTML = `<div class="yt-empty">${esc(e.message)}</div>`; }
}
function renderYt(activeId) {
  if (!ytList.length) { $('#ytResults').innerHTML = '<div class="yt-empty">NO RESULTS</div>'; return; }
  $('#ytResults').innerHTML = ytList.map((v, i) => `
    <div class="yt ${v.id === activeId ? 'active' : ''}" data-i="${i}">
      <div class="th" style="background-image:url('${v.thumb}')"><span class="dur">${esc(v.duration)}</span></div>
      <div><div class="ti">${esc(v.title)}</div><div class="ch">${esc(v.channel)}${v.views ? ' · ' + esc(v.views) : ''}</div></div>
    </div>`).join('');
}
function playVideo(v) {
  const p = $('#player');
  p.innerHTML = `<div class="now-playing">▶ ${esc(v.title)}</div><button class="close-vid" title="Close">✕</button>
    <iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  p.querySelector('.close-vid').onclick = () => { p.innerHTML = '<div class="player-idle"><div class="ring"></div><span>NO SIGNAL · SELECT A FEED</span></div>'; renderYt(); };
  renderYt(v.id);
}
$('#ytForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#ytQuery').value.trim(); if (q) ytSearch(q); });
$('#ytResults').addEventListener('click', (e) => { const el = e.target.closest('.yt'); if (el) playVideo(ytList[+el.dataset.i]); });

// ============================================================ overlay (uplink + settings)
function ovMsg(t, err) { const m = $('#ovMsg'); m.textContent = t; m.classList.toggle('err', !!err); }
async function fillModels(p) {
  const sel = p === 'anthropic' ? $('#modelAnthropic') : $('#modelOpenai');
  if (!CFG.hasKey[p]) { sel.innerHTML = '<option>— link first —</option>'; return; }
  try {
    const ms = await api.models(p);
    sel.innerHTML = ms.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    if (CFG.models[p]) sel.value = CFG.models[p];
  } catch (e) { sel.innerHTML = `<option value="${esc(CFG.models[p] || '')}">${esc(CFG.models[p] || 'unavailable')}</option>`; }
}
function fillVoices() {
  const vs = speechSynthesis.getVoices();
  $('#setSysVoice').innerHTML = '<option value="">System default</option>' + vs.map(v => `<option ${v.name === CFG.systemVoice ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
}
speechSynthesis.onvoiceschanged = () => CFG && fillVoices();
async function openOverlay() {
  await loadCfg();
  for (const p of ['anthropic', 'openai']) {
    const card = document.querySelector(`.prov[data-p="${p}"]`);
    card.classList.toggle('linked', CFG.hasKey[p]);
    $(p === 'anthropic' ? '#stAnthropic' : '#stOpenai').textContent = CFG.hasKey[p] ? '● LINKED' : 'NOT LINKED';
    fillModels(p);
  }
  $('#setProvider').value = CFG.provider || (CFG.hasKey.openai && !CFG.hasKey.anthropic ? 'openai' : 'anthropic');
  $('#setVoiceEngine').value = CFG.voiceEngine;
  $('#setOaVoice').value = CFG.openaiVoice;
  $('#setAutoSpeak').value = String(CFG.autoSpeak);
  $('#setUnits').value = CFG.units;
  $('#setCity').value = CFG.city;
  fillVoices(); ovMsg('');
  $('#overlay').classList.remove('hidden');
}
function closeOverlay() { $('#overlay').classList.add('hidden'); }
document.querySelectorAll('[data-login]').forEach(b => b.addEventListener('click', async () => {
  const p = b.dataset.login, inp = p === 'anthropic' ? $('#keyAnthropic') : $('#keyOpenai');
  if (!inp.value.trim()) return ovMsg('ENTER AN API KEY FIRST', true);
  ovMsg('AUTHENTICATING…');
  try {
    await api.login({ provider: p, key: inp.value });
    inp.value = '';
    ovMsg(`${p === 'anthropic' ? 'CLAUDE' : 'CHATGPT'} UPLINK ESTABLISHED`);
    await openOverlay(); $('#setProvider').value = p;
    ovMsg(`${p === 'anthropic' ? 'CLAUDE' : 'CHATGPT'} UPLINK ESTABLISHED`);
  } catch (e) { ovMsg(`AUTH FAILED · ${e.message}`, true); }
}));
document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', async () => { await api.logout(b.dataset.logout); openOverlay(); }));
document.querySelectorAll('[data-url]').forEach(b => b.addEventListener('click', () => api.openUrl(b.dataset.url)));
$('#ovSave').addEventListener('click', async () => {
  const prev = { city: CFG.city, units: CFG.units };
  const models = {};
  if (CFG.hasKey.anthropic && $('#modelAnthropic').value) models.anthropic = $('#modelAnthropic').value;
  if (CFG.hasKey.openai && $('#modelOpenai').value) models.openai = $('#modelOpenai').value;
  const provider = $('#setProvider').value;
  if (!CFG.hasKey[provider]) return ovMsg(`LINK ${provider === 'anthropic' ? 'CLAUDE' : 'CHATGPT'} BEFORE MAKING IT THE ACTIVE BRAIN`, true);
  await api.cfgSet({
    provider, models,
    voiceEngine: $('#setVoiceEngine').value, systemVoice: $('#setSysVoice').value, openaiVoice: $('#setOaVoice').value,
    autoSpeak: $('#setAutoSpeak').value === 'true', units: $('#setUnits').value, city: $('#setCity').value.trim()
  });
  await loadCfg();
  if (prev.city !== CFG.city || prev.units !== CFG.units) loadWeather();
  closeOverlay();
  sysMsg(`UPLINK ACTIVE · ${(CFG.models[CFG.provider] || '').toUpperCase()}`);
});
$('#ovSkip').addEventListener('click', closeOverlay);
$('#ovClose').addEventListener('click', closeOverlay);
$('#btnSettings').addEventListener('click', openOverlay);
$('#btnMin').addEventListener('click', () => api.minimize());
$('#btnFull').addEventListener('click', () => api.fullscreen());
$('#btnQuit').addEventListener('click', () => api.quit());

// ============================================================ boot
(async () => {
  setState('idle');
  await loadCfg();
  loadStatic().then(loadDynamic).catch(e => sysMsg(`TELEMETRY ERROR · ${e.message}`, true));
  setInterval(loadDynamic, 1500);
  loadWeather(); setInterval(loadWeather, 15 * 60 * 1000);
  sysMsg('EHREN ONLINE · ALL SYSTEMS NOMINAL');
  if (window.__EHREN_DEMO) return window.__EHREN_DEMO({ addMsg, setState, ytSearch, playVideo, sysMsg, setLevel: (v) => levelTarget = v });
  if (!CFG.provider) openOverlay();
})();
})();
