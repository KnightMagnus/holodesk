// One-click local AI: install Ollama, start it, and download a model, reporting
// progress to the HUD. Only fixed URLs are fetched and only a validly signed
// installer is run; the renderer picks a model from a fixed list, nothing else.
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const OLLAMA_API = 'http://127.0.0.1:11434';
const DOWNLOAD_URL = 'https://ollama.com/download/OllamaSetup.exe';
const SIGNER = /\bO="?Ollama\b/i;

const cancelled = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });

export function createOllamaSetup({
  fetchFn = (...a) => fetch(...a),
  spawnFn = nodeSpawn,
  exists = fs.existsSync,
  env = process.env,
  platform = process.platform,
  tmpDir = os.tmpdir(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  waitMs = 45000
} = {}) {
  const installDir = path.join(env.LOCALAPPDATA || '', 'Programs', 'Ollama');
  let controller = null;

  async function api(p, init = {}, timeout = 2000) {
    const res = await fetchFn(`${OLLAMA_API}${p}`, { ...init, signal: init.signal || AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`Ollama: HTTP ${res.status}`);
    return res;
  }

  async function running() {
    try {
      await api('/api/version');
      return true;
    } catch {
      return false;
    }
  }

  async function installedModels() {
    const j = await (await api('/api/tags')).json();
    return (j.models || []).map((m) => m.name || m.model);
  }

  async function status() {
    const up = await running();
    return {
      supported: platform === 'win32',
      running: up,
      installed: up || exists(path.join(installDir, 'ollama.exe')),
      models: up ? await installedModels().catch(() => []) : []
    };
  }

  function run(file, args, { detached = false } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawnFn(file, args, { windowsHide: true, detached, stdio: detached ? 'ignore' : ['ignore', 'pipe', 'ignore'] });
      if (detached) {
        child.on('error', reject);
        child.unref?.();
        return resolve('');
      }
      let out = '';
      child.stdout?.on('data', (d) => {
        out += d;
      });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(file)} exited with code ${code}`))));
    });
  }

  async function waitUntilUp(signal) {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      if (signal.aborted) throw cancelled();
      if (await running()) return;
      await sleep(500);
    }
    throw new Error('Ollama did not start. Open it from the Start menu and try again.');
  }

  async function download(progress, signal) {
    const file = path.join(tmpDir, `OllamaSetup-${Date.now()}.exe`);
    const res = await fetchFn(DOWNLOAD_URL, { signal });
    if (!res.ok || !res.body) throw new Error(`Ollama download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    let last = 0;
    async function* counted(source) {
      for await (const chunk of source) {
        got += chunk.length;
        // ~1% steps; one IPC message per chunk would flood the renderer
        if (total && got - last >= total / 100) {
          last = got;
          progress('download', `Downloading Ollama · ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB`, got / total);
        }
        yield chunk;
      }
    }
    try {
      await pipeline(Readable.fromWeb(res.body), counted, fs.createWriteStream(file), { signal });
    } catch (err) {
      fs.rmSync(file, { force: true });
      throw signal.aborted ? cancelled() : err;
    }
    return file;
  }

  async function verifySignature(file) {
    const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`;
    const out = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps])).trim();
    const [state, subject = ''] = out.split('|');
    if (state !== 'Valid' || !SIGNER.test(subject)) throw new Error('The Ollama installer is not signed by Ollama. Setup stopped.');
  }

  async function install(progress, signal) {
    const file = await download(progress, signal);
    try {
      progress('install', 'Checking installer signature', null);
      await verifySignature(file);
      if (signal.aborted) throw cancelled();
      progress('install', 'Installing Ollama', null);
      await run(file, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES']);
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  async function start(progress, signal) {
    if (await running()) return; // the installer may have launched it already
    progress('start', 'Starting Ollama', null);
    const tray = path.join(installDir, 'ollama app.exe');
    if (exists(tray)) await run(tray, [], { detached: true });
    else await run(path.join(installDir, 'ollama.exe'), ['serve'], { detached: true });
    await waitUntilUp(signal);
  }

  async function pull(model, progress, signal) {
    const res = await fetchFn(`${OLLAMA_API}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal
    });
    if (!res.ok || !res.body) throw new Error(`Model download failed: HTTP ${res.status}`);
    let buf = '';
    let last = -1;
    const decoder = new TextDecoder();
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.error) throw new Error(`Model download failed: ${msg.error}`);
          if (msg.total && msg.completed != null) {
            const pct = msg.completed / msg.total;
            if (pct - last < 0.01 && pct < 1) continue;
            last = pct;
            progress('pull', `Downloading ${model} · ${(msg.completed / 1e9).toFixed(1)} of ${(msg.total / 1e9).toFixed(1)} GB`, pct);
          } else if (msg.status) {
            progress('pull', `${model} · ${msg.status}`, null);
          }
        }
      }
    } catch (err) {
      throw signal.aborted ? cancelled() : err;
    }
  }

  return {
    status,

    /** Installs and starts Ollama if needed, then downloads `model` if it is missing. */
    async setup(model, progress = () => {}) {
      if (platform !== 'win32') throw new Error('One-click setup is only available on Windows');
      if (controller) throw new Error('Setup is already running');
      const own = new AbortController();
      controller = own;
      try {
        let s = await status();
        if (!s.installed) await install(progress, own.signal);
        if (!s.running) await start(progress, own.signal);
        s = await status();
        if (!s.models.some((m) => m === model || m === `${model}:latest`)) await pull(model, progress, own.signal);
        progress('done', `${model} is ready`, 1);
      } finally {
        if (controller === own) controller = null;
      }
    },

    cancel() {
      controller?.abort();
      controller = null;
    }
  };
}
