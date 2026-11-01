// IPC plumbing. Handlers return plain values or throw; the wrapper turns that into
// { ok, value } / { ok: false, error } so the preload can rethrow a clean Error
// (Electron otherwise prefixes "Error invoking remote method ...").
import { ipcMain } from 'electron';

export function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await fn(...args, event) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), aborted: err?.name === 'AbortError' };
    }
  });
}

export const check = {
  str(v, name, max = 4000) {
    if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Invalid ${name}`);
    return v.trim();
  },
  oneOf(v, name, options) {
    if (!options.includes(v)) throw new Error(`Invalid ${name}`);
    return v;
  },
  bytes(v, name, max) {
    if (!(v instanceof Uint8Array) || v.byteLength === 0 || v.byteLength > max) throw new Error(`Invalid ${name}`);
    return v;
  }
};
