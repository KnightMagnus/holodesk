# EHREN — Holographic Desktop HUD

Fullscreen sci-fi HUD for Windows, laid out natively for **3440×1440** (scales to any screen).

## Run it
1. Install **Node.js LTS** from https://nodejs.org
2. Double-click **START-EHREN.bat** (first launch installs components).

Want a single .exe? Run `npm run dist` — a portable `EHREN.exe` appears in `dist/`.

## Controls
| Key | Action |
|---|---|
| Ctrl + Space / click the sphere | Talk to EHREN |
| Click sphere while it speaks | Interrupt |
| F11 | Toggle fullscreen |
| Ctrl + Q | Quit |
| ⚙ (top right) | Uplink & settings |

## AI uplink (login)
On first launch, the Uplink screen opens. Paste an **API key** for Claude (console.anthropic.com) or ChatGPT (platform.openai.com) and press LINK. Keys are encrypted with Windows' secure storage and never leave your PC except to talk to that provider. API usage is billed by the provider (separate from a Claude Pro / ChatGPT Plus subscription — those can't be used by third-party apps).

EHREN gets your live PC stats and local weather with every message, so you can ask things like "how hot is my GPU?" or "do I need an umbrella tomorrow?".
Say or type **"play lo-fi beats"** to have it search and play a video.

## Voice
- **Windows voice (default):** free and offline. Uses Windows speech recognition + your installed Windows voices.
- **OpenAI voice:** more accurate (Whisper) and natural-sounding, and the sphere reacts to the real waveform. Needs an OpenAI key linked (works even if Claude is your active brain).

## Panels
CPU (per-thread load, clocks, temps, cache) · GPU (load, temp, VRAM, clock, fan, power) · RAM modules · drives & volumes · network throughput · motherboard / BIOS / OS · top processes · weather (Open-Meteo, auto-located, 24h curve + 6-day) · YouTube search with embedded player.

Notes: CPU temperature on Windows often needs EHREN run as administrator. Detailed GPU stats are read from NVIDIA's driver tools; AMD/Intel GPUs show what Windows exposes. The media player uses YouTube's privacy-enhanced embed and blocks known ad/tracking domains; most ads are filtered, but YouTube can still serve some.
