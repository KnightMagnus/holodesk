// Launches HOLODESK in real Electron for end-to-end tests.
//   HOLODESK_EXE=<path>   test a packaged build instead of the source tree
//   ELECTRON_PATH=<path>  use a specific Electron binary for the source tree
//   HOLODESK_E2E_ARGS     extra Chromium switches, space separated
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function electronBinary() {
  if (process.env.ELECTRON_PATH) return process.env.ELECTRON_PATH;
  return (await import('electron')).default;
}

export async function launch({ settings } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'holodesk-e2e-'));
  if (settings) fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings));
  const exe = process.env.HOLODESK_EXE;
  const args = exe ? [] : [ROOT];
  if (process.platform === 'linux') args.push('--no-sandbox');
  if (process.env.HOLODESK_E2E_ARGS) args.push(...process.env.HOLODESK_E2E_ARGS.split(' '));

  const app = await electron.launch({
    executablePath: exe || (await electronBinary()),
    args,
    env: { ...process.env, HOLODESK_USER_DATA: userData },
    timeout: 45000
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.waitForSelector('#core');
  return {
    app,
    page,
    errors,
    userData,
    readSettings: () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')),
    async close() {
      await app.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  };
}

/** Poll fn until it returns truthy or time runs out. */
export async function until(fn, { timeout = 15000, interval = 200, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
