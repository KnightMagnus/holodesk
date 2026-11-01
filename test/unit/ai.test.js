import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, filterOpenAiModels, providers, toSpeech } from '../../src/main/ai.js';

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
