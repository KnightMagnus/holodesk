// Weather from Open-Meteo (no key). Location is the configured city or IP geolocation.
// Results are cached in memory and on disk so the panel fills instantly on launch
// and survives being offline.
import fs from 'node:fs';
import { getJson as defaultGetJson } from './net.js';

const IMPERIAL_COUNTRIES = new Set(['US', 'LR', 'MM']);
const FRESH_MS = 10 * 60 * 1000;

export function forecastUrl({ lat, lon }, imperial) {
  const p = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,is_day',
    hourly: 'temperature_2m,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: 7
  });
  if (imperial) {
    p.set('temperature_unit', 'fahrenheit');
    p.set('wind_speed_unit', 'mph');
    p.set('precipitation_unit', 'inch');
  }
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

export function createWeather({ getSetting, cacheFile, getJson = defaultGetJson, now = Date.now }) {
  let cache = readCache();
  let geo = null; // { key, loc }
  let inflight = null;

  function readCache() {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      return null;
    }
  }

  async function locate() {
    const city = getSetting('city').trim();
    const key = city.toLowerCase() || 'ip';
    if (geo?.key === key) return geo.loc;
    let loc;
    if (city) {
      const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`);
      const r = g.results?.[0];
      if (!r) throw new Error(`City not found: ${city}`);
      loc = { lat: r.latitude, lon: r.longitude, name: r.name, region: r.admin1 || '', country: r.country_code };
    } else {
      loc = await ipLocate();
    }
    geo = { key, loc };
    return loc;
  }

  async function ipLocate() {
    try {
      const j = await getJson('https://ipwho.is/', { timeout: 8000 });
      if (j.success !== false && j.latitude != null) {
        return { lat: j.latitude, lon: j.longitude, name: j.city, region: j.region, country: j.country_code };
      }
    } catch {
      // try the fallback provider
    }
    const j = await getJson('https://ipapi.co/json/', { timeout: 8000 });
    return { lat: j.latitude, lon: j.longitude, name: j.city, region: j.region, country: j.country_code };
  }

  async function refresh() {
    const loc = await locate();
    const units = getSetting('units') || (IMPERIAL_COUNTRIES.has(loc.country) ? 'imperial' : 'metric');
    const w = await getJson(forecastUrl(loc, units === 'imperial'));
    cache = { loc, units, w, fetchedAt: now(), settingsKey: settingsKey() };
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {
      // cache is an optimisation only
    }
    return cache;
  }

  const settingsKey = () => `${getSetting('city').trim().toLowerCase()}|${getSetting('units')}`;

  return {
    /** Cached data if it is fresh and matches current settings, otherwise a fetch. */
    async get({ force = false } = {}) {
      const valid = cache && cache.settingsKey === settingsKey();
      if (!force && valid && now() - cache.fetchedAt < FRESH_MS) return cache;
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      try {
        return await inflight;
      } catch (err) {
        if (valid) return { ...cache, stale: true };
        throw err;
      }
    },
    /** Last known data without touching the network (for AI context). */
    peek: () => cache,
    resetLocation() {
      geo = null;
    }
  };
}
