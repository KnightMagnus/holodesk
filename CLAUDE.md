# HOLODESK

Windows-only Electron app: a fullscreen sci-fi HUD with hardware telemetry, weather, YouTube, and a voice assistant backed by the Claude or OpenAI APIs. Plain JavaScript (ES modules), no framework, no bundler.

## Commands

```
npm install
npm start           # run from source
npm test            # unit tests (node:test), fast, no Electron
npm run test:e2e    # Playwright drives the real app; ~1 min
npm run build       # dist/HOLODESK-Setup-<version>.exe; needs NSIS makensis (PATH, default install dir or $MAKENSIS)
```

Run `npm test` after any change. Run `npm run test:e2e` after changes to IPC, the window, settings or the renderer. CI (`.github/workflows/ci.yml`, windows-latest) runs both suites, builds the installer, installs it silently, and smoke-tests the installed exe. Pushing a `vX.Y.Z` tag that matches `package.json` also publishes a GitHub release with the installer.

No `package-lock.json` exists yet. Generate it with the first `npm install` and commit it.

## Layout

```
src/main/        main process (Node, ESM)
  index.js       app lifecycle, window, app:// protocol, security policy, IPC wiring
  ipc.js         handle() wrapper -> {ok,value}|{ok:false,error}; input validators
  config.js      settings.json in userData; schema-validated; keys encrypted via safeStorage
  telemetry.js   tiered polling, persistent PowerShell, pauses when hidden
  sensors.js     nvidia-smi --loop-ms stream; LibreHardwareMonitor :8085/data.json parser
  weather.js     Open-Meteo + IP/city geolocation; memory + disk cache; stale fallback
  ai.js          Anthropic/OpenAI clients, model filtering, chat history (lives in main)
  context.js     builds the live PC/weather context sent with each AI request
  voice.js       long-lived Windows speech recognizer; Whisper; OpenAI TTS
  youtube.js     keyless search by parsing ytInitialData
  adblock.js     webRequest ad/tracker blocking + Referer for youtube-nocookie embeds
  serve.js       app:// path resolution (traversal-safe)
  net.js         fetch with timeout and readable errors
src/preload/index.cjs   sandboxed bridge: window.holodesk.{system,weather,settings,ai,voice,media,app}
src/shared/      pure helpers used by main and renderer (served at app://holodesk/shared/)
src/renderer/    UI (ES modules, no build step)
  js/main.js     wiring + keyboard shortcuts
  js/ui/core/    reactive sphere: WebGL (sphere-gl.js), 2D fallback, baked ring layers, frame loop
  js/ui/theme.js reactive hue/glow; throttled CSS variable writes
  js/panels/     system, weather, media, comms, settings overlay
  js/voice/      audio graph + assistant state machine (idle/listening/thinking/speaking)
  js/dev/        browser-preview mock + demo scene; excluded from builds
resources/speech/listen.ps1   System.Speech recognizer (stdin/stdout JSON lines)
scripts/build.mjs             staging -> app.asar -> Electron zip -> brand exe -> fuses -> NSIS
scripts/lib/                  asar writer, fuse flipper, PE resource editor (icon + version info)
build/                        icon.ico, installer.nsi
test/unit, test/e2e, test/fixtures
```

## Rules that keep it fast

The app runs all day, so resource use is a feature. Do not regress these:

- **No per-frame CSS variable writes.** `theme.js` writes `--h`/`--g` at most ~12/s and only on visible change. Each write restyles the whole page.
- **Baked layers follow `theme.hueStep`, not `theme.hue`.** Voice modulates `hue`; re-baking rings or the background on every wobble is expensive.
- **Animate with `transform`/`opacity` only.** Bars use `scaleX`/`scaleY`. Spinning decorations are separate layers with `will-change: transform`.
- **No `backdrop-filter`** over the animated scene.
- **Telemetry probes must be cheap and non-overlapping.** On Windows most systeminformation calls run PowerShell/WMI. New probes go through `probe()` in `telemetry.js` with an interval sized to the metric. Never call systeminformation from a hot path.
- **Write DOM text with `setText`/`bind`.** They skip unchanged values. Reuse rows instead of rebuilding `innerHTML` every tick.

## Security model

- The renderer is sandboxed with `contextIsolation` and no Node, and is loaded from `app://holodesk` with a strict CSP.
- Every IPC handler validates its input (`check.*`).
- API keys never reach the renderer. `settings.publicView()` only exposes `linked` booleans.
- External links open only for hosts in `EXTERNAL_HOSTS`. Navigation and popups are blocked.
- Packaged builds flip Electron fuses: no RunAsNode, no NODE_OPTIONS or `--inspect`, app code only from `app.asar`. That is why `test/e2e/packaged.test.js` connects over CDP instead of Playwright's Electron driver.

## Conventions

- ES modules, 2-space indent, single quotes, semicolons.
- Factories (`createX()`) over classes. Inject I/O (spawn, fetch, si) so units are testable without Electron.
- Comments explain why, not what. No commented-out code.
- Commits follow caveman-commit: `type(scope): imperative summary`, at most 50 chars, no trailing period. Add a body only for non-obvious why, breaking changes or migrations; bullets use `-`. No AI attribution.

## Gotchas

- `systeminformation` never settles a command whose persistent PowerShell session was released mid-flight. `probe()` caps each poll with a deadline; keep it.
- WebGL uniforms shared between shader stages must match precision. Pass per-vertex flags as varyings (see `v_wire`).
- A canvas that handed out a WebGL context cannot give a 2D one. The fallback swaps in a fresh canvas.
- youtube-nocookie embeds refuse to play without a Referer. `adblock.js` sets one.
- The PE editor only rebuilds `.rsrc` when it is followed solely by `.reloc` and the exe is unsigned. If an Electron upgrade breaks that, the build fails loudly.
- Electron version lives in `package.json` devDependencies and also selects the zip `scripts/build.mjs` downloads.
