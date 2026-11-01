// Comms log and footer ticker.
import { $, el, setText } from '../lib/dom.js';

const MAX_MESSAGES = 150;

export function createComms() {
  const log = $('#log');
  const ticker = $('#ticker');

  function append(node) {
    const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.append(node);
    while (log.childElementCount > MAX_MESSAGES) log.firstElementChild.remove();
    if (pinned) log.scrollTop = log.scrollHeight;
  }

  return {
    say(role, text) {
      const msg = el('div', `msg ${role}`);
      const who = el('span', 'who', `${role === 'user' ? 'YOU' : 'HOLODESK'} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      msg.append(who, document.createTextNode(text));
      append(msg);
    },
    status(text, isError = false) {
      const msg = el('div', `msg sys${isError ? ' error' : ''}`, text);
      append(msg);
      setText(ticker, text);
      ticker.classList.toggle('error', isError);
    },
    clear() {
      log.replaceChildren();
    }
  };
}
