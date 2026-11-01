// Canvas 2D fallback for machines where WebGL is unavailable (blocklisted GPU, RDP).
// Particles are bucketed by depth so each bucket is one fill() with one colour.
import { CX, CY, FOCAL, RADIUS, fibonacciSphere } from './geometry.js';

const BUCKETS = 6;

export function create2dSphere(canvas, particleCount) {
  const ctx = canvas.getContext('2d');
  let pts = fibonacciSphere(particleCount);
  const rgb = (c, a) => `rgb(${(c[0] * 255) | 0} ${(c[1] * 255) | 0} ${(c[2] * 255) | 0} / ${a})`;

  return {
    kind: '2d',
    setParticles(n) {
      pts = fibonacciSphere(n);
    },
    draw(f) {
      const s = f.scale;
      const W = canvas.width;
      const H = canvas.height;
      const R = RADIUS * s * (1 + f.level * 0.1 + Math.sin(f.t * 1.4) * 0.012);
      const cx = CX * s;
      const cy = CY * s;
      const m = f.rot;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
      halo.addColorStop(0, rgb(f.hot, 0.55 + f.level * 0.45));
      halo.addColorStop(0.3, rgb(f.front, 0.2 + f.level * 0.4));
      halo.addColorStop(1, 'rgb(0 0 0 / 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(cx - R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2);

      const paths = Array.from({ length: BUCKETS }, () => new Path2D());
      for (let i = 0; i < pts.length; i += 4) {
        const x = pts[i];
        const y = pts[i + 1];
        const z = pts[i + 2];
        const d = Math.sin(x * 4 + f.t * 2.1) * Math.sin(y * 4 + f.t * 1.7 + pts[i + 3]) * Math.sin(z * 4 + f.t * 1.3);
        const r = R * (1 + f.amp * d);
        const X = (m[0] * x + m[3] * y + m[6] * z) * r;
        const Y = (m[1] * x + m[4] * y + m[7] * z) * r;
        const Z = (m[2] * x + m[5] * y + m[8] * z) * r;
        const k = FOCAL / (FOCAL - Z / s);
        const depth = Math.min(0.999, Math.max(0, (Z / R + 1) / 2));
        const size = (1 + depth * 2.1 + f.level * 1.2) * s;
        paths[(depth * BUCKETS) | 0].rect(cx + X * k - size / 2, cy + Y * k - size / 2, size, size);
      }
      paths.forEach((p, b) => {
        const depth = (b + 0.5) / BUCKETS;
        const c = f.back.map((v, j) => v + (f.front[j] - v) * depth);
        ctx.fillStyle = rgb(c, 0.12 + depth * 0.75);
        ctx.fill(p);
      });
      ctx.globalCompositeOperation = 'source-over';
    }
  };
}
