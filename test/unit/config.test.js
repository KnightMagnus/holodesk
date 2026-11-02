import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConfig } from '../../src/main/config.js';

const cipher = {
  encrypt: (s) => Buffer.from(`enc:${s}`).toString('base64'),
  decrypt: (b) => Buffer.from(b, 'base64').toString().replace(/^enc:/, '')
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'holodesk-cfg-'));

test('starts from defaults when no file exists', () => {
  const c = createConfig({ dir: tmp(), cipher });
  const v = c.publicView();
  assert.equal(v.provider, null);
  assert.equal(v.voiceEngine, 'system');
  assert.equal(v.quality, 'high');
  assert.deepEqual(v.linked, { anthropic: false, openai: false, compat: false });
  assert.equal(v.compatPreset, 'ollama');
});

test('drops invalid values from a hand-edited file', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ quality: 'ultra', autoSpeak: 'yes', city: 'Oslo', provider: 'gemini' }));
  const v = createConfig({ dir, cipher }).publicView();
  assert.equal(v.quality, 'high');
  assert.equal(v.autoSpeak, true);
  assert.equal(v.city, 'Oslo');
  assert.equal(v.provider, null);
});

test('survives a corrupt file', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
  assert.equal(createConfig({ dir, cipher }).publicView().quality, 'high');
});

test('keys are encrypted on disk and never in the public view', () => {
  const dir = tmp();
  const c = createConfig({ dir, cipher });
  c.setKey('anthropic', 'sk-ant-secret', 'claude-x');
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!raw.includes('sk-ant-secret'));
  const view = c.publicView();
  assert.ok(!JSON.stringify(view).includes('secret'));
  assert.equal(view.linked.anthropic, true);
  assert.equal(view.provider, 'anthropic');
  assert.equal(view.models.anthropic, 'claude-x');
  assert.equal(createConfig({ dir, cipher }).getKey('anthropic'), 'sk-ant-secret');
});

test('update rejects unknown and invalid fields without writing', () => {
  const c = createConfig({ dir: tmp(), cipher });
  assert.throws(() => c.update({ keys: { openai: 'x' } }), /Unknown setting/);
  assert.throws(() => c.update({ quality: 'ultra' }), /Invalid value/);
  assert.throws(() => c.update({ provider: 'openai' }), /Link that provider/);
  assert.equal(c.publicView().quality, 'high');
});

test('update persists valid changes', () => {
  const dir = tmp();
  createConfig({ dir, cipher }).update({ quality: 'low', clock24: false, city: 'Seattle' });
  const v = createConfig({ dir, cipher }).publicView();
  assert.equal(v.quality, 'low');
  assert.equal(v.clock24, false);
  assert.equal(v.city, 'Seattle');
});

test('unlinking the active provider falls back to the other linked one', () => {
  const c = createConfig({ dir: tmp(), cipher });
  c.setKey('openai', 'sk-1', 'gpt');
  c.setKey('anthropic', 'sk-2', 'claude');
  assert.equal(c.get('provider'), 'anthropic');
  c.removeKey('anthropic');
  assert.equal(c.get('provider'), 'openai');
  c.removeKey('openai');
  assert.equal(c.get('provider'), null);
});

test('an undecryptable key reads as not linked', () => {
  const dir = tmp();
  createConfig({ dir, cipher }).setKey('openai', 'sk', 'gpt');
  const broken = { ...cipher, decrypt: () => { throw new Error('DPAPI mismatch'); } };
  assert.equal(createConfig({ dir, cipher: broken }).publicView().linked.openai, false);
});

test('relinking a different compatible server replaces its preset and model', () => {
  const dir = tmp();
  const c = createConfig({ dir, cipher });
  c.setKey('compat', '{"url":"http://localhost:11434/v1","key":""}', 'llama3.2', { preset: 'ollama' });
  c.update({ models: { compat: 'qwen3:8b' } });
  c.setKey('compat', '{"url":"http://localhost:1234/v1","key":""}', 'gemma-3', { preset: 'lmstudio' });
  const v = createConfig({ dir, cipher }).publicView();
  assert.equal(v.compatPreset, 'lmstudio');
  assert.equal(v.models.compat, 'gemma-3');
  assert.equal(v.provider, 'compat');
  assert.throws(() => c.setKey('compat', '{}', 'x', { preset: 'nope' }), /Unknown preset/);
});
