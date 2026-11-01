// Static perspective grid behind the stage. Redrawn only on resize or hue step.
import { theme } from './theme.js';
import { stage } from './stage.js';

function draw(canvas) {
  const dpr = devicePixelRatio;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const h = theme.hueStep;

  const glow = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.55);
  glow.addColorStop(0, `hsl(${h} 100% 30% / .22)`);
  glow.addColorStop(1, 'hsl(0 0% 0% / 0)');
  ctx.fillStyle = '#01060d';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = `hsl(${h} 100% 60% / .06)`;
  ctx.lineWidth = dpr;
  const horizon = H * 0.62;
  ctx.beginPath();
  for (let i = -30; i <= 30; i++) {
    ctx.moveTo(W / 2 + i * 40 * dpr, horizon);
    ctx.lineTo(W / 2 + i * 260 * dpr, H);
  }
  for (let j = 0; j < 14; j++) {
    const y = horizon + (j / 14) ** 2 * (H - horizon);
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
}

export function initBackground(canvas) {
  draw(canvas);
  stage.onResize(() => draw(canvas));
  theme.onHueStep(() => draw(canvas));
}
