// Weather panel. Data comes from the main process (cached there); icons are drawn on
// canvas in the theme hue.
import { wmo } from '/shared/wmo.js';
import { $, bind, esc } from '../lib/dom.js';
import { drawSpark } from '../ui/spark.js';
import { theme } from '../ui/theme.js';

const REFRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function drawWeatherIcon(canvas, kind, day = true) {
  const ctx = canvas.getContext('2d');
  const s = canvas.width / 150;
  const h = theme.hueStep;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, 150, 150);
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = `hsl(${h} 100% 68%)`;
  ctx.shadowColor = `hsl(${h} 100% 60%)`;
  ctx.shadowBlur = 12;

  const sun = (cx, cy, r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (!day) {
      ctx.beginPath();
      ctx.arc(cx + r * 0.5, cy - r * 0.4, r * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = '#01060d';
      ctx.fill();
      return;
    }
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.moveTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8));
      ctx.lineTo(cx + Math.cos(a) * (r + 18), cy + Math.sin(a) * (r + 18));
    }
    ctx.stroke();
  };
  const cloud = (ox, oy) => {
    ctx.beginPath();
    ctx.moveTo(ox + 28, oy + 60);
    ctx.arc(ox + 34, oy + 44, 18, Math.PI * 0.6, Math.PI * 1.5);
    ctx.arc(ox + 64, oy + 32, 26, Math.PI * 1.15, Math.PI * 1.95);
    ctx.arc(ox + 94, oy + 46, 16, Math.PI * 1.45, Math.PI * 0.45);
    ctx.closePath();
    ctx.fillStyle = 'rgb(1 10 20 / .85)';
    ctx.fill();
    ctx.stroke();
  };
  const strokes = (segments) => {
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of segments) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  };

  if (kind === 'sun') sun(75, 75, 26);
  else if (kind === 'partly') {
    sun(56, 54, 20);
    cloud(22, 42);
  } else if (kind === 'fog') {
    cloud(14, 18);
    strokes([[26, 96, 124, 96], [32, 110, 118, 110], [38, 124, 112, 124]]);
  } else {
    cloud(14, 20);
    if (kind === 'rain') strokes([[44, 100, 36, 122], [66, 106, 58, 128], [88, 100, 80, 122], [110, 106, 102, 128]]);
    if (kind === 'snow') {
      for (const [x, y] of [[44, 112], [70, 120], [96, 112]]) {
        strokes([0, 1, 2].map((k) => {
          const a = (k * Math.PI) / 3;
          return [x - Math.cos(a) * 7, y - Math.sin(a) * 7, x + Math.cos(a) * 7, y + Math.sin(a) * 7];
        }));
      }
    }
    if (kind === 'storm') {
      ctx.beginPath();
      ctx.moveTo(78, 92);
      ctx.lineTo(64, 116);
      ctx.lineTo(80, 116);
      ctx.lineTo(68, 140);
      ctx.stroke();
    }
  }
}

export function createWeatherPanel(api, { onError }) {
  let data = null;
  let timer = 0;

  function render() {
    const { loc, units, w, stale } = data;
    const c = w.current;
    const d = w.daily;
    const imperial = units === 'imperial';
    const tU = imperial ? '°F' : '°C';
    const [cond, kind] = wmo(c.weather_code);
    bind('wxLoc', `${loc.name}${loc.region ? `, ${loc.region}` : ''}${stale ? ' · OFFLINE' : ''}`.toUpperCase());
    bind('wxTemp', `${Math.round(c.temperature_2m)}${tU}`);
    bind('wxCond', cond);
    bind('wxHL', `H ${Math.round(d.temperature_2m_max[0])}°  ·  L ${Math.round(d.temperature_2m_min[0])}°`);
    bind('wxFeels', `${Math.round(c.apparent_temperature)}${tU}`);
    bind('wxHum', `${c.relative_humidity_2m}%`);
    bind('wxWind', `${Math.round(c.wind_speed_10m)} ${imperial ? 'mph' : 'km/h'} ${COMPASS[Math.round(c.wind_direction_10m / 45) % 8]}`);
    bind('wxPres', imperial ? `${(c.surface_pressure * 0.02953).toFixed(2)} inHg` : `${Math.round(c.surface_pressure)} hPa`);
    bind('wxUv', `${Math.round(d.uv_index_max[0] ?? 0)} / ${d.precipitation_probability_max[0] ?? 0}%`);
    const hm = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    bind('wxSun', `${hm(d.sunrise[0])} / ${hm(d.sunset[0])}`);
    drawWeatherIcon($('#wx-icon'), kind, Boolean(c.is_day));

    // next 24 hours: temperature filled, rain chance as a line
    const now = Date.now();
    const start = Math.max(0, w.hourly.time.findIndex((t) => new Date(t).getTime() >= now) - 1);
    const temps = w.hourly.temperature_2m.slice(start, start + 24);
    const rain = w.hourly.precipitation_probability.slice(start, start + 24);
    const lo = Math.min(...temps) - 3;
    const hi = Math.max(...temps) + 3;
    const labels = [0, 6, 12, 18].filter((i) => i < temps.length).map((i) =>
      [i, `${new Date(w.hourly.time[start + i]).toLocaleTimeString([], { hour: 'numeric' })} ${Math.round(temps[i])}°`]);
    drawSpark($('#wx-spark'), [
      { data: temps.map((t) => t - lo) },
      { data: rain.map((r) => ((r ?? 0) / 100) * (hi - lo) * 0.5) }
    ], { max: hi - lo, slots: 24, labels });

    $('#wx-days').innerHTML = d.time.slice(1, 7).map((day, i) => {
      const name = new Date(`${day}T12:00`).toLocaleDateString([], { weekday: 'short' }).toUpperCase();
      return `<div class="wx-day"><div class="d">${esc(name)}</div><canvas width="92" height="92" data-kind="${wmo(d.weather_code[i + 1])[1]}"></canvas>` +
        `<div class="t">${Math.round(d.temperature_2m_max[i + 1])}° <i>${Math.round(d.temperature_2m_min[i + 1])}°</i></div></div>`;
    }).join('');
    for (const cv of $('#wx-days').querySelectorAll('canvas')) drawWeatherIcon(cv, cv.dataset.kind, true);
  }

  async function refresh(force = false) {
    clearTimeout(timer);
    try {
      data = await api.weather.get(force);
      render();
      timer = setTimeout(refresh, REFRESH_MS);
    } catch (err) {
      if (!data) bind('wxLoc', 'WEATHER OFFLINE');
      onError?.(`Weather: ${err.message}`);
      timer = setTimeout(refresh, RETRY_MS);
    }
  }

  theme.onHueStep(() => data && render());

  return { refresh };
}
