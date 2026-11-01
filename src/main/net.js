// HTTP helpers. Every outbound call goes through here so timeouts and
// error messages behave the same for weather, AI, voice and search.

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function errorMessage(body, status) {
  try {
    const j = JSON.parse(body);
    const msg = j?.error?.message ?? j?.error ?? j?.message ?? j?.reason;
    if (typeof msg === 'string' && msg) return msg;
  } catch {
    // not JSON; fall through to raw text
  }
  const text = String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? `HTTP ${status}: ${text.slice(0, 160)}` : `HTTP ${status}`;
}

/**
 * fetch with a timeout, an optional caller abort signal, and readable errors.
 * Resolves to the Response only when it is ok.
 */
export async function request(url, { timeout = 15000, signal, ...init } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let res;
  try {
    res = await fetch(url, { ...init, signal: combined });
  } catch (err) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    if (timeoutSignal.aborted) throw new HttpError(`Timed out after ${timeout / 1000}s`, 0);
    throw new HttpError(`Network error: ${err.cause?.code || err.message}`, 0);
  }
  if (!res.ok) throw new HttpError(errorMessage(await res.text().catch(() => ''), res.status), res.status);
  return res;
}

export async function getJson(url, opts) {
  const res = await request(url, opts);
  return res.json();
}

export async function postJson(url, body, { headers = {}, ...opts } = {}) {
  const res = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    ...opts
  });
  return res.json();
}
