// Settings store. One JSON file in userData, written atomically.
// API keys are encrypted by the injected cipher (Electron safeStorage / DPAPI on Windows)
// and never leave the main process.
import fs from 'node:fs';
import path from 'node:path';
import { COMPAT_PRESETS } from '../shared/presets.js';

export const PROVIDERS = ['anthropic', 'openai', 'compat'];

const oneOf = (...vals) => (v) => vals.includes(v);
const isBool = (v) => typeof v === 'boolean';
const shortStr = (max) => (v) => typeof v === 'string' && v.length <= max;

// Public settings the renderer may read and write. Anything else is rejected.
const SCHEMA = {
  provider: { def: null, ok: (v) => v === null || PROVIDERS.includes(v) },
  compatPreset: { def: 'ollama', ok: oneOf(...Object.keys(COMPAT_PRESETS)) },
  voiceEngine: { def: 'system', ok: oneOf('system', 'openai') },
  systemVoice: { def: '', ok: shortStr(200) },
  openaiVoice: { def: 'onyx', ok: oneOf('alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer') },
  autoSpeak: { def: true, ok: isBool },
  units: { def: '', ok: oneOf('', 'imperial', 'metric') },
  city: { def: '', ok: shortStr(120) },
  quality: { def: 'high', ok: oneOf('high', 'balanced', 'low') },
  clock24: { def: true, ok: isBool },
  launchAtLogin: { def: false, ok: isBool },
  onboarded: { def: false, ok: isBool }
};

export class ConfigError extends Error {}

export function createConfig({ dir, cipher, file = 'settings.json' }) {
  const filePath = path.join(dir, file);
  let state = load();

  function load() {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      // first run or unreadable file: start from defaults
    }
    const out = { models: {}, keys: {} };
    for (const [k, { def, ok }] of Object.entries(SCHEMA)) out[k] = ok(raw[k]) ? raw[k] : def;
    for (const p of PROVIDERS) {
      if (typeof raw.models?.[p] === 'string') out.models[p] = raw.models[p];
      if (typeof raw.keys?.[p] === 'string') out.keys[p] = raw.keys[p];
    }
    return out;
  }

  function save() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function getKey(provider) {
    const blob = state.keys[provider];
    if (!blob) return null;
    try {
      return cipher.decrypt(blob);
    } catch {
      return null;
    }
  }

  return {
    get: (k) => state[k],
    getKey,
    model: (provider) => state.models[provider] || null,

    /** Snapshot safe to send to the renderer: no key material. */
    publicView() {
      const view = { models: { ...state.models }, linked: {} };
      for (const k of Object.keys(SCHEMA)) view[k] = state[k];
      for (const p of PROVIDERS) view.linked[p] = Boolean(getKey(p));
      return view;
    },

    update(patch) {
      if (!patch || typeof patch !== 'object') throw new ConfigError('Invalid settings');
      const next = { ...state, models: { ...state.models } };
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'models') {
          for (const [p, m] of Object.entries(v || {})) {
            if (!PROVIDERS.includes(p) || !shortStr(200)(m)) throw new ConfigError(`Invalid model for ${p}`);
            next.models[p] = m;
          }
          continue;
        }
        if (!SCHEMA[k]) throw new ConfigError(`Unknown setting: ${k}`);
        if (!SCHEMA[k].ok(v)) throw new ConfigError(`Invalid value for ${k}`);
        next[k] = v;
      }
      if (next.provider && !next.keys[next.provider]) throw new ConfigError('Link that provider first');
      state = next;
      save();
      return this.publicView();
    },

    setKey(provider, key, model, { preset } = {}) {
      if (!PROVIDERS.includes(provider)) throw new ConfigError('Unknown provider');
      state.keys = { ...state.keys, [provider]: cipher.encrypt(key) };
      // a different compatible server has different models; the saved pick no longer applies
      if (preset !== undefined) {
        if (!SCHEMA.compatPreset.ok(preset)) throw new ConfigError('Unknown preset');
        state.compatPreset = preset;
        state.models = { ...state.models, [provider]: model };
      }
      if (!state.models[provider] && model) state.models = { ...state.models, [provider]: model };
      state.provider = provider;
      save();
    },

    removeKey(provider) {
      const { [provider]: _removed, ...rest } = state.keys;
      state.keys = rest;
      if (state.provider === provider) state.provider = PROVIDERS.find((p) => rest[p]) || null;
      save();
    }
  };
}
