// Media feed: YouTube search, results grid, and a privacy-mode embed.
// The embed is created with enablejsapi so the assistant can pause it while the
// microphone is open and resume it afterwards.
import { $, el, esc } from '../lib/dom.js';

const EMBED = 'https://www.youtube-nocookie.com/embed/';
const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

export function createMediaPanel(api, { onError }) {
  const player = $('#player');
  const results = $('#yt-results');
  let list = [];
  let current = null;
  let pausedByUs = false;
  let playing = false;

  // The embed reports its state (1 = playing) once we announce we are listening.
  addEventListener('message', (e) => {
    if (e.origin !== EMBED_ORIGIN || typeof e.data !== 'string') return;
    try {
      const state = JSON.parse(e.data)?.info?.playerState;
      if (typeof state === 'number') playing = state === 1;
    } catch {
      // not a player message
    }
  });

  function idle() {
    current = null;
    pausedByUs = false;
    playing = false;
    player.innerHTML = '<div class="player-idle"><div class="ring"></div><span>NO SIGNAL · SELECT A FEED</span></div>';
    highlight();
  }

  function highlight() {
    for (const b of results.querySelectorAll('.yt')) b.classList.toggle('active', b.dataset.id === current?.id);
  }

  function render() {
    if (!list.length) {
      results.innerHTML = '<div class="yt-empty">NO RESULTS</div>';
      return;
    }
    results.replaceChildren(...list.map((v) => {
      const b = el('button', 'yt');
      b.type = 'button';
      b.dataset.id = v.id;
      b.title = v.title;
      b.innerHTML = `<div class="th"><img src="${esc(v.thumb)}" alt="" loading="lazy" decoding="async"><span class="dur">${esc(v.duration)}</span></div>` +
        `<div><div class="ti">${esc(v.title)}</div><div class="ch">${esc(v.channel)}${v.views ? ` · ${esc(v.views)}` : ''}</div></div>`;
      return b;
    }));
    highlight();
  }

  function command(func) {
    player.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), EMBED_ORIGIN);
  }

  async function search(query) {
    results.innerHTML = '<div class="yt-empty">SCANNING…</div>';
    try {
      list = await api.media.search(query);
      render();
      return list;
    } catch (err) {
      list = [];
      results.innerHTML = `<div class="yt-empty">${esc(err.message)}</div>`;
      onError?.(`Search: ${err.message}`);
      return [];
    }
  }

  function play(video) {
    current = video;
    pausedByUs = false;
    const params = new URLSearchParams({ autoplay: '1', rel: '0', modestbranding: '1', iv_load_policy: '3', playsinline: '1', enablejsapi: '1' });
    const frame = el('iframe');
    frame.src = `${EMBED}${encodeURIComponent(video.id)}?${params}`;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.title = video.title;
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), EMBED_ORIGIN);
    });
    const close = el('button', 'player-close', '✕');
    close.type = 'button';
    close.title = 'Close video';
    close.addEventListener('click', idle);
    player.replaceChildren(frame, close);
    highlight();
  }

  $('#yt-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#yt-query').value.trim();
    if (q) search(q);
  });
  results.addEventListener('click', (e) => {
    const b = e.target.closest('.yt');
    const video = b && list.find((v) => v.id === b.dataset.id);
    if (video) play(video);
  });
  idle();

  return {
    search,
    play,
    focusSearch() {
      $('#yt-query').focus();
      $('#yt-query').select();
    },
    /** Pause for the microphone; remembers so resume() only restarts what it paused. */
    duck() {
      if (!current || !playing) return;
      command('pauseVideo');
      pausedByUs = true;
    },
    resume() {
      if (!pausedByUs) return;
      pausedByUs = false;
      command('playVideo');
    }
  };
}
