import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, until } from './harness.js';

const CONFIGURED = { onboarded: true, quality: 'high', city: 'Seattle' };
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());

// Budget covers a cold first launch on a fresh CI VM (Defender scan + WMI warm-up);
// a normal launch on a desktop is a few seconds.
const STARTUP_BUDGET_MS = 30000;

test('boots clean and fills hardware panels', async (t) => {
  const started = Date.now();
  const h = await launch({ settings: CONFIGURED });
  try {
    await until(async () => (await text(h.page, '[data-bind="cpuName"]')) !== '—', { timeout: STARTUP_BUDGET_MS, message: 'CPU name' });
    const elapsed = Date.now() - started;
    t.diagnostic(`startup to filled CPU panel: ${elapsed}ms`);
    assert.ok(elapsed < STARTUP_BUDGET_MS, `startup took ${elapsed}ms`);
    assert.ok((await h.page.$$('#threads .thread')).length > 0, 'thread bars rendered');
    await until(async () => (await text(h.page, '[data-bind="procCount"]')) !== '—', { message: 'process count' });
    assert.match(await text(h.page, '[data-bind="coreQuality"]'), /^FX · HIGH/);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test('telemetry streams while visible and stops when hidden', async () => {
  const h = await launch({ settings: CONFIGURED });
  try {
    await h.page.evaluate(() => {
      window.__ticks = 0;
      window.holodesk.system.onTelemetry(() => window.__ticks++);
    });
    await until(() => h.page.evaluate(() => window.__ticks >= 2), { message: 'telemetry ticks' });

    await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await new Promise((r) => setTimeout(r, 1500));
    await h.page.evaluate(() => { window.__ticks = 0; });
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(await h.page.evaluate(() => window.__ticks), 0, 'no telemetry while hidden');

    await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await until(() => h.page.evaluate(() => window.__ticks >= 1), { message: 'telemetry after show' });
  } finally {
    await h.close();
  }
});

test('first run opens the uplink overlay once; Esc closes it', async () => {
  const h = await launch();
  try {
    await h.page.waitForSelector('#overlay:not([hidden])');
    await h.page.keyboard.press('Escape');
    await h.page.waitForSelector('#overlay', { state: 'hidden' });
    await until(() => h.readSettings().onboarded === true, { message: 'onboarded flag' });
  } finally {
    await h.close();
  }
});

test('settings persist; a bad API key is rejected with a message', async () => {
  const h = await launch({ settings: CONFIGURED });
  try {
    await h.page.keyboard.press('Control+,');
    await h.page.waitForSelector('#overlay:not([hidden])');
    await h.page.fill('.prov[data-provider="anthropic"] .prov-key', 'sk-ant-not-a-real-key');
    await h.page.click('.prov[data-provider="anthropic"] [data-action="link"]');
    await until(async () => /Link failed/.test(await text(h.page, '#ov-msg')), { timeout: 30000, message: 'link failure message' });
    assert.ok(!JSON.stringify(h.readSettings()).includes('sk-ant-not-a-real-key'), 'rejected key never stored');

    await h.page.selectOption('[name="quality"]', 'low');
    await h.page.selectOption('[name="clock24"]', 'false');
    await h.page.click('[data-action="save-settings"]');
    await h.page.waitForSelector('#overlay', { state: 'hidden' });
    assert.equal(await h.page.evaluate(() => document.body.dataset.quality), 'low');
    const saved = h.readSettings();
    assert.equal(saved.quality, 'low');
    assert.equal(saved.clock24, false);
    await until(async () => /AM|PM/.test(await text(h.page, '#time')), { message: '12-hour clock' });
  } finally {
    await h.close();
  }
});

test('renderer is sandboxed and IPC validates input', async () => {
  const h = await launch({ settings: CONFIGURED });
  try {
    const probe = await h.page.evaluate(async () => {
      const result = { require: typeof window.require, process: typeof window.process };
      const err = async (p) => p.then(() => 'resolved', (e) => e.message);
      result.badLink = await err(window.holodesk.app.openExternal('https://evil.example/'));
      result.emptyMessage = await err(window.holodesk.ai.send(''));
      result.badProvider = await err(window.holodesk.settings.unlink('gemini'));
      result.badSetting = await err(window.holodesk.settings.update({ keys: { openai: 'x' } }));
      result.traversal = (await fetch('app://holodesk/shared/..%2f..%2fmain%2fconfig.js')).status;
      result.missing = (await fetch('app://holodesk/nope.js')).status;
      return result;
    });
    assert.deepEqual(probe, {
      require: 'undefined',
      process: 'undefined',
      badLink: 'Blocked link',
      emptyMessage: 'Invalid message',
      badProvider: 'Invalid provider',
      badSetting: 'Unknown setting: keys',
      traversal: 403,
      missing: 404
    });
  } finally {
    await h.close();
  }
});

test('typing without an uplink gets a helpful reply instead of an error', async () => {
  const h = await launch({ settings: CONFIGURED });
  try {
    await h.page.fill('#prompt', 'hello?');
    await h.page.press('#prompt', 'Enter');
    await until(async () => /uplink is offline/i.test(await text(h.page, '#log')), { message: 'offline reply' });
    await h.page.keyboard.press('Escape');
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
  }
});

test('voice input explains itself when no engine is available', { skip: process.platform === 'win32' && 'needs a microphone on Windows' }, async () => {
  const h = await launch({ settings: CONFIGURED });
  try {
    await h.page.click('#mic');
    await until(async () => /VOICE · .*Windows or an OpenAI key/.test(await text(h.page, '#log')), { message: 'voice message' });
    assert.equal(await text(h.page, '#state-text'), 'STANDBY');
  } finally {
    await h.close();
  }
});
