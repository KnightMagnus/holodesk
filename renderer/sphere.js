// EHREN reactive core: a holographic particle sphere wrapped in HUD rings.
// It reacts to `level` (0..1 audio amplitude) and `spectrum` (frequency bins).
class EhrenSphere {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width; this.H = canvas.height;
    this.cx = this.W / 2; this.cy = this.H / 2 - 28;
    this.R = 170;
    this.level = 0; this.state = 'idle'; this.hue = 198; this.spectrum = null;
    this.t = 0; this.rotY = 0; this.rotX = 0.35;
    // Fibonacci-distributed points
    const N = 1700, pts = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
      pts.push([Math.cos(th) * r, y, Math.sin(th) * r, Math.random()]);
    }
    this.pts = pts;
    this.bars = new Float32Array(120);
  }

  draw(dt) {
    const { ctx, W, H, cx, cy } = this;
    const lv = this.level, st = this.state, h = this.hue;
    this.t += dt;
    const t = this.t;
    const spin = st === 'thinking' ? 1.6 : st === 'speaking' ? 0.55 + lv * 0.8 : st === 'listening' ? 0.45 : 0.18;
    this.rotY += dt * spin;
    this.rotX = 0.35 + Math.sin(t * 0.3) * 0.15;
    const R = this.R * (1 + lv * 0.10 + Math.sin(t * 1.4) * 0.012);

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // inner glow
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
    g.addColorStop(0, `hsla(${h},100%,70%,${0.20 + lv * 0.45})`);
    g.addColorStop(0.35, `hsla(${h},100%,55%,${0.10 + lv * 0.18})`);
    g.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.6, 0, Math.PI * 2); ctx.fill();

    // core nucleus
    const n = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
    n.addColorStop(0, `hsla(${h},100%,92%,${0.55 + lv * 0.45})`);
    n.addColorStop(1, `hsla(${h},100%,60%,0)`);
    ctx.fillStyle = n; ctx.beginPath(); ctx.arc(cx, cy, R * 0.45 * (1 + lv * 0.5), 0, Math.PI * 2); ctx.fill();

    // particles
    const cyR = Math.cos(this.rotY), syR = Math.sin(this.rotY), cxR = Math.cos(this.rotX), sxR = Math.sin(this.rotX);
    const amp = 0.06 + lv * 0.34 + (st === 'thinking' ? 0.08 : 0);
    const F = 900;
    for (const p of this.pts) {
      let [x, y, z, s] = p;
      const d = Math.sin(x * 4 + t * 2.1) * Math.sin(y * 4 + t * 1.7 + s) * Math.sin(z * 4 + t * 1.3);
      const rr = R * (1 + amp * d + (st === 'listening' ? Math.sin(t * 6 + y * 8) * 0.03 : 0));
      // rotate Y then X
      let X = x * cyR - z * syR, Z = x * syR + z * cyR;
      let Y = y * cxR - Z * sxR; Z = y * sxR + Z * cxR;
      X *= rr; Y *= rr; Z *= rr;
      const k = F / (F - Z);
      const px = cx + X * k, py = cy + Y * k;
      const depth = (Z / R + 1) / 2; // 0 back .. 1 front
      const a = 0.12 + depth * 0.75;
      const size = 1 + depth * 2.1 + lv * 1.2;
      ctx.fillStyle = `hsla(${h + (1 - depth) * 12},100%,${60 + depth * 25}%,${a})`;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }

    // wireframe meridians
    ctx.lineWidth = 1;
    for (let m = 0; m < 6; m++) {
      const ph = (m / 6) * Math.PI;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const x = Math.cos(a) * Math.cos(ph), y = Math.sin(a), z = Math.cos(a) * Math.sin(ph);
        let X = x * cyR - z * syR, Z = x * syR + z * cyR;
        let Y = y * cxR - Z * sxR; Z = y * sxR + Z * cxR;
        const k = F / (F - Z * R * 1.04);
        const px = cx + X * R * 1.04 * k, py = cy + Y * R * 1.04 * k;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.strokeStyle = `hsla(${h},100%,65%,${0.07 + lv * 0.12})`;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    this.drawRings(R, lv, h, t);
  }

  drawRings(R, lv, h, t) {
    const { ctx, cx, cy } = this;
    const col = (a, l = 65) => `hsla(${h},100%,${l}%,${a})`;

    // spectrum bars
    const nb = this.bars.length;
    for (let i = 0; i < nb; i++) {
      let v;
      if (this.spectrum && this.spectrum.length) {
        const idx = Math.floor(((i < nb / 2 ? i : nb - 1 - i) / (nb / 2)) * this.spectrum.length * 0.7);
        v = this.spectrum[idx] / 255;
      } else {
        v = lv * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.9 + t * 9) * Math.sin(i * 0.37 - t * 5)));
      }
      this.bars[i] += (v - this.bars[i]) * 0.35;
      const len = 4 + this.bars[i] * 70;
      const a = (i / nb) * Math.PI * 2 - Math.PI / 2;
      const r0 = R + 34;
      ctx.strokeStyle = col(0.25 + this.bars[i] * 0.75, 60 + this.bars[i] * 25);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      ctx.stroke();
    }

    // tick ring
    const r1 = R + 118;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.06);
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2, long = i % 15 === 0;
      ctx.strokeStyle = col(long ? 0.7 : 0.25);
      ctx.lineWidth = long ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * (r1 + (long ? 16 : 7)), Math.sin(a) * (r1 + (long ? 16 : 7)));
      ctx.stroke();
    }
    ctx.restore();

    // segmented arcs (counter-rotating)
    const segRing = (r, n, gapFrac, w, speed, alpha) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * speed);
      ctx.lineWidth = w; ctx.strokeStyle = col(alpha);
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / n) * (1 - gapFrac);
        ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
      }
      ctx.restore();
    };
    segRing(R + 150, 3, 0.35, 3, -0.18 - lv * 0.6, 0.55 + lv * 0.4);
    segRing(R + 162, 36, 0.5, 6, 0.1, 0.18 + lv * 0.3);
    segRing(R + 182, 2, 0.75, 1.5, 0.35, 0.6);

    // sweeping bright arc
    ctx.save(); ctx.translate(cx, cy);
    ctx.shadowColor = col(1); ctx.shadowBlur = 18;
    ctx.strokeStyle = col(0.95, 75); ctx.lineWidth = 4;
    const sw = t * (this.state === 'thinking' ? 3.2 : 0.7);
    ctx.beginPath(); ctx.arc(0, 0, R + 150, sw, sw + 0.5 + lv); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R + 92, -sw * 0.8, -sw * 0.8 + 0.3); ctx.stroke();
    ctx.restore();

    // thin dashed orbit
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-t * 0.04);
    ctx.setLineDash([2, 10]); ctx.strokeStyle = col(0.4); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, R + 92, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // crosshair brackets
    ctx.strokeStyle = col(0.5); ctx.lineWidth = 2;
    const b = R + 198, s = 26;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + dx * b, cy + dy * (b - s)); ctx.lineTo(cx + dx * b, cy + dy * b); ctx.lineTo(cx + dx * (b - s), cy + dy * b);
      ctx.stroke();
    });
    // horizontal guide lines
    ctx.strokeStyle = col(0.18); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(30, cy); ctx.lineTo(cx - R - 200, cy); ctx.moveTo(cx + R + 200, cy); ctx.lineTo(this.W - 30, cy); ctx.stroke();
  }
}
window.EhrenSphere = EhrenSphere;
