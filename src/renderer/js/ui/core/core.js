// The reactive core: owns the per-frame loop, chooses WebGL or 2D, caps the frame
// rate by state and quality, and drives the theme.
import { QUALITY, rotation } from './geometry.js';
import { createGlSphere } from './sphere-gl.js';
import { create2dSphere } from './sphere-2d.js';
import { bakeRings, createSpectrum } from './rings.js';
import { theme } from '../theme.js';
import { stage } from '../stage.js';
import { hsl } from '../../lib/color.js';
import { fitCanvas, $ } from '../../lib/dom.js';

const SPIN = { idle: 0.18, listening: 0.45, thinking: 1.6, speaking: 0.55 };

export function createCore(root, { quality = 'high', getCpuLoad = () => 0 } = {}) {
  let glCanvas = $('#core-gl', root);
  const layers = {
    ticks: $('#ring-ticks', root),
    segs: $('#ring-segs', root),
    arcs: $('#ring-arcs', root),
    staticCanvas: $('#core-static', root)
  };
  const spectrum = createSpectrum($('#core-fx', root));

  let q = QUALITY[quality] ?? QUALITY.high;
  let sphere = createGlSphere(glCanvas, q.particles);
  if (!sphere) {
    // a canvas that already handed out a WebGL context can never give a 2D one
    const fresh = glCanvas.cloneNode();
    glCanvas.replaceWith(fresh);
    glCanvas = fresh;
    sphere = create2dSphere(glCanvas, q.particles);
  }
  let state = 'idle';
  let levelSource = () => ({ level: 0, spectrum: null });
  let level = 0;
  let scale = 1;
  let rotY = 0;
  let t = 0;
  let last = performance.now();
  let lastDraw = 0;
  let segOpacity = -1;

  function resize() {
    scale = fitCanvas(glCanvas, 1096, 820, stage.pixelScale);
    spectrum.resize(stage.pixelScale);
    bakeRings(layers, theme.hueStep, stage.pixelScale);
  }
  resize();
  stage.onResize(resize);
  theme.onHueStep(() => bakeRings(layers, theme.hueStep, stage.pixelScale));

  function frame(now) {
    requestAnimationFrame(frame);
    const active = state !== 'idle' || level > 0.02;
    const fps = active ? q.fpsActive : q.fpsIdle;
    if (now - lastDraw < 1000 / fps - 2) return;
    lastDraw = now;

    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;

    const src = levelSource(now);
    let target = src.level;
    if (state === 'thinking') target = 0.18 + Math.sin(now / 180) * 0.08;
    level += (target - level) * (target > level ? 0.45 : 0.12);

    theme.update(now, { state, level, cpuLoad: getCpuLoad() });
    const hue = theme.hue;

    rotY += dt * (SPIN[state] + (state === 'speaking' ? level * 0.8 : 0));
    const rotX = 0.35 + Math.sin(t * 0.3) * 0.15;
    sphere.draw({
      t,
      rot: rotation(rotY, rotX),
      level,
      amp: 0.06 + level * 0.34 + (state === 'thinking' ? 0.08 : 0),
      listening: state === 'listening',
      scale,
      back: hsl(hue + 12, 100, 60),
      front: hsl(hue, 100, 82),
      hot: hsl(hue, 100, 92)
    });
    spectrum.draw({ level, spectrum: src.spectrum, t, hue });

    // ring layer brightness follows the voice; opacity is a compositor-only change
    const op = Math.round((0.6 + level * 0.4) * 20) / 20;
    if (op !== segOpacity) {
      segOpacity = op;
      layers.segs.style.opacity = op;
      layers.arcs.style.opacity = op;
    }
  }
  requestAnimationFrame(frame);

  return {
    renderer: sphere.kind,
    get level() {
      return level;
    },
    setState(s) {
      state = s;
      root.dataset.state = s;
    },
    setQuality(name) {
      q = QUALITY[name] ?? QUALITY.high;
      sphere.setParticles(q.particles);
    },
    /** fn(now) -> { level: 0..1, spectrum: Uint8Array | null } */
    setLevelSource(fn) {
      levelSource = fn;
    }
  };
}
