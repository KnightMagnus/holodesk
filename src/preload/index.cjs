// Sandboxed preload: exposes a narrow, promise-based API as window.holodesk.
const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res.ok) return res.value;
  const err = new Error(res.error);
  if (res.aborted) err.name = 'AbortError';
  throw err;
}
const call = (channel) => (...args) => invoke(channel, ...args);

contextBridge.exposeInMainWorld('holodesk', {
  system: {
    info: call('system:info'),
    snapshot: call('system:snapshot'),
    onTelemetry(cb) {
      const listener = (_e, snap) => cb(snap);
      ipcRenderer.on('telemetry', listener);
      return () => ipcRenderer.removeListener('telemetry', listener);
    }
  },
  weather: { get: call('weather:get') },
  settings: {
    get: call('settings:get'),
    update: call('settings:update'),
    link: call('settings:link'),
    unlink: call('settings:unlink'),
    models: call('settings:models')
  },
  ai: { send: call('ai:send'), cancel: call('ai:cancel'), reset: call('ai:reset') },
  ollama: {
    status: call('ollama:status'),
    setup: call('ollama:setup'),
    cancel: call('ollama:cancel'),
    onProgress(cb) {
      const listener = (_e, p) => cb(p);
      ipcRenderer.on('ollama:progress', listener);
      return () => ipcRenderer.removeListener('ollama:progress', listener);
    }
  },
  voice: {
    listen: call('voice:listen'),
    cancel: call('voice:cancel'),
    transcribe: call('voice:transcribe'),
    speak: call('voice:speak')
  },
  media: { search: call('media:search') },
  app: {
    minimize: call('app:minimize'),
    toggleFullscreen: call('app:toggleFullscreen'),
    quit: call('app:quit'),
    openExternal: call('app:openExternal'),
    platform: process.platform
  }
});
