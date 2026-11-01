// Smoke test for a packaged build (HOLODESK_EXE). Production fuses disable Node's
// --inspect, so Playwright's Electron driver cannot attach; this test talks to the
// renderer over Chromium's DevTools protocol instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { until } from './harness.js';

const exe = process.env.HOLODESK_EXE;

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

test('packaged build launches and renders live telemetry', { skip: !exe && 'set HOLODESK_EXE to test a packaged build' }, async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'holodesk-pkg-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ onboarded: true }));
  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`];
  if (process.platform === 'linux') args.push('--no-sandbox');
  if (process.env.HOLODESK_E2E_ARGS) args.push(...process.env.HOLODESK_E2E_ARGS.split(' '));
  const child = spawn(exe, args, { env: { ...process.env, HOLODESK_USER_DATA: userData }, stdio: 'ignore' });

  let browser;
  try {
    browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null), { timeout: 30000, message: 'DevTools endpoint' });
    const page = await until(() => browser.contexts()[0]?.pages().find((p) => p.url().startsWith('app://holodesk')), { message: 'HOLODESK page' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await until(() => page.evaluate(() => document.querySelector('[data-bind="cpuName"]')?.textContent !== '—'), { message: 'CPU panel' });
    await until(() => page.evaluate(() => document.querySelector('[data-bind="procCount"]')?.textContent !== '—'), { message: 'process count' });
    const env = await page.evaluate(() => ({ require: typeof window.require, bridge: typeof window.holodesk, dev: document.querySelector('script[src*="dev/"]') === null }));
    assert.deepEqual(env, { require: 'undefined', bridge: 'object', dev: true });
    const devFile = await page.evaluate(async () => (await fetch('app://holodesk/js/dev/mock-bridge.js')).status);
    assert.equal(devFile, 404, 'dev-only files are not shipped');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close().catch(() => {});
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
