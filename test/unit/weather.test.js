import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWeather, forecastUrl } from '../../src/main/weather.js';

const forecast = { current: { temperature_2m: 10 }, hourly: {}, daily: {} };

function harness({ city = '', units = '', ipCountry = 'US', failForecast = false } = {}) {
  const settings = { city, units };
  const calls = [];
  let clock = 1_000_000;
  const getJson = async (url) => {
    calls.push(url);
    if (url.includes('ipwho.is')) return { success: true, latitude: 47.6, longitude: -122.3, city: 'Seattle', region: 'WA', country_code: ipCountry };
    if (url.includes('geocoding')) return { results: settings.city === 'Nowhere' ? [] : [{ latitude: 59.9, longitude: 10.7, name: 'Oslo', admin1: 'Oslo', country_code: 'NO' }] };
    if (url.includes('forecast')) {
      if (failForecast) throw new Error('offline');
      return forecast;
    }
    throw new Error(`unexpected ${url}`);
  };
  const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wx-')), 'cache.json');
  const w = createWeather({ getSetting: (k) => settings[k], cacheFile, getJson, now: () => clock });
  return { w, calls, settings, cacheFile, advance: (ms) => { clock += ms; }, setFail: (v) => { failForecast = v; } };
}

test('auto units: imperial for US, metric elsewhere', async () => {
  assert.equal((await harness({ ipCountry: 'US' }).w.get()).units, 'imperial');
  assert.equal((await harness({ ipCountry: 'DE' }).w.get()).units, 'metric');
  assert.ok(forecastUrl({ lat: 1, lon: 2 }, true).includes('temperature_unit=fahrenheit'));
  assert.ok(!forecastUrl({ lat: 1, lon: 2 }, false).includes('fahrenheit'));
});

test('serves from cache while fresh, refetches after 10 minutes', async () => {
  const h = harness();
  await h.w.get();
  await h.w.get();
  assert.equal(h.calls.filter((u) => u.includes('forecast')).length, 1);
  h.advance(11 * 60 * 1000);
  await h.w.get();
  assert.equal(h.calls.filter((u) => u.includes('forecast')).length, 2);
  assert.equal(h.calls.filter((u) => u.includes('ipwho')).length, 1, 'IP location looked up once');
});

test('a configured city is geocoded and changing it invalidates the cache', async () => {
  const h = harness();
  await h.w.get();
  h.settings.city = 'Oslo';
  const r = await h.w.get();
  assert.equal(r.loc.name, 'Oslo');
  assert.equal(r.units, 'metric');
  h.settings.city = 'Nowhere';
  await assert.rejects(h.w.get(), /City not found/);
});

test('returns stale data when offline, and loads the disk cache on restart', async () => {
  const h = harness();
  await h.w.get();
  h.advance(60 * 60 * 1000);
  h.setFail(true);
  const r = await h.w.get();
  assert.equal(r.stale, true);
  const reborn = createWeather({ getSetting: (k) => h.settings[k], cacheFile: h.cacheFile, getJson: async () => { throw new Error('offline'); } });
  assert.equal(reborn.peek().loc.name, 'Seattle');
});

test('concurrent requests share one fetch', async () => {
  const h = harness();
  await Promise.all([h.w.get(), h.w.get(), h.w.get()]);
  assert.equal(h.calls.filter((u) => u.includes('forecast')).length, 1);
});
