// AI uplink: Anthropic (Claude) and OpenAI (ChatGPT) over their HTTP APIs.
// The conversation lives here, not in the renderer, so it can be trimmed and
// enriched with live telemetry before every request.
import { getJson, postJson } from './net.js';

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TURNS = 24;
const OPENAI_EXCLUDE = /(audio|realtime|transcribe|tts|image|search|embedding|instruct|moderation|codex|-pro\b|deep-research|computer-use|whisper|dall-e|babbage|davinci)/;
const DATED = /-\d{4}-\d{2}-\d{2}$|-\d{8}$/;

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
  }
};

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
      if (!key) throw new Error('No uplink. Open settings and link Claude or ChatGPT.');
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
      // Both APIs need the history to start on a user turn.
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
