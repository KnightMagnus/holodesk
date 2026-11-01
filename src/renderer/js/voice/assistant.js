// Assistant state machine: idle -> listening -> thinking -> speaking -> idle.
// One entry point (talk) toggles through it, so the mic button, the core and
// Ctrl+Space all behave the same way.
import { createAudio } from './audio.js';

const PLAY_COMMAND = /^(?:hey holodesk[,.]?\s*)?(?:play|youtube)\s+(.+?)(?:\s+on youtube)?[.!?]*$/i;
const SILENCE_MS = 1300;
const NO_SPEECH_MS = 7000;
const MAX_RECORD_MS = 20000;

export function parsePlayCommand(text) {
  const m = String(text).trim().match(PLAY_COMMAND);
  return m ? m[1].trim() : null;
}

export function createAssistant({ api, core, comms, media, getSettings }) {
  const audio = createAudio();
  let state = 'idle';
  let cancelListen = null;
  let synthPulse = 0;
  let synthSpeaking = false;

  core.setLevelSource((now) => {
    if (synthSpeaking) {
      // speechSynthesis exposes no audio; fake a syllable rhythm and kick on word boundaries
      synthPulse *= 0.9;
      const syllable = Math.abs(Math.sin(now / 95) * Math.sin(now / 233 + 1)) * 0.55;
      return { level: Math.min(1, 0.25 + syllable + synthPulse), spectrum: null };
    }
    return { level: audio.level(), spectrum: audio.spectrum() };
  });

  function setState(next) {
    state = next;
    core.setState(next);
    document.getElementById('mic').classList.toggle('live', next === 'listening');
    const [title, hint] = {
      idle: ['STANDBY', 'CLICK THE CORE OR PRESS CTRL + SPACE TO SPEAK'],
      listening: ['LISTENING', 'SPEAK NOW · ESC TO CANCEL'],
      thinking: ['PROCESSING', 'ROUTING THROUGH UPLINK · ESC TO CANCEL'],
      speaking: ['HOLODESK', 'TRANSMITTING · ESC TO STOP']
    }[next];
    document.getElementById('state-text').textContent = title;
    document.getElementById('state-hint').textContent = hint;
    if (next === 'idle') media.resume();
  }

  function stopSpeaking() {
    speechSynthesis.cancel();
    synthSpeaking = false;
    audio.stop();
  }

  /** Stop whatever is happening. Returns true if something was stopped. */
  function interrupt() {
    if (state === 'listening') cancelListen?.();
    else if (state === 'thinking') api.ai.cancel();
    else if (state === 'speaking') stopSpeaking();
    else return false;
    setState('idle');
    return true;
  }

  async function recordWhisper() {
    const stream = await audio.openMic();
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    const started = performance.now();
    let heard = false;
    let quietSince = started;
    let cancelled = false;

    const done = new Promise((resolve) => {
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = resolve;
    });
    const stop = () => recorder.state !== 'inactive' && recorder.stop();
    cancelListen = () => {
      cancelled = true;
      stop();
    };
    recorder.start(250);
    // Voice activity check on its own timer so it keeps working if frames are throttled.
    const vad = setInterval(() => {
      const now = performance.now();
      if (audio.level() > 0.12) {
        heard = true;
        quietSince = now;
      }
      if ((heard && now - quietSince > SILENCE_MS) || (!heard && now - started > NO_SPEECH_MS) || now - started > MAX_RECORD_MS) stop();
    }, 100);

    await done;
    clearInterval(vad);
    audio.closeMic();
    if (cancelled || !heard) return '';
    setState('thinking');
    const blob = new Blob(chunks, { type: 'audio/webm' });
    return api.voice.transcribe(new Uint8Array(await blob.arrayBuffer()), 'audio/webm');
  }

  async function recordWindows() {
    // Windows recognises speech in the main process; the mic here only drives visuals.
    audio.openMic().catch(() => {});
    cancelListen = () => api.voice.cancel();
    try {
      return await api.voice.listen();
    } finally {
      audio.closeMic();
    }
  }

  async function listen() {
    stopSpeaking();
    media.duck();
    setState('listening');
    const s = getSettings();
    try {
      let text;
      if (s.voiceEngine === 'openai' && s.linked.openai) text = await recordWhisper();
      else if (api.app.platform === 'win32') text = await recordWindows();
      else throw new Error('Voice input needs Windows or an OpenAI key (Settings > Voice engine)');
      cancelListen = null;
      if (state !== 'listening' && state !== 'thinking') return; // cancelled meanwhile
      if (!text.trim()) {
        setState('idle');
        comms.status('NO SPEECH DETECTED');
        return;
      }
      await handle(text.trim());
    } catch (err) {
      cancelListen = null;
      audio.closeMic();
      setState('idle');
      comms.status(`VOICE · ${err.message}`, true);
    }
  }

  async function speak(text) {
    const s = getSettings();
    if (!s.autoSpeak) return setState('idle');
    setState('speaking');
    if (s.voiceEngine === 'openai' && s.linked.openai) {
      try {
        const bytes = await api.voice.speak(text);
        if (state !== 'speaking') return;
        await audio.play(bytes);
        if (state === 'speaking') setState('idle');
        return;
      } catch (err) {
        comms.status(`OPENAI VOICE FAILED, USING WINDOWS VOICE · ${err.message}`, true);
      }
    }
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#>`~|]/g, ''));
    const voice = speechSynthesis.getVoices().find((v) => v.name === s.systemVoice);
    if (voice) u.voice = voice;
    u.rate = 1.03;
    u.pitch = 0.92;
    u.onboundary = () => {
      synthPulse = 0.35;
    };
    u.onend = u.onerror = () => {
      synthSpeaking = false;
      if (state === 'speaking') setState('idle');
    };
    synthSpeaking = true;
    speechSynthesis.speak(u);
  }

  async function handle(text) {
    comms.say('user', text);
    const query = parsePlayCommand(text);
    if (query) {
      const results = await media.search(query);
      if (results[0]) {
        media.play(results[0]);
        // confirm in the log only; speaking would talk over the video
        comms.say('ai', `Playing ${results[0].title}.`);
        setState('idle');
        return;
      }
    }
    if (!getSettings().provider) {
      const reply = 'My uplink is offline. Open settings and link Claude or ChatGPT.';
      comms.say('ai', reply);
      return speak(reply);
    }
    setState('thinking');
    try {
      const reply = await api.ai.send(text);
      if (state !== 'thinking') return; // cancelled
      comms.say('ai', reply);
      await speak(reply);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setState('idle');
      comms.status(`UPLINK · ${err.message}`, true);
    }
  }

  return {
    get state() {
      return state;
    },
    talk() {
      if (!interrupt()) listen();
    },
    interrupt,
    send(text) {
      interrupt();
      return handle(text);
    },
    reset() {
      interrupt();
      return api.ai.reset();
    }
  };
}
