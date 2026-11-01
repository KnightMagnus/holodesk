// The UI is authored at 3440x1440 (21:9 ultrawide) and scaled uniformly to the window.
import { createEmitter } from '../lib/emitter.js';

export const STAGE_W = 3440;
export const STAGE_H = 1440;

const events = createEmitter();
let scale = 1;

function fit() {
  const stage = document.getElementById('stage');
  scale = Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H);
  const x = (innerWidth - STAGE_W * scale) / 2;
  const y = (innerHeight - STAGE_H * scale) / 2;
  stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  events.emit('resize', { scale, pixelScale: scale * devicePixelRatio });
}

export const stage = {
  init() {
    let pending = 0;
    addEventListener('resize', () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(fit);
    });
    fit();
  },
  /** Device pixels per stage pixel; canvases size their backing store from this. */
  get pixelScale() {
    return scale * devicePixelRatio;
  },
  onResize: (fn) => events.on('resize', fn)
};
