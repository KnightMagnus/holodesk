// Electron fuses: compile-time feature switches stored in the binary after a sentinel.
// Layout: sentinel, version byte, fuse count, then one ASCII byte per fuse ('0' / '1').
// https://www.electronjs.org/docs/latest/tutorial/fuses
import fs from 'node:fs';

const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');

export const FUSE = {
  RunAsNode: 0,
  EnableCookieEncryption: 1,
  EnableNodeOptionsEnvironmentVariable: 2,
  EnableNodeCliInspectArguments: 3,
  EnableEmbeddedAsarIntegrityValidation: 4,
  OnlyLoadAppFromAsar: 5,
  LoadBrowserProcessSpecificV8Snapshot: 6,
  GrantFileProtocolExtraPrivileges: 7
};

export function readFuses(buf) {
  const at = buf.indexOf(SENTINEL);
  if (at < 0) throw new Error('Fuse sentinel not found; not an Electron binary?');
  const version = buf[at + SENTINEL.length];
  const count = buf[at + SENTINEL.length + 1];
  const start = at + SENTINEL.length + 2;
  return { version, start, values: [...buf.subarray(start, start + count)].map((b) => String.fromCharCode(b)) };
}

/** Flip fuses in place. settings: { FuseName: boolean } */
export function flipFuses(file, settings) {
  const buf = fs.readFileSync(file);
  const { version, start, values } = readFuses(buf);
  if (version !== 1) throw new Error(`Unsupported fuse wire version ${version}`);
  for (const [name, on] of Object.entries(settings)) {
    const i = FUSE[name];
    if (i === undefined || i >= values.length) throw new Error(`Fuse ${name} not present in this Electron`);
    buf[start + i] = (on ? '1' : '0').charCodeAt(0);
  }
  fs.writeFileSync(file, buf);
  return readFuses(buf).values.join('');
}
