// HOLODESK main process: window, app:// protocol, security policy, IPC wiring.
import { app, BrowserWindow, protocol, session, shell, safeStorage, powerMonitor } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import si from 'systeminformation';

import { handle, check } from './ipc.js';
import { createConfig, PROVIDERS } from './config.js';
import { createTelemetry } from './telemetry.js';
import { createWeather } from './weather.js';
import { createChat, providers, toSpeech } from './ai.js';
import { createWindowsRecognizer, transcribe, synthesize } from './voice.js';
import { search as youtubeSearch } from './youtube.js';
import { installAdblock } from './adblock.js';
import { buildContext } from './context.js';
import { resolveAsset, mimeFor } from './serve.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const SERVE_ROOTS = { shared: path.join(SRC, 'shared'), '': path.join(SRC, 'renderer') };
const RESOURCES = app.isPackaged ? process.resourcesPath : path.resolve(SRC, '..', 'resources');
const IS_DEV = !app.isPackaged;
const ORIGIN = 'app://holodesk';
const EXTERNAL_HOSTS = new Set(['console.anthropic.com', 'platform.openai.com', 'www.youtube.com', 'youtube.com', 'youtu.be']);

// Isolated profile for tests (also against the packaged build) and side-by-side runs.
if (process.env.HOLODESK_USER_DATA) app.setPath('userData', process.env.HOLODESK_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.holodesk.app');
  app.whenReady().then(boot);
}

function log(msg) {
  if (IS_DEV) console.log(`[holodesk] ${msg}`);
}

function serveApp() {
  protocol.handle('app', async (req) => {
    const file = resolveAsset(SERVE_ROOTS, req.url);
    if (!file) return new Response('Forbidden', { status: 403 });
    try {
      return new Response(await fs.readFile(file), { headers: { 'content-type': mimeFor(file) } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function lockDownSession(ses) {
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    const fromApp = (details.requestingUrl || '').startsWith(ORIGIN);
    if (permission === 'media') return cb(fromApp && (details.mediaTypes || []).every((t) => t === 'audio'));
    cb(permission === 'fullscreen');
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) =>
    permission === 'fullscreen' || (permission === 'media' && origin.startsWith(ORIGIN)));
  installAdblock(ses);
}

function isSafeExternal(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function boot() {
  serveApp();
  lockDownSession(session.defaultSession);

  const cipher = {
    encrypt: (s) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS key storage is unavailable');
      return safeStorage.encryptString(s).toString('base64');
    },
    decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
  };
  const userData = app.getPath('userData');
  const config = createConfig({ dir: userData, cipher });
  const weather = createWeather({ getSetting: config.get, cacheFile: path.join(userData, 'weather-cache.json') });

  let win = null;
  const telemetry = createTelemetry({
    si,
    log,
    onUpdate: (snap) => {
      if (win && !win.isDestroyed()) win.webContents.send('telemetry', snap);
    }
  });
  let info = null;
  telemetry.loadStatic().then((i) => {
    info = i;
  }).catch((err) => log(`static info failed: ${err.message}`));

  const chat = createChat({
    config,
    buildContext: () => buildContext({ info, snap: telemetry.snapshot(), weather: weather.peek() })
  });

  const recognizer = createWindowsRecognizer({ scriptPath: path.join(RESOURCES, 'speech', 'listen.ps1') });

  const requireKey = (provider) => {
    const key = config.getKey(provider);
    if (!key) throw new Error(`${providers[provider].label} is not linked`);
    return key;
  };

  // ---- IPC
  handle('system:info', () => telemetry.loadStatic());
  handle('system:snapshot', () => telemetry.snapshot());
  handle('weather:get', (force) => weather.get({ force: force === true }));

  handle('settings:get', () => config.publicView());
  handle('settings:update', (patch) => {
    const view = config.update(patch);
    if (patch && 'launchAtLogin' in patch && app.isPackaged) app.setLoginItemSettings({ openAtLogin: view.launchAtLogin });
    return view;
  });
  handle('settings:link', async (provider, key) => {
    check.oneOf(provider, 'provider', PROVIDERS);
    key = check.str(key, 'API key', 400);
    const models = await providers[provider].listModels(key);
    config.setKey(provider, key, providers[provider].pickDefault(models));
    return { settings: config.publicView(), models };
  });
  handle('settings:unlink', (provider) => {
    config.removeKey(check.oneOf(provider, 'provider', PROVIDERS));
    return config.publicView();
  });
  handle('settings:models', (provider) => providers[check.oneOf(provider, 'provider', PROVIDERS)].listModels(requireKey(provider)));

  handle('ai:send', (text) => chat.send(check.str(text, 'message', 8000)));
  handle('ai:cancel', () => chat.cancel());
  handle('ai:reset', () => chat.reset());

  handle('voice:listen', () => {
    if (process.platform !== 'win32') throw new Error('Windows voice recognition is only available on Windows');
    return recognizer.listen();
  });
  handle('voice:cancel', () => recognizer.cancel());
  handle('voice:transcribe', (audio, mime) =>
    transcribe({ key: requireKey('openai'), audio: check.bytes(audio, 'audio', 25 * 1024 * 1024), mime: check.str(mime, 'mime', 100) }));
  handle('voice:speak', (text) =>
    synthesize({ key: requireKey('openai'), text: toSpeech(check.str(text, 'text', 20000)), voice: config.get('openaiVoice') }));

  handle('media:search', (query) => youtubeSearch(check.str(query, 'query', 200)));

  handle('app:minimize', () => win?.minimize());
  handle('app:toggleFullscreen', () => win?.setFullScreen(!win.isFullScreen()));
  handle('app:quit', () => app.quit());
  handle('app:openExternal', (url) => {
    if (!isSafeExternal(url)) throw new Error('Blocked link');
    return shell.openExternal(url);
  });

  // ---- window
  win = createWindow();
  const syncTelemetry = () => {
    if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) telemetry.start();
    else telemetry.stop();
  };
  for (const ev of ['show', 'hide', 'minimize', 'restore']) win.on(ev, syncTelemetry);
  powerMonitor.on('lock-screen', () => telemetry.stop());
  powerMonitor.on('unlock-screen', syncTelemetry);
  win.on('closed', () => {
    win = null;
    telemetry.stop();
  });

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    telemetry.stop();
    recognizer.dispose();
    chat.cancel();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1720,
    height: 720,
    fullscreen: true,
    frame: false,
    show: false,
    backgroundColor: '#01060d',
    title: 'HOLODESK',
    icon: path.join(SRC, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(SRC, 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: IS_DEV
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`${ORIGIN}/index.html`);

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.control && input.key.toLowerCase() === 'q') {
      app.quit();
    } else if (IS_DEV && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}
