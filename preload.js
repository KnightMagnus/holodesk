const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('ehren', {
  sysStatic: call('sys:static'),
  sysDynamic: call('sys:dynamic'),
  weather: call('weather:get'),
  cfgGet: call('cfg:get'),
  cfgSet: call('cfg:set'),
  logout: call('cfg:logout'),
  login: call('ai:login'),
  models: call('ai:models'),
  chat: call('ai:chat'),
  transcribe: call('voice:transcribe'),
  listenSystem: call('voice:listenSystem'),
  cancelListen: call('voice:cancel'),
  tts: call('voice:tts'),
  ytSearch: call('yt:search'),
  minimize: call('win:minimize'),
  fullscreen: call('win:fullscreen'),
  quit: call('win:quit'),
  openUrl: call('open:url')
});
