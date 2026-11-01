// Reactive theme. Hue and glow follow the assistant state, voice level and CPU load.
//
// Every write to a CSS custom property restyles the whole page, so values are smoothed
// per frame but written at most ~12 times a second and only after a visible change.
// Canvas layers that bake the hue in subscribe to coarse "hue step" changes instead.
import { createEmitter } from '../lib/emitter.js';

const HUE = { idle: 198, listening: 188, thinking: 212, speaking: 196 };
const WRITE_INTERVAL_MS = 80;
const HUE_STEP = 3;

const events = createEmitter();
let base = HUE.idle; // follows state only; baked canvas layers use this
let h = HUE.idle; // base plus voice modulation; CSS uses this
let g = 0.3;
let written = { h: null, g: null, at: 0 };
let step = Math.round(base / HUE_STEP) * HUE_STEP;
let lastStepAt = 0;

export const theme = {
  get hue() {
    return h;
  },
  /** Hue rounded to a coarse step: what baked layers should render with. */
  get hueStep() {
    return step;
  },
  get glow() {
    return g;
  },
  onHueStep: (fn) => events.on('hue-step', fn),

  update(now, { state, level, cpuLoad }) {
    base += (HUE[state] - base) * 0.06;
    h = base - (state === 'speaking' ? level * 8 : 0);
    const thinking = state === 'thinking' ? 0.15 + Math.sin(now / 200) * 0.1 : 0;
    const targetG = 0.28 + cpuLoad * 0.15 + level * 0.65 + thinking;
    g += (targetG - g) * 0.12;

    // Re-baking layers is the expensive part of a hue change, so cap it at 4/s.
    const nextStep = Math.round(base / HUE_STEP) * HUE_STEP;
    if (nextStep !== step && now - lastStepAt > 250) {
      step = nextStep;
      lastStepAt = now;
      events.emit('hue-step', step);
    }

    if (now - written.at < WRITE_INTERVAL_MS) return;
    const dh = written.h === null ? Infinity : Math.abs(h - written.h);
    const dg = written.g === null ? Infinity : Math.abs(g - written.g);
    if (dh < 0.75 && dg < 0.03) return;
    const root = document.documentElement.style;
    root.setProperty('--h', h.toFixed(1));
    root.setProperty('--g', g.toFixed(2));
    written = { h, g, at: now };
  }
};
