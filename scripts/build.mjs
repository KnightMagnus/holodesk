// Package HOLODESK for Windows without electron-builder.
//
//   node scripts/build.mjs   -> dist/HOLODESK-Setup-<version>.exe and dist/win-unpacked
//
// Steps: stage app files -> app.asar -> unpack Electron -> rename, prune, brand exe,
// flip security fuses -> (win) NSIS installer.
//
// Needs: the Electron zip (downloaded from GitHub on first run, cached in .cache/),
// `tar` (built into Windows 10+) and NSIS `makensis` in $MAKENSIS, on PATH or in
// the default NSIS install folder.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packAsar, readAsarHeader } from './lib/asar.mjs';
import { flipFuses } from './lib/fuses.mjs';
import { brandExe, readResources, readVersionStrings, RT } from './lib/pe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ELECTRON_VERSION = pkg.devDependencies.electron.replace(/^[^\d]*/, '');

const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, '.cache', 'electron');
const OUT = path.join(DIST, 'win-unpacked');
const PLATFORM = 'win32-x64';

// Production fuses: no "run as node", no NODE_OPTIONS / --inspect injection, app code
// only from app.asar, and no extra privileges for file://.
const FUSES = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  OnlyLoadAppFromAsar: true,
  GrantFileProtocolExtraPrivileges: false
};

const log = (msg) => console.log(`[build] ${msg}`);
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

function copy(src, dest, filter = () => true) {
  fs.cpSync(src, dest, { recursive: true, filter: (p) => filter(path.relative(src, p)) });
}

async function electronZip() {
  const name = `electron-v${ELECTRON_VERSION}-${PLATFORM}.zip`;
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return file;
  const url = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${name}`;
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
  return file;
}

function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // tar on Windows is bsdtar and reads zip; unzip covers building from WSL or a Mac
  if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  else execFileSync('unzip', ['-q', '-o', zip, '-d', dest], { stdio: 'inherit' });
}

function stageApp(dir) {
  rm(dir);
  fs.mkdirSync(dir, { recursive: true });
  const { name, productName, version, description, license, type, main } = pkg;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, productName, version, description, license, type, main, dependencies: pkg.dependencies }, null, 2));
  // dev-only preview code stays out of the package
  copy(path.join(ROOT, 'src'), path.join(dir, 'src'), (rel) => !rel.split(path.sep).includes('dev'));
  for (const dep of Object.keys(pkg.dependencies)) {
    const from = path.join(ROOT, 'node_modules', dep);
    if (!fs.existsSync(from)) throw new Error(`Missing node_modules/${dep}; run npm install`);
    copy(from, path.join(dir, 'node_modules', dep), (rel) => !/^(test|docs|\.github)(\/|$)/.test(rel) && !rel.endsWith('.md'));
  }
}

function verifyAsar(file) {
  const header = readAsarHeader(file);
  const must = ['package.json', 'src/main/index.js', 'src/preload/index.cjs', 'src/renderer/index.html', 'node_modules/systeminformation/package.json'];
  for (const p of must) {
    let node = header;
    for (const part of p.split('/')) node = node?.files?.[part];
    if (!node) throw new Error(`app.asar is missing ${p}`);
  }
  if (header.files.src.files.renderer.files.js.files.dev) throw new Error('dev files leaked into app.asar');
}

function brandWindowsExe(exe) {
  const buf = brandExe(fs.readFileSync(exe), {
    ico: fs.readFileSync(path.join(ROOT, 'build', 'icon.ico')),
    version: `${pkg.version}.0`,
    strings: {
      CompanyName: 'HOLODESK',
      FileDescription: 'HOLODESK',
      FileVersion: pkg.version,
      InternalName: 'HOLODESK',
      LegalCopyright: 'MIT License. Built on Electron (MIT) and Chromium (BSD).',
      OriginalFilename: 'HOLODESK.exe',
      ProductName: 'HOLODESK',
      ProductVersion: pkg.version
    }
  });
  fs.writeFileSync(exe, buf);
  const res = readResources(buf);
  const strings = readVersionStrings(res.find((e) => e.type === RT.VERSION).data);
  if (strings.FileDescription !== 'HOLODESK') throw new Error('Version info did not stick');
  if (!res.some((e) => e.type === RT.GROUP_ICON)) throw new Error('Icon group missing');
}

// Chocolatey and the NSIS installer put makensis here without touching PATH.
function findMakensis() {
  if (process.env.MAKENSIS) return process.env.MAKENSIS;
  const dirs = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean);
  for (const dir of dirs) {
    const exe = path.join(dir, 'NSIS', 'makensis.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return 'makensis';
}

function makeInstaller() {
  const makensis = findMakensis();
  const out = path.join(DIST, `HOLODESK-Setup-${pkg.version}.exe`);
  const define = (k, v) => `-D${k}=${v}`;
  execFileSync(makensis, [
    '-V2',
    define('VERSION', pkg.version),
    define('SRC_DIR', OUT),
    define('OUT_FILE', out),
    define('ICON', path.join(ROOT, 'build', 'icon.ico')),
    path.join(ROOT, 'build', 'installer.nsi')
  ], { stdio: 'inherit' });
  return out;
}

async function main() {
  const t0 = Date.now();
  rm(OUT);
  fs.mkdirSync(DIST, { recursive: true });

  log('staging app');
  const stage = path.join(DIST, '.stage');
  stageApp(stage);

  log(`unpacking Electron ${ELECTRON_VERSION} (${PLATFORM})`);
  unzip(await electronZip(), OUT);
  const resources = path.join(OUT, 'resources');
  rm(path.join(resources, 'default_app.asar'));
  const asar = path.join(resources, 'app.asar');
  const packed = packAsar(stage, asar);
  verifyAsar(asar);
  log(`app.asar: ${packed.files} files, ${(packed.bytes / 1048576).toFixed(1)} MB`);
  copy(path.join(ROOT, 'resources'), resources);
  rm(stage);

  // English-only Chromium UI strings; other locales fall back to en-US
  const locales = path.join(OUT, 'locales');
  for (const f of fs.readdirSync(locales)) if (f !== 'en-US.pak') fs.rmSync(path.join(locales, f));

  const exe = path.join(OUT, 'HOLODESK.exe');
  fs.renameSync(path.join(OUT, 'electron.exe'), exe);
  log('branding HOLODESK.exe (icon, version info)');
  brandWindowsExe(exe);
  log(`fuses: ${flipFuses(exe, FUSES)}`);

  log('building installer');
  const setup = makeInstaller();
  log(`done: ${path.relative(ROOT, setup)} (${(fs.statSync(setup).size / 1048576).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error(`[build] ${err.message}`);
  process.exit(1);
});
