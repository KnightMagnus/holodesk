// YouTube search without an API key: fetch the results page and read ytInitialData.
// Playback happens in a youtube-nocookie embed in the renderer.
import { request } from './net.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const VIDEOS_ONLY = 'EgIQAQ%3D%3D';
const MAX_RESULTS = 24;
const VIDEO_ID = /^[\w-]{11}$/;

const text = (t) => t?.simpleText ?? (t?.runs || []).map((r) => r.text).join('') ?? '';

export function extractInitialData(html) {
  const marker = html.match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*/);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  const end = html.indexOf(';</script>', start);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

export function parseResults(data) {
  const out = [];
  const seen = new Set();
  const stack = [data];
  while (stack.length && out.length < MAX_RESULTS) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const v = node.videoRenderer;
    if (v && VIDEO_ID.test(v.videoId) && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      out.push({
        id: v.videoId,
        title: text(v.title),
        channel: text(v.ownerText),
        duration: text(v.lengthText) || 'LIVE',
        views: text(v.shortViewCountText),
        thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`
      });
      continue;
    }
    // reverse push keeps document order when popping
    const kids = Array.isArray(node) ? node : Object.values(node);
    for (let i = kids.length - 1; i >= 0; i--) if (kids[i] && typeof kids[i] === 'object') stack.push(kids[i]);
  }
  return out;
}

export async function search(query, { fetchPage = defaultFetch } = {}) {
  const html = await fetchPage(query);
  const data = extractInitialData(html);
  if (!data) throw new Error('YouTube search is unavailable right now');
  return parseResults(data);
}

async function defaultFetch(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${VIDEOS_ONLY}&hl=en&gl=US`;
  const res = await request(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
    timeout: 12000
  });
  return res.text();
}
