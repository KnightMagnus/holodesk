// HSL to RGB in 0..1, for canvases and shaders that cannot read CSS variables.
export function hsl(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

export const hsla = (h, s, l, a) => `hsl(${h} ${s}% ${l}% / ${a})`;
