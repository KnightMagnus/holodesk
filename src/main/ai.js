// AI uplink: Anthropic (Claude), OpenAI (ChatGPT), and any OpenAI-compatible
// server (Ollama, LM Studio, Groq, OpenRouter) over their HTTP APIs.
// The conversation lives here, not in the renderer, so it can be trimmed and
// enriched with live telemetry before every request.
import { getJson, postJson, HttpError } from './net.js';

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TURNS = 24;
const OPENAI_EXCLUDE = /(audio|realtime|transcribe|tts|image|search|embedding|instruct|moderation|codex|-pro\b|deep-research|computer-use|whisper|dall-e|babbage|davinci)/;
const DATED = /-\d{4}-\d{2}-\d{2}$|-\d{8}$/;
// Compatible servers list every model they host, including ones that cannot chat.
const COMPAT_EXCLUDE = /(embed|rerank|whisper|tts|guard|bge-|minilm|orpheus|playai)/i;
// Plain http is fine on this PC or the LAN; anywhere else a key would travel in clear.
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)$/i;

export const PERSONA =
  'You are HOLODESK, the voice of a holographic HUD running on the user\'s Windows PC. ' +
  'Replies are usually spoken aloud: keep them short and conversational (1-4 sentences) unless asked for detail. ' +
  'No markdown, lists or code blocks unless the user asks. Confident, warm, a little dry. ' +
  'Live telemetry from the PC and local weather follow; use them when relevant and never invent readings.';

export const providers = {
  anthropic: {
    label: 'Claude',
    async listModels(key) {
      const j = await getJson('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }
      });
      return j.data.map((m) => ({ id: m.id, name: m.display_name || m.id }));
    },
    // API lists newest first. Sonnet is the best speed/cost fit for a voice assistant.
    pickDefault: (models) => (models.find((m) => /sonnet/i.test(m.id)) || models[0])?.id ?? null,
    async chat({ key, model, system, messages, signal }) {
      const j = await postJson('https://api.anthropic.com/v1/messages', { model, max_tokens: 1024, system, messages }, {
        headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
        timeout: 90000,
        signal
      });
      return j.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    }
  },

  openai: {
    label: 'ChatGPT',
    async listModels(key) {
      const j = await getJson('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
      return filterOpenAiModels(j.data);
    },
    pickDefault: (models) => (models.find((m) => /^gpt-/.test(m.id) && !DATED.test(m.id) && !/mini|nano/.test(m.id)) || models[0])?.id ?? null,
    async chat({ key, model, system, messages, signal }) {
      const j = await postJson('https://api.openai.com/v1/chat/completions', {
        model,
        max_completion_tokens: 1024,
        messages: [{ role: 'system', content: system }, ...messages]
      }, { headers: { Authorization: `Bearer ${key}` }, timeout: 90000, signal });
      return (j.choices?.[0]?.message?.content || '').trim();
    }
  },

  // The stored secret is {url, key} as JSON so the address and an optional key
  // stay together, encrypted, in the main process.
  compat: {
    label: 'Compatible',
    async listModels(secret) {
      const { url, key } = parseCompatSecret(secret);
      let j;
      try {
        j = await getJson(`${url}/models`, { headers: authHeader(key), timeout: 8000 });
      } catch (err) {
        if (err instanceof HttpError && err.status === 0) {
          throw new Error(`No server answering at ${url}. Is Ollama (or your server) running?`);
        }
        throw err;
      }
      const models = filterCompatModels(j.data || []);
      if (!models.length) throw new Error('That server has no chat models. For Ollama run: ollama pull llama3.2');
      return models;
    },
    // OpenRouter lists hundreds of paid models; a free one is the safer default.
    pickDefault: (models) => (models.find((m) => m.id.endsWith(':free')) || models[0])?.id ?? null,
    async chat({ key: secret, model, system, messages, signal }) {
      const { url, key } = parseCompatSecret(secret);
      const j = await postJson(`${url}/chat/completions`, {
        model,
        max_tokens: 1024,
        messages: [{ role: 'system', content: system }, ...messages]
      }, { headers: authHeader(key), timeout: 180000, signal }); // local servers load the model on first use
      return stripThinking(j.choices?.[0]?.message?.content || '');
    }
  }
};

const authHeader = (key) => (key ? { Authorization: `Bearer ${key}` } : {});

/** Validates a base URL like http://localhost:11434/v1 and returns it without a trailing slash. */
export function normalizeBaseUrl(input) {
  const raw = String(input || '').trim();
  let u;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new Error('Invalid server address');
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) {
    throw new Error('Invalid server address');
  }
  if (u.protocol === 'http:' && !LOCAL_HOST.test(u.hostname)) throw new Error('Use https for servers outside this PC or LAN');
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

export function compatSecret(url, key = '') {
  return JSON.stringify({ url: normalizeBaseUrl(url), key: String(key || '').trim() });
}

function parseCompatSecret(secret) {
  const { url, key } = JSON.parse(secret);
  return { url, key };
}

export function filterCompatModels(data) {
  return data
    .map((m) => m.id)
    .filter((id) => typeof id === 'string' && !COMPAT_EXCLUDE.test(id))
    .map((id) => ({ id, name: id }));
}

/** Reasoning models (qwen3, deepseek-r1) inline their chain of thought; never show or speak it. */
export function stripThinking(text) {
  return String(text).replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}

export function filterOpenAiModels(data) {
  return data
    .filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !OPENAI_EXCLUDE.test(m.id))
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .map((m) => ({ id: m.id, name: m.id }));
}

/** Text for spoken output: drop markdown syntax, code, and URLs. */
export function toSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[*_#>`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createChat({ config, buildContext, provs = providers }) {
  let history = [];
  let controller = null;

  return {
    async send(text) {
      const provider = config.get('provider');
      const key = provider && config.getKey(provider);
      if (!key) throw new Error('No uplink. Open settings and link Claude, ChatGPT or a local model.');
      const model = config.model(provider);
      if (!model) throw new Error('No model selected. Open settings and pick one.');

      controller?.abort();
      const own = new AbortController();
      controller = own;
      const messages = [...history, { role: 'user', content: text }];
      const system = `${PERSONA}\n\n${buildContext()}`;
      let reply;
      try {
        reply = await provs[provider].chat({ key, model, system, messages, signal: own.signal });
      } finally {
        if (controller === own) controller = null;
      }
      history = [...messages, { role: 'assistant', content: reply || '(no reply)' }].slice(-MAX_TURNS);
      // Every API needs the history to start on a user turn.
      while (history.length && history[0].role !== 'user') history.shift();
      return reply;
    },
    cancel() {
      controller?.abort();
      controller = null;
    },
    reset() {
      this.cancel();
      history = [];
    },
    get length() {
      return history.length;
    }
  };
}
