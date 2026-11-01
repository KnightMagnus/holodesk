// HUD rings around the sphere. Static ones are baked into canvases that CSS rotates;
// only the audio spectrum is redrawn per frame, and only while there is sound.
import { CX, CY, RADIUS, RING_BOX, CORE_W, CORE_H } from './geometry.js';
import { fitCanvas } from '../../lib/dom.js';

const R = RADIUS;
const TAU = Math.PI * 2;
const col = (h, a, l = 65) => `hsl(${h} 100% ${l}% / ${a})`;

function ringCanvas(layer, k) {
  const canvas = layer.querySelector('canvas');
  fitCanvas(canvas, RING_BOX, RING_BOX, k);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(canvas.width / RING_BOX, 0, 0, canvas.height / RING_BOX, canvas.width / 2, canvas.height / 2);
  ctx.clearRect(-RING_BOX, -RING_BOX, RING_BOX * 2, RING_BOX * 2);
  return ctx;
}

function segments(ctx, r, n, gap, width, color) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU;
    ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
    ctx.arc(0, 0, r, a0, a0 + (TAU / n) * (1 - gap));
  }
  ctx.stroke();
}

export function bakeRings({ ticks, segs, arcs, staticCanvas }, hue, k) {
  // tick ring + fine segmented band + dotted orbit
  let ctx = ringCanvas(ticks, k);
  const r1 = R + 118;
  for (const long of [false, true]) {
    ctx.beginPath();
    for (let i = 0; i < 180; i++) {
      if ((i % 15 === 0) !== long) continue;
      const a = (i / 180) * TAU;
      const len = long ? 16 : 7;
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * (r1 + len), Math.sin(a) * (r1 + len));
    }
    ctx.lineWidth = long ? 2 : 1;
    ctx.strokeStyle = col(hue, long ? 0.7 : 0.25);
    ctx.stroke();
  }
  segments(ctx, R + 162, 36, 0.5, 6, col(hue, 0.2));
  ctx.setLineDash([2, 10]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = col(hue, 0.4);
  ctx.beginPath();
  ctx.arc(0, 0, R + 92, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  // heavy three-part ring + thin outer pair
  ctx = ringCanvas(segs, k);
  segments(ctx, R + 150, 3, 0.35, 3, col(hue, 0.7));
  segments(ctx, R + 182, 2, 0.75, 1.5, col(hue, 0.6));

  // bright sweeping arcs
  ctx = ringCanvas(arcs, k);
  ctx.shadowColor = col(hue, 1);
  ctx.shadowBlur = 18;
  ctx.strokeStyle = col(hue, 0.95, 75);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, R + 150, 0, 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R + 92, Math.PI, Math.PI + 0.3);
  ctx.stroke();

  // non-rotating frame: corner brackets and horizon guides
  fitCanvas(staticCanvas, CORE_W, CORE_H, k);
  ctx = staticCanvas.getContext('2d');
  ctx.setTransform(staticCanvas.width / CORE_W, 0, 0, staticCanvas.height / CORE_H, 0, 0);
  ctx.clearRect(0, 0, CORE_W, CORE_H);
  ctx.strokeStyle = col(hue, 0.5);
  ctx.lineWidth = 2;
  const b = R + 198;
  const s = 26;
  ctx.beginPath();
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.moveTo(CX + dx * b, CY + dy * (b - s));
    ctx.lineTo(CX + dx * b, CY + dy * b);
    ctx.lineTo(CX + dx * (b - s), CY + dy * b);
  }
  ctx.stroke();
  ctx.strokeStyle = col(hue, 0.18);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, CY);
  ctx.lineTo(CX - R - 200, CY);
  ctx.moveTo(CX + R + 200, CY);
  ctx.lineTo(CORE_W - 30, CY);
  ctx.stroke();
}

/** Audio-reactive spectrum bars. Returns true while bars are still moving. */
export function createSpectrum(canvas) {
  const N = 120;
  const bars = new Float32Array(N);
  const ctx = canvas.getContext('2d');
  let k = 1;
  let wasDrawn = false;

  return {
    resize(scale) {
      k = fitCanvas(canvas, CORE_W, CORE_H, scale);
      wasDrawn = false;
    },
    draw({ level, spectrum, t, hue }) {
      let energy = 0;
      for (let i = 0; i < N; i++) {
        let v;
        if (spectrum) {
          const mirrored = i < N / 2 ? i : N - 1 - i;
          v = spectrum[Math.floor((mirrored / (N / 2)) * spectrum.length * 0.7)] / 255;
        } else {
          v = level * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.9 + t * 9) * Math.sin(i * 0.37 - t * 5)));
        }
        bars[i] += (v - bars[i]) * 0.35;
        energy += bars[i];
      }
      const active = energy > 0.05;
      if (!active && !wasDrawn) return false;

      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, CORE_W, CORE_H);
      if (!active) {
        wasDrawn = false;
        return false;
      }
      // four alpha buckets so the whole ring is four strokes
      const r0 = R * (1 + level * 0.1) + 34;
      ctx.lineWidth = 3;
      for (let bucket = 0; bucket < 4; bucket++) {
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const v = bars[i];
          if (Math.min(3, (v * 4) | 0) !== bucket) continue;
          const a = (i / N) * TAU - Math.PI / 2;
          const len = 4 + v * 70;
          ctx.moveTo(CX + Math.cos(a) * r0, CY + Math.sin(a) * r0);
          ctx.lineTo(CX + Math.cos(a) * (r0 + len), CY + Math.sin(a) * (r0 + len));
        }
        ctx.strokeStyle = col(hue, 0.35 + bucket * 0.2, 62 + bucket * 7);
        ctx.stroke();
      }
      wasDrawn = true;
      return true;
    }
  };
}
