// Builds the plain-text system context sent with every AI request.
import { bytes, reading, uptime } from '../shared/format.js';
import { wmo } from '../shared/wmo.js';

export function buildContext({ info, snap, weather, now = new Date() }) {
  const lines = [`Local time: ${now.toString()}`];
  if (info) {
    lines.push(
      `CPU: ${info.cpu.name} (${info.cpu.cores}C/${info.cpu.threads}T)`,
      `GPU: ${info.gpus.map((g) => g.model).join(', ') || 'unknown'}`,
      `RAM: ${bytes(info.mem.total)}`,
      `OS: ${info.os.distro} ${info.os.release}`,
      `Board: ${info.board.maker} ${info.board.model}`,
      `Displays: ${info.displays.map((d) => `${d.resX}x${d.resY}@${d.hz}Hz`).join(', ')}`
    );
  }
  if (snap) {
    lines.push(`CPU load ${snap.cpu.load.toFixed(0)}%, temp ${reading(snap.cpu.temp, 'C')}; RAM used ${bytes(snap.mem.used)}`);
    if (snap.gpu) lines.push(`GPU load ${reading(snap.gpu.util, '%')}, temp ${reading(snap.gpu.temp, 'C')}`);
    if (snap.drives.length) lines.push(`Drives: ${snap.drives.map((d) => `${d.mount} ${bytes(d.size - d.used)} free of ${bytes(d.size)}`).join('; ')}`);
    if (snap.procs.length) lines.push(`Top processes: ${snap.procs.map((p) => p.name).join(', ')}`);
    lines.push(`Uptime ${uptime(snap.uptime)}`);
  }
  if (weather) {
    const { loc, units, w } = weather;
    const u = units === 'imperial' ? 'F' : 'C';
    const c = w.current;
    lines.push(`Weather in ${loc.name}: ${wmo(c.weather_code)[0]}, ${Math.round(c.temperature_2m)}${u} (feels ${Math.round(c.apparent_temperature)}${u}), humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)} ${units === 'imperial' ? 'mph' : 'km/h'}`);
    const d = w.daily;
    lines.push(`Forecast: ${d.time.slice(0, 5).map((t, i) => `${t} ${wmo(d.weather_code[i])[0]} ${Math.round(d.temperature_2m_max[i])}/${Math.round(d.temperature_2m_min[i])}${u}`).join('; ')}`);
  }
  return lines.join('\n');
}
