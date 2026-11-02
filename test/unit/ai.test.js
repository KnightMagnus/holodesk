import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatSecret, createChat, filterCompatModels, filterOpenAiModels, normalizeBaseUrl, providers, stripThinking, toSpeech } from '../../src/main/ai.js';

test('OpenAI model list keeps chat models, newest first', () => {
  const ids = filterOpenAiModels([
    { id: 'gpt-4o', created: 1 },
    { id: 'gpt-5', created: 5 },
    { id: 'gpt-4o-realtime-preview', created: 9 },
    { id: 'whisper-1', created: 9 },
    { id: 'o3-pro', created: 8 },
    { id: 'gpt-5-codex', created: 8 },
    { id: 'text-embedding-3-large', created: 9 },
    { id: 'o4-mini', created: 4 },
    { id: 'dall-e-3', created: 9 }
  ]).map((m) => m.id);
  assert.deepEqual(ids, ['gpt-5', 'o4-mini', 'gpt-4o']);
});

test('default model picks prefer Sonnet and undated full-size GPT', () => {
  assert.equal(providers.anthropic.pickDefault([{ id: 'claude-opus-5' }, { id: 'claude-sonnet-5-5' }]), 'claude-sonnet-5-5');
  assert.equal(providers.anthropic.pickDefault([{ id: 'claude-opus-5' }]), 'claude-opus-5');
  assert.equal(providers.openai.pickDefault([{ id: 'gpt-5-2026-01-01' }, { id: 'gpt-5-mini' }, { id: 'gpt-5' }]), 'gpt-5');
  assert.equal(providers.anthropic.pickDefault([]), null);
});

test('toSpeech strips markdown, code and links', () => {
  assert.equal(toSpeech('**Hi** see [docs](https://x.y) or https://a.b\n```js\ncode\n```'), 'Hi see docs or a link (code omitted)');
});

function fakeConfig({ provider = 'anthropic', key = 'k', model = 'm' } = {}) {
  return { get: (k) => (k === 'provider' ? provider : null), getKey: () => key, model: () => model };
}

test('chat keeps history, injects context, and trims to start on a user turn', async () => {
  const seen = [];
  const provs = {
    anthropic: {
      chat: async ({ system, messages }) => {
        seen.push({ system, n: messages.length, first: messages[0].role });
        return `reply ${messages.length}`;
      }
    }
  };
  const chat = createChat({ config: fakeConfig(), buildContext: () => 'CTX', provs });
  for (let i = 0; i < 20; i++) await chat.send(`q${i}`);
  assert.ok(seen.every((s) => s.system.includes('HOLODESK') && s.system.endsWith('CTX')));
  assert.ok(seen.every((s) => s.first === 'user'));
  assert.ok(chat.length <= 24);
});

test('chat errors clearly without a key or model', async () => {
  await assert.rejects(createChat({ config: fakeConfig({ key: null }), buildContext: () => '' }).send('hi'), /No uplink/);
  await assert.rejects(createChat({ config: fakeConfig({ model: null }), buildContext: () => '' }).send('hi'), /No model/);
});

test('a cancelled request is not added to history', async () => {
  const provs = {
    anthropic: {
      chat: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }))))
    }
  };
  const chat = createChat({ config: fakeConfig(), buildContext: () => '', provs });
  const pending = chat.send('hello');
  chat.cancel();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(chat.length, 0);
});

test('a new message aborts the one still in flight', async () => {
  let calls = 0;
  const provs = {
    anthropic: {
      chat: ({ signal }) => {
        calls++;
        if (calls === 1) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))));
        return Promise.resolve('second');
      }
    }
  };
  const chat = createChat({ config: fakeConfig(), buildContext: () => '', provs });
  const first = chat.send('one');
  const second = chat.send('two');
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(await second, 'second');
  assert.equal(chat.length, 2);
});

test('compatible server addresses: local http, remote https only', () => {
  assert.equal(normalizeBaseUrl('localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.equal(normalizeBaseUrl('http://192.168.1.20:1234/v1'), 'http://192.168.1.20:1234/v1');
  assert.equal(normalizeBaseUrl('https://api.groq.com/openai/v1'), 'https://api.groq.com/openai/v1');
  assert.throws(() => normalizeBaseUrl('http://api.example.com/v1'), /https/);
  assert.throws(() => normalizeBaseUrl('file:///etc/passwd'), /Invalid/);
  assert.throws(() => normalizeBaseUrl('http://user:pw@localhost/v1'), /Invalid/);
  assert.deepEqual(JSON.parse(compatSecret('localhost:11434/v1')), { url: 'http://localhost:11434/v1', key: '' });
});

test('compatible model list drops embedding and audio models; default prefers free', () => {
  const models = filterCompatModels([{ id: 'llama3.2:latest' }, { id: 'nomic-embed-text:latest' }, { id: 'whisper-large-v3' }, { id: 'qwen3:8b' }]);
  assert.deepEqual(models.map((m) => m.id), ['llama3.2:latest', 'qwen3:8b']);
  assert.equal(providers.compat.pickDefault([{ id: 'a/paid' }, { id: 'b/model:free' }]), 'b/model:free');
  assert.equal(providers.compat.pickDefault([{ id: 'llama3.2' }]), 'llama3.2');
});

test('reasoning models never leak their thinking', () => {
  assert.equal(stripThinking('<think>hmm\nlet me see</think>\n\nIt is 21 degrees.'), 'It is 21 degrees.');
  assert.equal(stripThinking('<think>cut off mid-thought'), '');
});

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('compatible chat talks OpenAI format, sends a key only when set', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'llama3.2' }] });
    return Response.json({ choices: [{ message: { content: '<think>x</think>Hello.' } }] });
  };
  await withFetch(fake, async () => {
    const local = compatSecret('http://localhost:11434/v1');
    assert.deepEqual(await providers.compat.listModels(local), [{ id: 'llama3.2', name: 'llama3.2' }]);
    const reply = await providers.compat.chat({ key: local, model: 'llama3.2', system: 'SYS', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(reply, 'Hello.');
    await providers.compat.listModels(compatSecret('https://api.groq.com/openai/v1', 'gsk_x'));
  });
  assert.equal(calls[1].url, 'http://localhost:11434/v1/chat/completions');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.model, 'llama3.2');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[2].init.headers.Authorization, 'Bearer gsk_x');
});

test('compatible link explains a server that is not running or has no models', async () => {
  await withFetch(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }, () =>
    assert.rejects(providers.compat.listModels(compatSecret('localhost:11434/v1')), /No server answering at http:\/\/localhost:11434\/v1/));
  await withFetch(async () => Response.json({ data: [{ id: 'nomic-embed-text' }] }), () =>
    assert.rejects(providers.compat.listModels(compatSecret('localhost:11434/v1')), /ollama pull/));
});
