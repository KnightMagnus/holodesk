// Maps app://holodesk/<path> to a file on disk. Pure so it can be tested without Electron.
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

/**
 * @param roots { '': rendererDir, shared: sharedDir } - first path segment picks a root
 * @returns absolute file path, or null if the URL escapes its root
 */
export function resolveAsset(roots, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const rel = (pathname === '/' ? '/index.html' : pathname).replace(/^\/+/, '');
  const [head, ...rest] = rel.split('/');
  const named = head !== '' && Object.hasOwn(roots, head) && rest.length > 0;
  const root = path.resolve(named ? roots[head] : roots['']);
  const file = path.resolve(root, named ? rest.join('/') : rel);
  return file.startsWith(root + path.sep) ? file : null;
}

export const mimeFor = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
