// Network-level filtering for the embedded YouTube player.
// Blocks known ad/tracking endpoints and supplies the Referer that youtube-nocookie
// embeds require (without it they refuse to play inside a desktop app).

export const AD_URL_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.google-analytics.com/*',
  '*://*.googletagservices.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.2mdn.net/*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.youtube.com/api/stats/qoe*',
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/ptracking*',
  '*://*.youtube.com/get_midroll_*',
  '*://*.youtube-nocookie.com/api/stats/ads*',
  '*://*.youtube-nocookie.com/pagead/*'
];

const EMBED_HOSTS = ['*://*.youtube-nocookie.com/*', '*://*.youtube.com/*', '*://*.googlevideo.com/*'];

export function installAdblock(session) {
  session.webRequest.onBeforeRequest({ urls: AD_URL_PATTERNS }, (_details, cb) => cb({ cancel: true }));
  session.webRequest.onBeforeSendHeaders({ urls: EMBED_HOSTS }, (details, cb) => {
    details.requestHeaders.Referer = 'https://www.youtube-nocookie.com/';
    cb({ requestHeaders: details.requestHeaders });
  });
}
