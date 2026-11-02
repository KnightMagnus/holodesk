// Uplink + settings overlay.
import { $, $$, esc, setText } from '../lib/dom.js';
import { COMPAT_PRESETS } from '/shared/presets.js';

const PROVS = ['anthropic', 'openai', 'compat'];
const LABEL = { anthropic: 'CLAUDE', openai: 'CHATGPT', compat: 'LOCAL MODEL' };

export function createSettings(api, { onSaved }) {
  const overlay = $('#overlay');
  const msg = $('#ov-msg');
  const field = (name) => overlay.querySelector(`[name="${name}"]`);
  const card = (p) => overlay.querySelector(`.prov[data-provider="${p}"]`);
  let view = null;
  let returnFocus = null;

  function say(text, isError = false) {
    setText(msg, text);
    msg.classList.toggle('error', isError);
  }

  async function fillModels(provider) {
    const select = card(provider).querySelector('.prov-model');
    if (!view.linked[provider]) {
      select.innerHTML = '<option value="">Link first</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const chosen = view.models[provider] || '';
    select.innerHTML = `<option value="${esc(chosen)}">${esc(chosen || 'Loading…')}</option>`;
    try {
      const models = await api.settings.models(provider);
      const ids = new Set(models.map((m) => m.id));
      const extra = chosen && !ids.has(chosen) ? [{ id: chosen, name: `${chosen} (saved)` }] : [];
      select.innerHTML = [...extra, ...models].map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      select.value = chosen || models[0]?.id || '';
    } catch (err) {
      say(`Could not load ${LABEL[provider]} models: ${err.message}`, true);
    }
  }

  function fillVoices() {
    const voices = speechSynthesis.getVoices();
    field('systemVoice').innerHTML = '<option value="">System default</option>' +
      voices.map((v) => `<option ${v.name === view?.systemVoice ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  }
  speechSynthesis.addEventListener('voiceschanged', () => view && fillVoices());

  // Fills the address, key hint and help link for a preset. Custom keeps what was typed.
  function applyPreset(id) {
    const c = card('compat');
    const preset = COMPAT_PRESETS[id] || COMPAT_PRESETS.custom;
    const url = c.querySelector('.prov-url');
    if (id !== 'custom') url.value = preset.url;
    url.placeholder = preset.url || 'http://host:port/v1';
    c.querySelector('.prov-key').placeholder = preset.needsKey ? 'API key' : 'API key (not needed)';
    const help = c.querySelector('.prov-help');
    help.hidden = !preset.help;
    help.dataset.url = preset.help;
    setText(help, preset.helpText);
  }

  function renderView() {
    card('compat').querySelector('.prov-preset').value = view.compatPreset;
    applyPreset(view.compatPreset);
    for (const p of PROVS) {
      const c = card(p);
      c.classList.toggle('linked', view.linked[p]);
      c.classList.toggle('active', view.provider === p);
      setText(c.querySelector('.prov-status'), view.linked[p] ? '● LINKED' : 'NOT LINKED');
      fillModels(p);
    }
    field('provider').value = view.provider || (view.linked.openai && !view.linked.anthropic ? 'openai' : 'anthropic');
    for (const name of ['voiceEngine', 'openaiVoice', 'units', 'quality']) field(name).value = view[name];
    for (const name of ['autoSpeak', 'clock24', 'launchAtLogin']) field(name).value = String(view[name]);
    field('city').value = view.city;
    fillVoices();
  }

  async function open() {
    view = await api.settings.get();
    renderView();
    say('');
    returnFocus = document.activeElement;
    overlay.hidden = false;
    (overlay.querySelector('.prov:not(.linked) .prov-key') || field('provider')).focus();
  }

  function close() {
    overlay.hidden = true;
    returnFocus?.focus?.();
    // first-run overlay shows once; after that it opens only on request
    if (view && !view.onboarded) {
      api.settings.update({ onboarded: true }).then((v) => {
        view = v;
        onSaved?.(v);
      }).catch(() => {});
    }
  }

  async function link(provider) {
    const c = card(provider);
    const input = c.querySelector('.prov-key');
    const key = input.value.trim();
    let args = [key];
    if (provider === 'compat') {
      const preset = c.querySelector('.prov-preset').value;
      const url = c.querySelector('.prov-url').value.trim();
      if (!url) return say('Enter the server address first', true);
      if (!key && COMPAT_PRESETS[preset].needsKey) return say(`${COMPAT_PRESETS[preset].label} needs an API key`, true);
      args = [key, url, preset];
      say(`Connecting to ${url}…`);
    } else {
      if (!key) return say('Paste an API key first', true);
      say('Verifying key…');
    }
    try {
      const res = await api.settings.link(provider, ...args);
      input.value = '';
      view = res.settings;
      renderView();
      const name = provider === 'compat' ? COMPAT_PRESETS[view.compatPreset].label.toUpperCase() : LABEL[provider];
      say(`${name} linked · ${res.models.length} models available`);
      onSaved?.(view);
    } catch (err) {
      say(`Link failed: ${err.message}`, true);
    }
  }

  async function unlink(provider) {
    view = await api.settings.unlink(provider);
    renderView();
    say(`${LABEL[provider]} unlinked`);
    onSaved?.(view);
  }

  async function save() {
    const provider = field('provider').value;
    const models = {};
    for (const p of PROVS) {
      const m = card(p).querySelector('.prov-model').value;
      if (view.linked[p] && m) models[p] = m;
    }
    const patch = {
      models,
      voiceEngine: field('voiceEngine').value,
      systemVoice: field('systemVoice').value,
      openaiVoice: field('openaiVoice').value,
      autoSpeak: field('autoSpeak').value === 'true',
      quality: field('quality').value,
      clock24: field('clock24').value === 'true',
      launchAtLogin: field('launchAtLogin').value === 'true',
      units: field('units').value,
      city: field('city').value.trim()
    };
    if (view.linked[provider]) patch.provider = provider;
    if (patch.voiceEngine === 'openai' && !view.linked.openai) return say('OpenAI voice needs an OpenAI key. Link ChatGPT or pick Windows voice.', true);
    try {
      const before = view;
      view = await api.settings.update(patch);
      onSaved?.(view, before);
      close();
    } catch (err) {
      say(err.message, true);
    }
  }

  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const provider = btn.closest('.prov')?.dataset.provider;
    const action = btn.dataset.action;
    if (action === 'link') link(provider);
    else if (action === 'unlink') unlink(provider);
    else if (action === 'open') api.app.openExternal(btn.dataset.url).catch((err) => say(err.message, true));
    else if (action === 'save-settings') save();
    else if (action === 'close-overlay') close();
  });
  card('compat').querySelector('.prov-preset').addEventListener('change', (e) => applyPreset(e.target.value));
  for (const input of $$('.prov-key, .prov-url', overlay)) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') link(input.closest('.prov').dataset.provider);
    });
  }

  return {
    open,
    close,
    get isOpen() {
      return !overlay.hidden;
    }
  };
}
