// Minimal writer for Electron's asar archive format (what @electron/asar produces):
//   [UInt32 4][UInt32 headerSize] [Pickle(header JSON)] [file bytes...]
// Offsets in the header are strings, relative to the end of the header.
import fs from 'node:fs';
import path from 'node:path';

function pickleString(str) {
  const body = Buffer.from(str, 'utf8');
  const padded = Math.ceil(body.length / 4) * 4;
  const buf = Buffer.alloc(8 + padded);
  buf.writeUInt32LE(4 + padded, 0); // payload size
  buf.writeUInt32LE(body.length, 4); // string length
  body.copy(buf, 8);
  return buf;
}

export function packAsar(srcDir, outFile) {
  const files = [];
  let offset = 0;

  function walk(dir) {
    const node = { files: {} };
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        node.files[entry.name] = walk(full);
      } else if (entry.isFile()) {
        const size = fs.statSync(full).size;
        node.files[entry.name] = { size, offset: String(offset) };
        files.push(full);
        offset += size;
      }
    }
    return node;
  }

  const header = pickleString(JSON.stringify(walk(srcDir)));
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(header.length, 4);

  const fd = fs.openSync(outFile, 'w');
  try {
    fs.writeSync(fd, sizePickle);
    fs.writeSync(fd, header);
    for (const f of files) fs.writeSync(fd, fs.readFileSync(f));
  } finally {
    fs.closeSync(fd);
  }
  return { files: files.length, bytes: offset };
}

/** Reads the header back; used to verify a packed archive. */
export function readAsarHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = Buffer.alloc(8);
    fs.readSync(fd, size, 0, 8, 0);
    const headerSize = size.readUInt32LE(4);
    const header = Buffer.alloc(headerSize);
    fs.readSync(fd, header, 0, headerSize, 8);
    return JSON.parse(header.toString('utf8', 8, 8 + header.readUInt32LE(4)));
  } finally {
    fs.closeSync(fd);
  }
}
