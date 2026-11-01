// Windows PE resource editor, enough to brand electron.exe without rcedit/Wine:
// replaces the icon and version info so Explorer, the taskbar and Task Manager show
// HOLODESK instead of Electron.
//
// The .rsrc section is rebuilt from scratch. Electron's .rsrc is followed only by
// .reloc, whose contents describe other sections and not its own position, so .reloc
// can be moved after the new .rsrc by updating its header and data directory entry.

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const RT_VERSION = 16;
const DIR_RESOURCE = 2;
const DIR_BASERELOC = 5;
const DIR_SECURITY = 4;

const alignUp = (n, a) => Math.ceil(n / a) * a;

export function readHeaders(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x00004550) throw new Error('Not a PE file');
  const nsec = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const plus = buf.readUInt16LE(opt) === 0x20b;
  const dd = opt + (plus ? 112 : 96);
  const sections = [];
  for (let i = 0; i < nsec; i++) {
    const h = opt + optSize + i * 40;
    sections.push({
      header: h,
      name: buf.toString('latin1', h, h + 8).replace(/\0+$/, ''),
      vsize: buf.readUInt32LE(h + 8),
      va: buf.readUInt32LE(h + 12),
      rawSize: buf.readUInt32LE(h + 16),
      rawPtr: buf.readUInt32LE(h + 20)
    });
  }
  const dir = (i) => ({ rva: buf.readUInt32LE(dd + i * 8), size: buf.readUInt32LE(dd + i * 8 + 4), at: dd + i * 8 });
  return {
    opt,
    sectAlign: buf.readUInt32LE(opt + 32),
    fileAlign: buf.readUInt32LE(opt + 36),
    sizeOfImageAt: opt + 56,
    checksumAt: opt + 64,
    sections,
    dir
  };
}

// ---------------------------------------------------------------- resource tree I/O

export function readResources(buf) {
  const h = readHeaders(buf);
  const { rva } = h.dir(DIR_RESOURCE);
  const sec = h.sections.find((s) => rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize));
  if (!sec) throw new Error('No resource section');
  const base = sec.rawPtr + (rva - sec.va);
  const rvaToOff = (r) => sec.rawPtr + (r - sec.va);

  const readName = (field) => {
    if (!(field & 0x80000000)) return field;
    const at = base + (field & 0x7fffffff);
    return buf.toString('utf16le', at + 2, at + 2 + buf.readUInt16LE(at) * 2);
  };
  const readDir = (off) => {
    const named = buf.readUInt16LE(off + 12);
    const ids = buf.readUInt16LE(off + 14);
    const out = [];
    for (let i = 0; i < named + ids; i++) {
      const e = off + 16 + i * 8;
      out.push({ name: readName(buf.readUInt32LE(e)), target: buf.readUInt32LE(e + 4) });
    }
    return out;
  };

  const entries = [];
  for (const t of readDir(base)) {
    for (const n of readDir(base + (t.target & 0x7fffffff))) {
      for (const l of readDir(base + (n.target & 0x7fffffff))) {
        const de = base + l.target;
        const dataRva = buf.readUInt32LE(de);
        const size = buf.readUInt32LE(de + 4);
        const off = rvaToOff(dataRva);
        entries.push({ type: t.name, name: n.name, lang: l.name, codepage: buf.readUInt32LE(de + 8), data: Buffer.from(buf.subarray(off, off + size)) });
      }
    }
  }
  return entries;
}

function sortKeys(keys) {
  const named = keys.filter((k) => typeof k === 'string').sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()));
  const ids = keys.filter((k) => typeof k === 'number').sort((a, b) => a - b);
  return [...named, ...ids];
}

/** Serialise entries into a .rsrc section placed at virtual address `va`. */
export function buildResourceSection(entries, va) {
  // tree: type -> name -> lang -> entry
  const tree = new Map();
  for (const e of entries) {
    if (!tree.has(e.type)) tree.set(e.type, new Map());
    const names = tree.get(e.type);
    if (!names.has(e.name)) names.set(e.name, new Map());
    names.get(e.name).set(e.lang, e);
  }

  // 1) lay out directories breadth-first
  const dirs = [];
  const addDir = (map) => {
    const d = { map, keys: sortKeys([...map.keys()]), offset: 0 };
    dirs.push(d);
    return d;
  };
  const root = addDir(tree);
  const level2 = root.keys.map((k) => addDir(tree.get(k)));
  const level3 = level2.flatMap((d) => d.keys.map((k) => addDir(d.map.get(k))));
  let cursor = 0;
  for (const d of dirs) {
    d.offset = cursor;
    cursor += 16 + d.keys.length * 8;
  }

  // 2) strings for named entries
  const strings = new Map();
  for (const d of dirs) {
    for (const k of d.keys) {
      if (typeof k === 'string' && !strings.has(k)) {
        strings.set(k, cursor);
        cursor += 2 + k.length * 2;
      }
    }
  }
  cursor = alignUp(cursor, 4);

  // 3) data entries, 4) data blobs
  const leaves = level3.flatMap((d) => d.keys.map((k) => d.map.get(k)));
  const dataEntryAt = new Map();
  for (const leaf of leaves) {
    dataEntryAt.set(leaf, cursor);
    cursor += 16;
  }
  const dataAt = new Map();
  for (const leaf of leaves) {
    cursor = alignUp(cursor, 8);
    dataAt.set(leaf, cursor);
    cursor += leaf.data.length;
  }

  const out = Buffer.alloc(alignUp(cursor, 8));
  const writeDir = (d, childOffset) => {
    const named = d.keys.filter((k) => typeof k === 'string').length;
    out.writeUInt16LE(named, d.offset + 12);
    out.writeUInt16LE(d.keys.length - named, d.offset + 14);
    d.keys.forEach((k, i) => {
      const e = d.offset + 16 + i * 8;
      out.writeUInt32LE(typeof k === 'string' ? (0x80000000 | strings.get(k)) >>> 0 : k, e);
      out.writeUInt32LE(childOffset(k) >>> 0, e + 4);
    });
  };
  writeDir(root, (k) => 0x80000000 | level2[root.keys.indexOf(k)].offset);
  let l3 = 0;
  for (const d of level2) writeDir(d, () => 0x80000000 | level3[l3++].offset);
  for (const d of level3) writeDir(d, (k) => dataEntryAt.get(d.map.get(k)));
  for (const [s, at] of strings) {
    out.writeUInt16LE(s.length, at);
    out.write(s, at + 2, 'utf16le');
  }
  for (const leaf of leaves) {
    const e = dataEntryAt.get(leaf);
    out.writeUInt32LE(va + dataAt.get(leaf), e);
    out.writeUInt32LE(leaf.data.length, e + 4);
    out.writeUInt32LE(leaf.codepage || 0, e + 8);
    leaf.data.copy(out, dataAt.get(leaf));
  }
  return out;
}

/** Return a new PE buffer with the resource section replaced. */
export function replaceResources(buf, entries) {
  const h = readHeaders(buf);
  if (h.dir(DIR_SECURITY).size) throw new Error('Binary is signed; strip the signature first');
  const rsrcIndex = h.sections.findIndex((s) => s.va === h.dir(DIR_RESOURCE).rva);
  if (rsrcIndex < 0) throw new Error('Resource directory does not start a section');
  const after = h.sections.slice(rsrcIndex + 1);
  if (after.some((s) => s.name !== '.reloc')) throw new Error(`Cannot move sections after .rsrc: ${after.map((s) => s.name)}`);
  const rsrc = h.sections[rsrcIndex];
  const lastRawEnd = Math.max(...h.sections.map((s) => s.rawPtr + s.rawSize));
  if (buf.length > lastRawEnd) throw new Error('Trailing overlay data present; refusing to rewrite');

  const body = buildResourceSection(entries, rsrc.va);
  const rsrcRaw = alignUp(body.length, h.fileAlign);
  const parts = [Buffer.from(buf.subarray(0, rsrc.rawPtr)), body, Buffer.alloc(rsrcRaw - body.length)];
  const head = parts[0];

  head.writeUInt32LE(body.length, rsrc.header + 8);
  head.writeUInt32LE(rsrcRaw, rsrc.header + 16);
  head.writeUInt32LE(body.length, h.dir(DIR_RESOURCE).at + 4);

  let nextVa = alignUp(rsrc.va + body.length, h.sectAlign);
  let nextRaw = rsrc.rawPtr + rsrcRaw;
  let imageEnd = nextVa;
  const reloc = h.dir(DIR_BASERELOC);
  for (const s of after) {
    const shift = nextVa - s.va;
    head.writeUInt32LE(nextVa, s.header + 12);
    head.writeUInt32LE(nextRaw, s.header + 20);
    if (reloc.rva >= s.va && reloc.rva < s.va + s.vsize) head.writeUInt32LE(reloc.rva + shift, reloc.at);
    parts.push(buf.subarray(s.rawPtr, s.rawPtr + s.rawSize));
    imageEnd = alignUp(nextVa + s.vsize, h.sectAlign);
    nextVa = imageEnd;
    nextRaw += s.rawSize;
  }
  head.writeUInt32LE(imageEnd, h.sizeOfImageAt);

  const out = Buffer.concat(parts);
  out.writeUInt32LE(peChecksum(out, h.checksumAt), h.checksumAt);
  return out;
}

export function peChecksum(buf, checksumAt) {
  let sum = 0;
  const words = Math.floor(buf.length / 2);
  for (let i = 0; i < words; i++) {
    const at = i * 2;
    if (at === checksumAt || at === checksumAt + 2) continue;
    sum += buf.readUInt16LE(at);
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  if (buf.length % 2) sum += buf[buf.length - 1];
  sum = (sum & 0xffff) + (sum >>> 16);
  return (sum + buf.length) >>> 0;
}

// ---------------------------------------------------------------- icons

/** Split an .ico into RT_ICON images and a RT_GROUP_ICON directory. */
export function iconResources(ico, groupName, lang, firstId = 1) {
  const count = ico.readUInt16LE(4);
  const group = Buffer.alloc(6 + count * 14);
  group.writeUInt16LE(0, 0);
  group.writeUInt16LE(1, 2);
  group.writeUInt16LE(count, 4);
  const icons = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = ico.readUInt32LE(e + 8);
    const offset = ico.readUInt32LE(e + 12);
    const g = 6 + i * 14;
    ico.copy(group, g, e, e + 12); // width..bytesInRes are identical
    group.writeUInt16LE(firstId + i, g + 12);
    icons.push({ type: RT_ICON, name: firstId + i, lang, codepage: 0, data: Buffer.from(ico.subarray(offset, offset + size)) });
  }
  return [...icons, { type: RT_GROUP_ICON, name: groupName, lang, codepage: 0, data: group }];
}

// ---------------------------------------------------------------- version info

function utf16z(s) {
  return Buffer.from(`${s}\0`, 'utf16le');
}
const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);

function verNode(key, value, { text = false, children = [] } = {}) {
  let body = pad4(Buffer.concat([Buffer.alloc(6), utf16z(key)]));
  if (value) body = Buffer.concat([body, value]);
  for (const c of children) body = Buffer.concat([pad4(body), c]);
  body.writeUInt16LE(body.length, 0);
  body.writeUInt16LE(value ? (text ? value.length / 2 : value.length) : 0, 2);
  body.writeUInt16LE(text ? 1 : 0, 4);
  return body;
}

export function versionResource({ version, strings }) {
  const [a, b, c, d = 0] = version.split('.').map(Number);
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0);
  fixed.writeUInt32LE(0x00010000, 4);
  fixed.writeUInt32LE(((a << 16) | b) >>> 0, 8);
  fixed.writeUInt32LE(((c << 16) | d) >>> 0, 12);
  fixed.writeUInt32LE(((a << 16) | b) >>> 0, 16);
  fixed.writeUInt32LE(((c << 16) | d) >>> 0, 20);
  fixed.writeUInt32LE(0x3f, 24);
  fixed.writeUInt32LE(0, 28);
  fixed.writeUInt32LE(0x00040004, 32); // VOS_NT_WINDOWS32
  fixed.writeUInt32LE(1, 36); // VFT_APP
  const table = verNode('040904b0', null, {
    text: true,
    children: Object.entries(strings).map(([k, v]) => verNode(k, utf16z(v), { text: true }))
  });
  const translation = Buffer.alloc(4);
  translation.writeUInt16LE(0x0409, 0);
  translation.writeUInt16LE(0x04b0, 2);
  return verNode('VS_VERSION_INFO', fixed, {
    children: [
      verNode('StringFileInfo', null, { text: true, children: [table] }),
      verNode('VarFileInfo', null, { text: true, children: [verNode('Translation', translation)] })
    ]
  });
}

/** Read the string table back out of a VS_VERSIONINFO blob (for verification). */
export function readVersionStrings(data) {
  const text = data.toString('utf16le');
  const out = {};
  for (const key of ['CompanyName', 'FileDescription', 'FileVersion', 'InternalName', 'LegalCopyright', 'OriginalFilename', 'ProductName', 'ProductVersion']) {
    const i = text.indexOf(`${key}\0`);
    if (i < 0) continue;
    let j = i + key.length + 1;
    while (text[j] === '\0') j++;
    out[key] = text.slice(j, text.indexOf('\0', j));
  }
  return out;
}

/** Brand an Electron exe buffer: icon + version info. Returns the new buffer. */
export function brandExe(buf, { ico, version, strings }) {
  const entries = readResources(buf);
  const groups = entries.filter((e) => e.type === RT_GROUP_ICON);
  const lang = groups[0]?.lang ?? 1033;
  const groupName = groups[0]?.name ?? 1;
  const kept = entries.filter((e) => ![RT_ICON, RT_GROUP_ICON, RT_VERSION].includes(e.type));
  const versionLang = entries.find((e) => e.type === RT_VERSION)?.lang ?? 1033;
  const next = [
    ...kept,
    ...iconResources(ico, groupName, lang),
    { type: RT_VERSION, name: 1, lang: versionLang, codepage: 0, data: versionResource({ version, strings }) }
  ];
  return replaceResources(buf, next);
}

export const RT = { ICON: RT_ICON, GROUP_ICON: RT_GROUP_ICON, VERSION: RT_VERSION };
