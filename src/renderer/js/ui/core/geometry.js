// Shared layout of the core: canvas size, sphere centre and radius in stage pixels.
export const CORE_W = 1096;
export const CORE_H = 820;
export const CX = 548;
export const CY = 382;
export const RADIUS = 170;
export const RING_BOX = 760; // square box for rotating ring layers, centred on (CX, CY)
export const FOCAL = 900;

export const QUALITY = {
  high: { particles: 1600, fpsActive: 60, fpsIdle: 30 },
  balanced: { particles: 1000, fpsActive: 45, fpsIdle: 24 },
  low: { particles: 600, fpsActive: 30, fpsIdle: 15 }
};

/** Fibonacci sphere: evenly spread unit vectors plus a per-point random seed. */
export function fibonacciSphere(n) {
  const pts = new Float32Array(n * 4);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    pts.set([Math.cos(a) * r, y, Math.sin(a) * r, Math.random() * 6.28], i * 4);
  }
  return pts;
}

/** Rotation about Y then X, as a column-major mat3 for WebGL. */
export function rotation(rotY, rotX) {
  const cy = Math.cos(rotY);
  const sy = Math.sin(rotY);
  const cx = Math.cos(rotX);
  const sx = Math.sin(rotX);
  // R = Rx * Ry, columns listed in order
  return new Float32Array([
    cy, -sx * sy, cx * sy,
    0, cx, sx,
    -sy, -sx * cy, cx * cy
  ]);
}
