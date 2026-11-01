// Pure helpers shared by the main process and the renderer (served at app://holodesk/shared/).
// Keep this file free of Node and DOM APIs.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function bytes(n, digits = 1) {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i >= 3 ? digits : 0)} ${UNITS[i]}`;
}

export function rate(bps) {
  if (bps == null || !Number.isFinite(bps)) return '—';
  if (bps >= 1048576) return `${(bps / 1048576).toFixed(1)} MB/s`;
  return `${Math.round(bps / 1024)} KB/s`;
}

export function uptime(sec) {
  if (!Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = String(Math.floor((sec % 86400) / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  return `${d ? `${d}d ` : ''}${h}h ${m}m`;
}

/** Number with unit, or N/A for missing / sentinel values. */
export function reading(v, unit = '', digits = 0) {
  return v == null || !Number.isFinite(v) || v < 0 ? 'N/A' : `${v.toFixed(digits)}${unit}`;
}
