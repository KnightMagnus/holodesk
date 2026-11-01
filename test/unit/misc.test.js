import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { bytes, rate, uptime, reading, clamp } from '../../src/shared/format.js';
import { wmo } from '../../src/shared/wmo.js';
import { resolveAsset, mimeFor } from '../../src/main/serve.js';
import { buildContext } from '../../src/main/context.js';
import { createWindowsRecognizer } from '../../src/main/voice.js';
import { parsePlayCommand } from '../../src/renderer/js/voice/assistant.js';
import { rotation } from '../../src/renderer/js/ui/core/geometry.js';

test('format helpers', () => {
  assert.equal(bytes(0), '0 B');
  assert.equal(bytes(1536), '2 KB');
  assert.equal(bytes(64 * 1024 ** 3), '64.0 GB');
  assert.equal(bytes(-1), '—');
  assert.equal(bytes(null), '—');
  assert.equal(rate(2 * 1048576), '2.0 MB/s');
  assert.equal(rate(2048), '2 KB/s');
  assert.equal(uptime(3 * 86400 + 4 * 3600 + 17 * 60), '3d 04h 17m');
  assert.equal(uptime(59), '00h 00m');
  assert.equal(reading(-1, '°C'), 'N/A');
  assert.equal(reading(57.4, '°C'), '57°C');
  assert.equal(clamp(150, 0, 100), 100);
});

test('unknown weather codes degrade gracefully', () => {
  assert.deepEqual(wmo(2), ['Partly cloudy', 'partly']);
  assert.deepEqual(wmo(1234), ['Unknown', 'cloud']);
});

test('app:// paths resolve inside their roots only', () => {
  const roots = { '': path.resolve('/app/renderer'), shared: path.resolve('/app/shared') };
  assert.equal(resolveAsset(roots, 'app://holodesk/'), path.resolve('/app/renderer/index.html'));
  assert.equal(resolveAsset(roots, 'app://holodesk/js/main.js'), path.resolve('/app/renderer/js/main.js'));
  assert.equal(resolveAsset(roots, 'app://holodesk/shared/format.js'), path.resolve('/app/shared/format.js'));
  // URL parsing collapses encoded dot segments before we see them, so this stays inside renderer/
  assert.equal(resolveAsset(roots, 'app://holodesk/%2e%2e/main/index.js'), path.resolve('/app/renderer/main/index.js'));
  assert.equal(resolveAsset(roots, 'app://holodesk/shared/..%2f..%2fmain%2fconfig.js'), null);
  assert.equal(resolveAsset(roots, 'app://holodesk/%E0%A4%A'), null, 'malformed escapes are rejected');
  assert.equal(mimeFor('a/b.JS'), 'text/javascript; charset=utf-8');
  assert.equal(mimeFor('a/b.exe'), 'application/octet-stream');
});

test('AI context includes hardware, live load and weather', () => {
  const ctx = buildContext({
    info: { cpu: { name: 'Ryzen', cores: 8, threads: 16 }, gpus: [{ model: 'RTX' }], mem: { total: 32 * 1024 ** 3 }, os: { distro: 'Windows 11', release: '10' }, board: { maker: 'ASUS', model: 'X' }, displays: [{ resX: 3440, resY: 1440, hz: 165 }] },
    snap: { cpu: { load: 12.4, temp: null }, mem: { used: 8 * 1024 ** 3 }, gpu: { util: 40, temp: 60 }, drives: [{ mount: 'C:', size: 100, used: 40 }], procs: [{ name: 'game.exe' }], uptime: 3600 },
    weather: { loc: { name: 'Seattle' }, units: 'imperial', w: { current: { weather_code: 61, temperature_2m: 50.4, apparent_temperature: 47, relative_humidity_2m: 80, wind_speed_10m: 7 }, daily: { time: ['2026-11-01'], weather_code: [61], temperature_2m_max: [55], temperature_2m_min: [45] } } },
    now: new Date('2026-11-01T12:00:00Z')
  });
  assert.match(ctx, /CPU: Ryzen \(8C\/16T\)/);
  assert.match(ctx, /3440x1440@165Hz/);
  assert.match(ctx, /CPU load 12%, temp N\/A/);
  assert.match(ctx, /Weather in Seattle: Light rain, 50F/);
  assert.match(ctx, /game\.exe/);
});

test('play commands are recognised, normal questions are not', () => {
  assert.equal(parsePlayCommand('play lofi beats'), 'lofi beats');
  assert.equal(parsePlayCommand('Hey HOLODESK, play daft punk on YouTube.'), 'daft punk');
  assert.equal(parsePlayCommand('youtube cat videos'), 'cat videos');
  assert.equal(parsePlayCommand('what should I play tonight?'), null);
  assert.equal(parsePlayCommand('playing games is fun'), null);
});

test('sphere rotation matrix matches the reference Y-then-X rotation', () => {
  const ry = 0.7;
  const rx = -0.4;
  const m = rotation(ry, rx);
  const [x, y, z] = [0.3, -0.5, 0.81];
  const X1 = x * Math.cos(ry) - z * Math.sin(ry);
  const Z1 = x * Math.sin(ry) + z * Math.cos(ry);
  const ref = [X1, y * Math.cos(rx) - Z1 * Math.sin(rx), y * Math.sin(rx) + Z1 * Math.cos(rx)];
  const got = [0, 1, 2].map((r) => m[r] * x + m[3 + r] * y + m[6 + r] * z);
  got.forEach((v, i) => assert.ok(Math.abs(v - ref[i]) < 1e-6, `component ${i}: ${v} vs ${ref[i]}`));
});

function fakeRecognizerSpawn() {
  const procs = [];
  const spawnFn = () => {
    const p = new EventEmitter();
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    p.stdin = new PassThrough();
    p.kill = () => p.emit('exit', null);
    p.stdin.on('data', (d) => p.emit('command', String(d).trim()));
    procs.push(p);
    return p;
  };
  return { spawnFn, procs };
}

test('Windows recognizer: one process serves several utterances', async () => {
  const { spawnFn, procs } = fakeRecognizerSpawn();
  const rec = createWindowsRecognizer({ scriptPath: 'x.ps1', spawnFn, idleMs: 60000 });
  const replies = ['{"ready":true}\n{"text":"hello there"}\n', '{"text":"second"}\n'];
  const answer = () => procs[0].stdout.write(replies.shift());
  setTimeout(answer, 5);
  assert.equal(await rec.listen(), 'hello there');
  setTimeout(answer, 5);
  assert.equal(await rec.listen(), 'second');
  assert.equal(procs.length, 1);
  rec.dispose();
});

test('Windows recognizer: errors, crashes and cancel are reported cleanly', async () => {
  const { spawnFn, procs } = fakeRecognizerSpawn();
  const rec = createWindowsRecognizer({ scriptPath: 'x.ps1', spawnFn, idleMs: 60000 });

  setTimeout(() => procs[0].stdout.write('{"error":"No recognizer is installed"}\n'), 5);
  await assert.rejects(rec.listen(), /No recognizer/);

  setTimeout(() => {
    procs[0].stderr.write('Add-Type : Cannot find System.Speech\n');
    procs[0].emit('exit', 1);
  }, 5);
  await assert.rejects(rec.listen(), /System\.Speech/);

  const pending = rec.listen();
  assert.equal(procs.length, 2, 'restarts after a crash');
  rec.cancel();
  assert.equal(await pending, '');
  rec.dispose();
});
