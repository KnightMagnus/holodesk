import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOllamaSetup } from '../../src/main/ollama.js';

const ndjson = (...objs) => new Response(objs.map((o) => JSON.stringify(o)).join('\n') + '\n');

// A small fake world: Ollama is missing until the installer runs, down until started.
function world({ signer = 'Valid|CN=Ollama Inc., O=Ollama Inc., C=US', models = [], pullLines } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holodesk-ollama-'));
  const state = { installed: false, up: false, spawned: [], installerSeen: null };
  const fetchFn = async (url, init = {}) => {
    if (url.endsWith('/OllamaSetup.exe')) {
      return new Response(new Uint8Array(4000), { headers: { 'content-length': '4000' } });
    }
    if (!state.up) throw new TypeError('fetch failed');
    if (url.endsWith('/api/version')) return Response.json({ version: '0.12.0' });
    if (url.endsWith('/api/tags')) return Response.json({ models: models.map((name) => ({ name })) });
    if (url.endsWith('/api/pull')) {
      assert.equal(JSON.parse(init.body).stream, true);
      return pullLines ? ndjson(...pullLines) : ndjson(
        { status: 'pulling manifest' },
        { status: 'pulling abc', total: 2e9, completed: 1e9 },
        { status: 'pulling abc', total: 2e9, completed: 2e9 },
        { status: 'success' }
      );
    }
    throw new Error(`unexpected ${url}`);
  };
  const spawnFn = (file, args) => {
    state.spawned.push([path.basename(file), ...args]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => {
      if (file === 'powershell.exe') {
        child.stdout.emit('data', signer);
        child.emit('exit', 0);
      } else if (args.includes('/VERYSILENT')) {
        state.installerSeen = fs.existsSync(file);
        state.installed = true;
        child.emit('exit', 0);
      } else {
        state.up = true; // tray app or `ollama serve`
      }
    });
    return child;
  };
  const exists = (p) => state.installed && /ollama( app)?\.exe$/.test(p);
  const setup = createOllamaSetup({ fetchFn, spawnFn, exists, env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, platform: 'win32', tmpDir, sleep: () => new Promise((r) => setImmediate(r)), waitMs: 2000 });
  return { setup, state, tmpDir };
}

test('status reports a missing, stopped Ollama', async () => {
  const { setup } = world();
  assert.deepEqual(await setup.status(), { supported: true, running: false, installed: false, models: [] });
});

test('setup installs a signed installer, starts Ollama and pulls the model', async () => {
  const { setup, state, tmpDir } = world();
  const phases = [];
  await setup.setup('llama3.2', (phase, text, pct) => phases.push([phase, pct]));
  assert.ok(state.installerSeen, 'installer was on disk when run');
  assert.deepEqual(fs.readdirSync(tmpDir), [], 'installer cleaned up');
  assert.deepEqual(state.spawned.map((s) => s[0]), ['powershell.exe', path.basename(state.spawned[1][0]), 'ollama app.exe']);
  assert.ok(state.spawned[1].includes('/VERYSILENT'));
  const order = [...new Set(phases.map(([p]) => p))];
  assert.deepEqual(order, ['download', 'install', 'start', 'pull', 'done']);
  assert.ok(phases.some(([p, pct]) => p === 'pull' && pct === 0.5));
});

test('an installer not signed by Ollama is never run', async () => {
  const { setup, state, tmpDir } = world({ signer: 'Valid|CN=Someone Else, O=Evil Corp' });
  await assert.rejects(setup.setup('llama3.2'), /not signed by Ollama/);
  assert.ok(!state.spawned.some((s) => s.includes('/VERYSILENT')));
  assert.deepEqual(fs.readdirSync(tmpDir), []);
  const unsigned = world({ signer: 'NotSigned|' });
  await assert.rejects(unsigned.setup.setup('llama3.2'), /not signed/);
});

test('an existing install with the model already pulled does nothing extra', async () => {
  const { setup, state } = world({ models: ['llama3.2:latest'] });
  state.installed = true;
  state.up = true;
  const phases = [];
  await setup.setup('llama3.2', (phase) => phases.push(phase));
  assert.deepEqual(state.spawned, []);
  assert.deepEqual(phases, ['done']);
});

test('pull errors from Ollama surface clearly', async () => {
  const { setup, state } = world({ pullLines: [{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }] });
  state.installed = true;
  state.up = true;
  await assert.rejects(setup.setup('llama3.2'), /Model download failed: pull model manifest/);
});

test('setup is Windows-only and runs one at a time', async () => {
  await assert.rejects(createOllamaSetup({ platform: 'linux' }).setup('llama3.2'), /only available on Windows/);
  const { setup } = world();
  const first = setup.setup('llama3.2');
  await assert.rejects(setup.setup('llama3.2'), /already running/);
  await first;
});
