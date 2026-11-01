// Voice I/O that has to run in the main process:
//   - Windows offline speech recognition (System.Speech in a long-lived PowerShell)
//   - OpenAI Whisper transcription and OpenAI text-to-speech
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { request } from './net.js';

const IDLE_KILL_MS = 5 * 60 * 1000;

/**
 * Keeps one PowerShell recognizer alive between utterances (cold start is ~1s) and
 * shuts it down after a few idle minutes so it does not hold memory.
 */
export function createWindowsRecognizer({ scriptPath, spawnFn = spawn, idleMs = IDLE_KILL_MS }) {
  let child = null;
  let pending = null; // { resolve, reject }
  let idleTimer = null;
  let stderr = '';

  function settle(fn, value) {
    const p = pending;
    pending = null;
    p?.[fn](value);
  }

  function start() {
    stderr = '';
    child = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-2000);
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.ready) return;
      if (msg.error) settle('reject', new Error(msg.error));
      else settle('resolve', String(msg.text || ''));
    });
    const proc = child;
    const onGone = (err) => {
      if (child === proc) child = null;
      const reason = err?.message || stderr.trim().split(/\r?\n/).find(Boolean) || 'Speech recognizer stopped';
      settle('reject', new Error(reason));
    };
    child.on('error', onGone);
    child.on('exit', () => onGone());
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => dispose(), idleMs);
    idleTimer.unref?.();
  }

  function dispose() {
    clearTimeout(idleTimer);
    const proc = child;
    child = null;
    if (proc) {
      try {
        proc.stdin.end('exit\n');
      } catch {
        // already closed
      }
      setTimeout(() => proc.kill(), 1500).unref?.();
    }
  }

  return {
    listen() {
      if (pending) return Promise.reject(new Error('Already listening'));
      if (!child) start();
      clearTimeout(idleTimer);
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        child.stdin.write('listen\n');
      }).finally(armIdle);
    },
    // System.Speech cannot abort a blocking Recognize call, so cancel restarts the helper.
    cancel() {
      if (!pending) return;
      settle('resolve', '');
      const proc = child;
      child = null;
      proc?.kill();
    },
    dispose
  };
}

export async function transcribe({ key, audio, mime = 'audio/webm' }) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), 'speech.webm');
  form.append('model', 'whisper-1');
  const res = await request('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    timeout: 30000
  });
  return ((await res.json()).text || '').trim();
}

export async function synthesize({ key, text, voice }) {
  const res = await request('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice, input: text.slice(0, 4000), response_format: 'mp3' }),
    timeout: 30000
  });
  return new Uint8Array(await res.arrayBuffer());
}
