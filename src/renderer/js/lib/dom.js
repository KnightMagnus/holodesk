export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Write text only when it changed; avoids needless style/layout work. */
export function setText(el, text) {
  const t = String(text);
  if (el && el.textContent !== t) el.textContent = t;
}

const boundCache = new Map();
/** Update every [data-bind=name] element. */
export function bind(name, text) {
  let els = boundCache.get(name);
  if (!els) {
    els = $$(`[data-bind="${name}"]`);
    boundCache.set(name, els);
  }
  for (const el of els) setText(el, text);
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Size a canvas backing store for crisp output at the current stage scale. */
export function fitCanvas(canvas, cssW, cssH, scale) {
  const k = Math.min(2, Math.max(0.5, scale));
  const w = Math.round(cssW * k);
  const h = Math.round(cssH * k);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return k;
}
