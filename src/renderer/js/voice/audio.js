// Web Audio graph shared by the microphone and OpenAI speech playback.
// Everything is created lazily and torn down when idle so a quiet HUD holds no
// audio device open.
export function createAudio() {
  let ctx = null;
  let analyser = null;
  let freq = null;
  let wave = null;
  let micStream = null;
  let micNode = null;
  let playback = null;

  function ensure() {
    if (!ctx) {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const live = () => Boolean(micNode || playback);

  return {
    async openMic() {
      ensure();
      if (micStream) return micStream;
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micNode = ctx.createMediaStreamSource(micStream);
      micNode.connect(analyser);
      return micStream;
    },

    closeMic() {
      micNode?.disconnect();
      micStream?.getTracks().forEach((t) => t.stop());
      micNode = null;
      micStream = null;
    },

    /** RMS loudness, roughly 0..1. */
    level() {
      if (!live()) return 0;
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (let i = 0; i < wave.length; i++) {
        const v = (wave[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / wave.length) * 4.2);
    },

    spectrum() {
      if (!live()) return null;
      analyser.getByteFrequencyData(freq);
      return freq;
    },

    /** Play encoded audio (mp3) through the analyser; resolves when it ends. */
    async play(bytes) {
      ensure();
      this.stop();
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const buffer = await ctx.decodeAudioData(copy);
      return new Promise((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(analyser);
        src.connect(ctx.destination);
        src.onended = () => {
          src.disconnect();
          if (playback === src) playback = null;
          resolve();
        };
        playback = src;
        src.start();
      });
    },

    stop() {
      try {
        playback?.stop();
      } catch {
        // already stopped
      }
      playback = null;
    }
  };
}
