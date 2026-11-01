// Browser-preview stand-in for window.holodesk with plausible sample data.
// Dev only: excluded from packaged builds.
const GB = 1024 ** 3;
const rnd = (a, b) => a + Math.random() * (b - a);

function sampleWeather() {
  const hours = Array.from({ length: 48 }, (_, i) => new Date(Date.now() + (i - 2) * 3600e3).toISOString().slice(0, 13) + ':00');
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 864e5).toISOString().slice(0, 10));
  return {
    loc: { name: 'Seattle', region: 'Washington', country: 'US' },
    units: 'imperial',
    w: {
      current: { temperature_2m: 54, apparent_temperature: 51, relative_humidity_2m: 78, weather_code: 2, wind_speed_10m: 9, wind_direction_10m: 200, surface_pressure: 1016, is_day: 1 },
      hourly: {
        time: hours,
        temperature_2m: hours.map((_, i) => 50 + 6 * Math.sin(((i - 6) / 24) * Math.PI * 2)),
        precipitation_probability: hours.map((_, i) => Math.max(0, 40 * Math.sin(i / 7)))
      },
      daily: {
        time: days, weather_code: [2, 61, 3, 80, 0, 1, 63],
        temperature_2m_max: [57, 55, 58, 54, 61, 60, 53], temperature_2m_min: [46, 47, 45, 44, 43, 46, 45],
        sunrise: days.map((d) => `${d}T07:52`), sunset: days.map((d) => `${d}T16:56`),
        uv_index_max: [2, 1, 2, 1, 3, 2, 1], precipitation_probability_max: [20, 80, 30, 60, 5, 10, 85]
      }
    }
  };
}

function sampleSnapshot() {
  return {
    cpu: { load: rnd(18, 38), cores: Array.from({ length: 32 }, () => rnd(3, 70)), temp: rnd(54, 61), speed: rnd(4.9, 5.4) },
    mem: { used: rnd(21, 23) * GB, total: 64 * GB, swapUsed: 1.2 * GB, swapTotal: 8 * GB },
    gpu: { util: rnd(28, 46), temp: rnd(55, 60), memUsed: rnd(6100, 6600), memTotal: 16376, clock: 2610, fan: 38, power: rnd(140, 180) },
    net: { rx: rnd(1.5e6, 6e6), tx: rnd(1e5, 6e5) },
    drives: [{ mount: 'C:', size: 2000e9, used: 1180e9 }, { mount: 'D:', size: 4000e9, used: 2650e9 }],
    procs: [
      ['Cyberpunk2077.exe', 14.2, 9.1e9], ['HOLODESK.exe', 1.1, 2.1e8], ['chrome.exe', 3.1, 1.2e9],
      ['Discord.exe', 1.4, 4.1e8], ['obs64.exe', 1.1, 3.0e8], ['Spotify.exe', 0.6, 2.2e8]
    ].map(([name, cpu, mem]) => ({ name, cpu, mem })),
    procCount: 287,
    uptime: 3 * 86400 + 4 * 3600 + 17 * 60
  };
}

export function createMockBridge() {
  const settings = {
    provider: 'anthropic', models: { anthropic: 'claude-sonnet-5-5' }, linked: { anthropic: true, openai: false },
    voiceEngine: 'system', systemVoice: '', openaiVoice: 'onyx', autoSpeak: true, units: '', city: '',
    quality: 'high', clock24: true, launchAtLogin: false
  };
  const videos = [
    ['Synthwave Mix: Night Drive Through a Neon City', 'Retro Pulse', '1:02:14', '4.1M views'],
    ['How Black Holes Bend Light', 'Cosmic Lab', '18:42', '2.3M views'],
    ['Lo-fi Beats to Code To, 3 Hour Session', 'Chill Circuit', '3:00:01', '9.8M views'],
    ['Building a Custom Water-Cooled PC', 'Rig Theory', '27:10', '880K views'],
    ['Arc Reactor LED Desk Lamp Build', 'Maker Bench', '14:55', '612K views'],
    ['Top 10 Sci-Fi Interfaces in Film', 'Frame Study', '21:33', '1.4M views']
  ].map(([title, channel, duration, views], i) => ({ id: `demo${i}xxxxx`.slice(0, 11), title, channel, duration, views, thumb: '' }));

  return {
    system: {
      info: async () => ({
        cpu: { name: 'AMD Ryzen 9 7950X3D 16-Core Processor', cores: 16, threads: 32, base: 4.2, max: 5.7, socket: 'AM5', cache: { l2: 16 * 1024 ** 2, l3: 128 * 1024 ** 2 }, virtualization: true },
        mem: { total: 64 * GB, modules: [
          { size: 32 * GB, type: 'DDR5', speed: 6000, maker: 'G.Skill', part: 'F5-6000J3038F16G', slot: 'DIMM A2' },
          { size: 32 * GB, type: 'DDR5', speed: 6000, maker: 'G.Skill', part: 'F5-6000J3038F16G', slot: 'DIMM B2' }] },
        gpus: [{ model: 'NVIDIA GeForce RTX 4080 SUPER', vendor: 'NVIDIA', vram: 16376, driver: '581.57' }],
        mainGpu: 0,
        displays: [{ model: 'Ultrawide 34" Curved', resX: 3440, resY: 1440, hz: 165, main: true }],
        disks: [
          { name: 'Samsung SSD 990 PRO 2TB', type: 'NVMe', size: 2000e9, iface: 'PCIe 4.0', temp: 41 },
          { name: 'WD_BLACK SN850X 4TB', type: 'NVMe', size: 4000e9, iface: 'PCIe 4.0', temp: 38 }],
        os: { distro: 'Microsoft Windows 11 Pro', release: '10.0.26100', build: '26100', arch: 'x64', host: 'HOLODESK-RIG' },
        board: { maker: 'ASUSTeK', model: 'ROG STRIX X670E-E GAMING WIFI' },
        bios: { vendor: 'AMI', version: '3205', date: '2026-05-14' },
        nets: [{ iface: 'Ethernet', name: 'Intel(R) Ethernet Controller I226-V', ip4: '192.168.1.42' }],
        audio: ['Realtek USB Audio']
      }),
      snapshot: async () => sampleSnapshot(),
      onTelemetry(cb) {
        const id = setInterval(() => cb(sampleSnapshot()), 1000);
        return () => clearInterval(id);
      }
    },
    weather: { get: async () => sampleWeather() },
    settings: {
      get: async () => structuredClone(settings),
      update: async (patch) => Object.assign(settings, patch),
      link: async () => ({ settings, models: [] }),
      unlink: async () => settings,
      models: async () => [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }]
    },
    ai: { send: async () => 'Preview mode. Run the desktop app to talk to me.', cancel: async () => {}, reset: async () => {} },
    voice: { listen: async () => '', cancel: async () => {}, transcribe: async () => '', speak: async () => new Uint8Array() },
    media: { search: async () => videos },
    app: { minimize: async () => {}, toggleFullscreen: async () => {}, quit: async () => {}, openExternal: async () => {}, platform: 'browser' }
  };
}
