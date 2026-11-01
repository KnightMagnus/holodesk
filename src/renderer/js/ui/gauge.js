// Ring gauge. The value arc is SVG; the decorative rings are separate SVG elements so
// their rotation runs on the compositor without repainting the gauge.
import { clamp } from '/shared/format.js';
import { setText } from '../lib/dom.js';

const R = 84;
const C = 2 * Math.PI * R;
const ARC = C * 0.75;

export function createGauge(el, label) {
  el.innerHTML = `
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle class="ticks" cx="100" cy="100" r="97" stroke-width="5" stroke-dasharray="1 4.08"/>
      <g transform="rotate(135 100 100)">
        <circle class="track" cx="100" cy="100" r="${R}" stroke-width="12" stroke-dasharray="${ARC} ${C}"/>
        <circle class="val" cx="100" cy="100" r="${R}" stroke-width="12" stroke-dasharray="${ARC} ${C}" stroke-dashoffset="${ARC}"/>
      </g>
    </svg>
    <svg class="spin-layer" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="68" stroke-dasharray="2 6"/></svg>
    <svg class="spin-layer rev" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="60" stroke-dasharray="40 30 10 30"/></svg>
    <div class="num"><b>0%</b><span>${label}</span></div>`;
  const arc = el.querySelector('.val');
  const text = el.querySelector('.num b');
  let last = -1;

  return function setGauge(pct, override) {
    const p = clamp(Number.isFinite(pct) ? pct : 0, 0, 100);
    setText(text, override ?? `${Math.round(p)}%`);
    if (Math.abs(p - last) < 0.5) return;
    last = p;
    arc.setAttribute('stroke-dashoffset', (ARC * (1 - p / 100)).toFixed(1));
    el.classList.toggle('hot', p >= 90);
    el.classList.toggle('warm', p >= 75 && p < 90);
  };
}
