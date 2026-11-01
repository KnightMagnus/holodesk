// EHREN — main process
// Window management, system telemetry, weather, AI uplink (Claude / ChatGPT), voice I/O.
const { app, BrowserWindow, ipcMain, safeStorage, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const si = require('systeminformation');

let win;
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'ehren-config.json');

// ---------------------------------------------------------------- config / keys
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2));
}
function encrypt(str) {
  if (safeStorage.isEncryptionAvailable()) return { enc: true, v: safeStorage.encryptString(str).toString('base64') };
  return { enc: false, v: Buffer.from(str).toString('base64') };
}
function decrypt(obj) {
  if (!obj) return null;
  try {
    const buf = Buffer.from(obj.v, 'base64');
    return obj.enc ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch { return null; }
}
function getKey(provider) { return decrypt((loadConfig().keys || {})[provider]); }

// ---------------------------------------------------------------- window
function createWindow() {
  win = new BrowserWindow({
    width: 3440, height: 1440,
    fullscreen: true,
    frame: false,
    backgroundColor: '#01060d',
    autoHideMenuBar: true,
    title: 'EHREN',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') win.webContents.toggleDevTools();
    if (input.control && input.key.toLowerCase() === 'q') app.quit();
  });
}

// Ad / tracker domains blocked for the embedded YouTube player
const AD_PATTERNS = [
  '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://*.googleadservices.com/*',
  '*://*.google-analytics.com/*', '*://*.googletagservices.com/*', '*://*.adservice.google.com/*',
  '*://*.youtube.com/api/stats/ads*', '*://*.youtube.com/pagead/*', '*://*.youtube-nocookie.com/pagead/*',
  '*://*.youtube.com/ptracking*', '*://*.youtube.com/get_midroll_*', '*://*.2mdn.net/*'
];

app.whenReady().then(() => {
  const ses = session.defaultSession;
  // allow microphone for voice input
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'microphone', 'audioCapture'].includes(perm)));
  ses.setPermissionCheckHandler(() => true);
  ses.webRequest.onBeforeRequest({ urls: AD_PATTERNS }, (_d, cb) => cb({ cancel: true }));
  // YouTube embeds refuse to play from file:// without a referrer, so give them one
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*.youtube-nocookie.com/*', '*://*.youtube.com/*'] }, (d, cb) => {
    d.requestHeaders['Referer'] = 'https://www.youtube-nocookie.com/';
    cb({ requestHeaders: d.requestHeaders });
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());

ipcMain.handle('win:minimize', () => win.minimize());
ipcMain.handle('win:fullscreen', () => win.setFullScreen(!win.isFullScreen()));
ipcMain.handle('win:quit', () => app.quit());
ipcMain.handle('open:url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

// ---------------------------------------------------------------- system: static (Speccy-style)
let staticCache = null;
ipcMain.handle('sys:static', async () => {
  if (staticCache) return staticCache;
  const [cpu, mem, memLayout, graphics, disks, os, board, bios, sys, nets, audio] = await Promise.all([
    si.cpu(), si.mem(), si.memLayout(), si.graphics(), si.diskLayout(), si.osInfo(),
    si.baseboard(), si.bios(), si.system(), si.networkInterfaces(), si.audio().catch(() => [])
  ]);
  const netList = (Array.isArray(nets) ? nets : [nets]).filter(n => !n.internal && n.ip4);
  staticCache = {
    cpu: {
      name: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      cores: cpu.physicalCores, threads: cpu.cores,
      base: cpu.speed, max: cpu.speedMax, socket: cpu.socket,
      cache: { l2: cpu.cache?.l2, l3: cpu.cache?.l3 },
      virtualization: cpu.virtualization
    },
    mem: {
      total: mem.total,
      modules: memLayout.filter(m => m.size).map(m => ({
        size: m.size, type: m.type, speed: m.clockSpeed, maker: m.manufacturer, part: (m.partNum || '').trim(), slot: m.bank
      }))
    },
    gpus: graphics.controllers.map(g => ({ model: g.model, vendor: g.vendor, vram: g.vram, driver: g.driverVersion })),
    displays: graphics.displays.map(d => ({ model: d.model, resX: d.currentResX, resY: d.currentResY, hz: d.currentRefreshRate, main: d.main })),
    disks: disks.map(d => ({ name: d.name, type: d.type, size: d.size, iface: d.interfaceType, vendor: d.vendor, temp: d.temperature, smart: d.smartStatus })),
    os: { distro: os.distro, release: os.release, build: os.build, arch: os.arch, host: os.hostname, kernel: os.kernel },
    board: { maker: board.manufacturer, model: board.model, version: board.version },
    bios: { vendor: bios.vendor, version: bios.version, date: bios.releaseDate },
    system: { maker: sys.manufacturer, model: sys.model },
    nets: netList.map(n => ({ iface: n.iface, name: n.ifaceName, ip4: n.ip4, mac: n.mac, type: n.type, speed: n.speed })),
    audio: (audio || []).map(a => a.name).slice(0, 3)
  };
  return staticCache;
});

// ---------------------------------------------------------------- system: dynamic
let gpuLive = null;
async function pollGpu() {
  try {
    const g = await si.graphics();
    gpuLive = g.controllers.map(c => ({
      util: c.utilizationGpu ?? null, temp: c.temperatureGpu ?? null,
      memUsed: c.memoryUsed ?? null, memTotal: c.memoryTotal ?? null,
      clock: c.clockCore ?? null, fan: c.fanSpeed ?? null, power: c.powerDraw ?? null
    }));
  } catch { /* ignore */ }
}
setInterval(pollGpu, 3000); pollGpu();

ipcMain.handle('sys:dynamic', async () => {
  const [load, temp, mem, net, fsz, speed, procs, time, batt] = await Promise.all([
    si.currentLoad(), si.cpuTemperature(), si.mem(), si.networkStats('*'), si.fsSize(),
    si.cpuCurrentSpeed(), si.processes().catch(() => null), si.time(), si.battery().catch(() => ({}))
  ]);
  const netSum = net.reduce((a, n) => ({ rx: a.rx + (n.rx_sec || 0), tx: a.tx + (n.tx_sec || 0) }), { rx: 0, tx: 0 });
  return {
    cpu: { load: load.currentLoad, cores: load.cpus.map(c => c.load), temp: temp.main, speed: speed.avg },
    mem: { used: mem.active, total: mem.total, swapUsed: mem.swapused, swapTotal: mem.swaptotal },
    gpu: gpuLive,
    net: netSum,
    drives: fsz.filter(f => f.size > 0).map(f => ({ mount: f.mount, size: f.size, used: f.used, fs: f.type })).slice(0, 6),
    procs: procs ? procs.list.sort((a, b) => b.cpu - a.cpu).slice(0, 6).map(p => ({ name: p.name, cpu: p.cpu, mem: p.memRss })) : [],
    procCount: procs ? procs.all : null,
    uptime: time.uptime,
    battery: batt.hasBattery ? { pct: batt.percent, charging: batt.isCharging } : null
  };
});

// ---------------------------------------------------------------- weather (Open-Meteo, no key needed)
async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'EHREN-HUD' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function locate(cfg) {
  if (cfg.city) {
    const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(cfg.city)}`);
    if (g.results?.length) {
      const r = g.results[0];
      return { lat: r.latitude, lon: r.longitude, name: r.name, region: r.admin1 || '', country: r.country_code };
    }
  }
  try {
    const j = await getJSON('https://ipwho.is/');
    if (j.success !== false) return { lat: j.latitude, lon: j.longitude, name: j.city, region: j.region, country: j.country_code };
  } catch { /* fall through */ }
  const j = await getJSON('https://ipapi.co/json/');
  return { lat: j.latitude, lon: j.longitude, name: j.city, region: j.region, country: j.country_code };
}
ipcMain.handle('weather:get', async () => {
  const cfg = loadConfig();
  const loc = await locate(cfg);
  const units = cfg.units || (['US', 'LR', 'MM'].includes(loc.country) ? 'imperial' : 'metric');
  const imp = units === 'imperial';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,is_day,precipitation` +
    `&hourly=temperature_2m,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max` +
    `&timezone=auto&forecast_days=7${imp ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' : ''}`;
  const w = await getJSON(url);
  return { loc, units, w };
});

// ---------------------------------------------------------------- YouTube search (no API key needed)
function ytText(t) { return t?.simpleText || (t?.runs || []).map(r => r.text).join('') || ''; }
ipcMain.handle('yt:search', async (_e, q) => {
  const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D&hl=en`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' }
  });
  const html = await r.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error('Search unavailable right now.');
  const data = JSON.parse(m[1]);
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object' || out.length >= 24) return;
    if (o.videoRenderer?.videoId) {
      const v = o.videoRenderer;
      out.push({
        id: v.videoId,
        title: ytText(v.title),
        channel: ytText(v.ownerText),
        duration: ytText(v.lengthText) || 'LIVE',
        views: ytText(v.shortViewCountText),
        age: ytText(v.publishedTimeText),
        thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`
      });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  return out;
});

// ---------------------------------------------------------------- settings
ipcMain.handle('cfg:get', () => {
  const c = loadConfig();
  return {
    provider: c.provider || null,
    models: c.models || {},
    hasKey: { anthropic: !!getKey('anthropic'), openai: !!getKey('openai') },
    voiceEngine: c.voiceEngine || 'system',
    systemVoice: c.systemVoice || '',
    openaiVoice: c.openaiVoice || 'onyx',
    units: c.units || '',
    city: c.city || '',
    autoSpeak: c.autoSpeak !== false
  };
});
ipcMain.handle('cfg:set', (_e, patch) => {
  const c = loadConfig();
  Object.assign(c, patch);
  if (patch.models) c.models = { ...(loadConfig().models || {}), ...patch.models };
  saveConfig(c);
  return true;
});
ipcMain.handle('cfg:logout', (_e, provider) => {
  const c = loadConfig();
  if (c.keys) delete c.keys[provider];
  if (c.provider === provider) c.provider = null;
  saveConfig(c);
  return true;
});

// ---------------------------------------------------------------- AI uplink
async function listModels(provider, key) {
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
    return j.data.map(m => ({ id: m.id, name: m.display_name || m.id }));
  }
  const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return j.data
    .filter(m => /^(gpt|o\d|chatgpt)/.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding|instruct)/.test(m.id))
    .sort((a, b) => b.created - a.created)
    .map(m => ({ id: m.id, name: m.id }));
}

ipcMain.handle('ai:login', async (_e, { provider, key }) => {
  key = (key || '').trim();
  const models = await listModels(provider, key); // throws if key invalid
  const c = loadConfig();
  c.keys = c.keys || {};
  c.keys[provider] = encrypt(key);
  c.provider = provider;
  c.models = c.models || {};
  if (!c.models[provider] && models.length) c.models[provider] = models[0].id;
  saveConfig(c);
  return { models };
});
ipcMain.handle('ai:models', async (_e, provider) => {
  const key = getKey(provider);
  if (!key) return [];
  return listModels(provider, key);
});

ipcMain.handle('ai:chat', async (_e, { messages, context }) => {
  const c = loadConfig();
  const provider = c.provider;
  const key = provider && getKey(provider);
  if (!key) throw new Error('No uplink. Log in to Claude or ChatGPT first.');
  const model = (c.models || {})[provider];
  const system =
    'You are EHREN, the voice of a holographic desktop HUD running on the user\'s Windows PC. ' +
    'Your replies are usually spoken aloud, so keep them short, natural and conversational (1-4 sentences) unless asked for detail. ' +
    'Avoid markdown, lists and code blocks unless the user asks for them. Be confident, warm, a little witty. ' +
    'Live telemetry from the user\'s PC and local weather follows; use it when relevant.\n\n' + (context || '');

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1024, system, messages })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
    return j.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return (j.choices?.[0]?.message?.content || '').trim();
});

// ---------------------------------------------------------------- voice
// Speech-to-text: OpenAI Whisper (if OpenAI key) or offline Windows speech recognition.
ipcMain.handle('voice:transcribe', async (_e, { audio, mime }) => {
  const key = getKey('openai');
  if (!key) throw new Error('OpenAI key needed for Whisper voice.');
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(audio)], { type: mime || 'audio/webm' }), 'speech.webm');
  fd.append('model', 'whisper-1');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return j.text || '';
});

let listenProc = null;
ipcMain.handle('voice:listenSystem', () => new Promise((resolve, reject) => {
  if (process.platform !== 'win32') return reject(new Error('System speech recognition is Windows only.'));
  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'speech', 'listen.ps1')
    : path.join(__dirname, 'speech', 'listen.ps1');
  let out = '', err = '';
  listenProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
  listenProc.stdout.on('data', d => out += d);
  listenProc.stderr.on('data', d => err += d);
  listenProc.on('close', () => { listenProc = null; err && !out ? reject(new Error(err.trim().split('\n')[0])) : resolve(out.trim()); });
}));
ipcMain.handle('voice:cancel', () => { if (listenProc) listenProc.kill(); });

// Text-to-speech via OpenAI (returns mp3 bytes so the sphere can react to the real waveform)
ipcMain.handle('voice:tts', async (_e, { text, voice }) => {
  const key = getKey('openai');
  if (!key) throw new Error('OpenAI key needed for OpenAI voice.');
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: voice || 'onyx', input: text.slice(0, 4000) })
  });
  if (!r.ok) throw new Error(`TTS HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
});
