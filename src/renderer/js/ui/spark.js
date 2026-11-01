// Small line charts drawn on canvas. Called only when their data changes.
import { theme } from './theme.js';

/**
 * @param series [{ data: number[] }] first series is filled, the rest are lines
 * @param opts { max, slots, labels: [[index, text]] }
 */
export function drawSpark(canvas, series, { max, slots, labels } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const h = theme.hueStep;
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = `hsl(${h} 100% 60% / .1)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    ctx.moveTo(0, (H * i) / 4);
    ctx.lineTo(W, (H * i) / 4);
  }
  for (let i = 1; i < 12; i++) {
    ctx.moveTo((W * i) / 12, 0);
    ctx.lineTo((W * i) / 12, H);
  }
  ctx.stroke();

  const top = max || Math.max(1, ...series.flatMap((s) => s.data));
  series.forEach(({ data }, si) => {
    if (data.length < 2) return;
    const n = slots || data.length;
    const step = W / (n - 1);
    const offset = n - data.length;
    const y = (v) => H - 4 - (Math.max(0, v) / top) * (H - 10);
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo((offset + i) * step, y(v)) : ctx.moveTo((offset + i) * step, y(v))));
    ctx.strokeStyle = si ? `hsl(${h} 100% 82% / .75)` : `hsl(${h} 100% 62%)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (si === 0) {
      ctx.lineTo(W, H);
      ctx.lineTo(offset * step, H);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, 0, 0, H);
      fill.addColorStop(0, `hsl(${h} 100% 60% / .3)`);
      fill.addColorStop(1, `hsl(${h} 100% 60% / 0)`);
      ctx.fillStyle = fill;
      ctx.fill();
    }
  });

  if (labels) {
    ctx.font = '14px "Share Tech Mono", monospace';
    ctx.fillStyle = `hsl(${h} 60% 80% / .6)`;
    for (const [i, text] of labels) ctx.fillText(text, (i / ((slots || 2) - 1)) * W + 3, 14);
  }
}

/** Fixed-length rolling history. */
export function history(size) {
  const data = [];
  return {
    data,
    push(v) {
      if (!data.length) for (let i = 0; i < size - 1; i++) data.push(v);
      data.push(v);
      if (data.length > size) data.splice(0, data.length - size);
    }
  };
}
