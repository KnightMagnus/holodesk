// Renderer entry: wires panels, the core and the assistant together.
import { api, isMock } from './bridge.js';
import { $, bind, setText } from './lib/dom.js';
import { stage } from './ui/stage.js';
import { initBackground } from './ui/background.js';
import { createCore } from './ui/core/core.js';
import { createSystemPanels } from './panels/system.js';
import { createWeatherPanel } from './panels/weather.js';
import { createMediaPanel } from './panels/media.js';
import { createComms } from './panels/comms.js';
import { createSettings } from './panels/settings.js';
import { createAssistant } from './voice/assistant.js';
import { COMPAT_PRESETS } from '/shared/presets.js';

let settings = await api.settings.get();

stage.init();
initBackground($('#bg'));
document.body.dataset.quality = settings.quality;

const comms = createComms();
const onError = (text) => comms.status(text, true);
const system = createSystemPanels(api);
const weather = createWeatherPanel(api, { onError });
const media = createMediaPanel(api, { onError });
const core = createCore($('#core'), { quality: settings.quality, getCpuLoad: () => system.cpuLoad });
const assistant = createAssistant({ api, core, comms, media, getSettings: () => settings });
const overlay = createSettings(api, { onSaved: applySettings });

function uplinkName(s) {
  if (s.provider === 'compat') return (COMPAT_PRESETS[s.compatPreset]?.label || 'LOCAL').toUpperCase();
  return s.provider === 'anthropic' ? 'CLAUDE' : 'CHATGPT';
}

function applySettings(next, before = settings) {
  settings = next;
  const linked = next.provider && next.linked[next.provider];
  bind('uplink', linked ? uplinkName(next) : 'OFFLINE');
  $('[data-bind="uplink"]').classList.toggle('warn', !linked);
  bind('coreModel', linked ? (next.models[next.provider] || '').toUpperCase() : 'NO UPLINK');
  bind('coreVoice', `VOICE · ${next.voiceEngine === 'openai' ? 'OPENAI' : 'WINDOWS'}`);
  bind('coreQuality', `FX · ${next.quality.toUpperCase()}${core.renderer === '2d' ? ' · 2D' : ''}`);
  document.body.dataset.quality = next.quality;
  if (before.quality !== next.quality) core.setQuality(next.quality);
  if (before.city !== next.city || before.units !== next.units) weather.refresh(true);
}

// ---- clock
function tick() {
  const now = new Date();
  setText($('#time'), now.toLocaleTimeString([], { hour12: !settings.clock24 }));
  setText($('#date'), now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase());
}
tick();
setInterval(tick, 1000);

// ---- input
$('#prompt-bar').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#prompt');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  assistant.send(text);
});
$('#mic').addEventListener('click', () => assistant.talk());
$('#core').addEventListener('click', () => assistant.talk());
$('#core').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    assistant.talk();
  }
});

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'settings') overlay.open();
  else if (action === 'minimize') api.app.minimize();
  else if (action === 'fullscreen') api.app.toggleFullscreen();
  else if (action === 'quit') api.app.quit();
  else if (action === 'clear-log') {
    comms.clear();
    assistant.reset();
  }
});

addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'Space') {
    e.preventDefault();
    assistant.talk();
  } else if (e.key === 'Escape') {
    if (overlay.isOpen) overlay.close();
    else assistant.interrupt();
  } else if (e.ctrlKey && e.key === ',') {
    e.preventDefault();
    overlay.open();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    media.focusSearch();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    $('#prompt').focus();
  }
});

addEventListener('error', (e) => comms.status(`UI ERROR · ${e.message}`, true));
addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name !== 'AbortError') comms.status(`UI ERROR · ${e.reason?.message || e.reason}`, true);
});

// ---- boot
applySettings(settings);
comms.status('HOLODESK ONLINE');
system.start().catch((err) => onError(`Telemetry: ${err.message}`));
weather.refresh();
if (isMock) (await import('./dev/demo-scene.js')).run({ comms, media, core, assistant });
else if (!settings.onboarded) overlay.open();
