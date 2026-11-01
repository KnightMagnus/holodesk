import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInitialData, parseResults, search } from '../../src/main/youtube.js';

const video = (id, title, extra = {}) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: 'Channel' }] },
    lengthText: { simpleText: '3:21' },
    shortViewCountText: { simpleText: '1M views' },
    ...extra
  }
});

const page = (data, marker = 'var ytInitialData = ') =>
  `<html><script>${marker}${JSON.stringify(data)};</script><script>other()</script></html>`;

const data = {
  contents: {
    sections: [
      { items: [video('aaaaaaaaaaa', 'First'), { adSlotRenderer: {} }, video('bbbbbbbbbbb', 'Second')] },
      { shelf: { items: [video('ccccccccccc', 'Nested'), video('aaaaaaaaaaa', 'Duplicate')] } },
      { items: [video('bad id!', 'Invalid'), video('ddddddddddd', 'Live', { lengthText: undefined })] }
    ]
  }
};

test('extracts ytInitialData from both page variants', () => {
  assert.deepEqual(extractInitialData(page({ a: 1 })), { a: 1 });
  assert.deepEqual(extractInitialData(page({ b: 2 }, 'window["ytInitialData"] = ')), { b: 2 });
});

test('returns null for pages without data or with broken JSON', () => {
  assert.equal(extractInitialData('<html>consent page</html>'), null);
  assert.equal(extractInitialData('var ytInitialData = {broken;</script>'), null);
});

test('parses videos in document order, deduped, invalid ids skipped', () => {
  const r = parseResults(data);
  assert.deepEqual(r.map((v) => v.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']);
  assert.equal(r[0].title, 'First');
  assert.equal(r[0].channel, 'Channel');
  assert.equal(r[0].duration, '3:21');
  assert.equal(r[3].duration, 'LIVE');
  assert.equal(r[0].thumb, 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg');
});

test('caps results at 24', () => {
  const many = { items: Array.from({ length: 40 }, (_, i) => video(`v${String(i).padStart(10, '0')}`, `T${i}`)) };
  assert.equal(parseResults(many).length, 24);
});

test('search surfaces a readable error when the page has no data', async () => {
  await assert.rejects(search('x', { fetchPage: async () => '<html></html>' }), /unavailable/);
  const ok = await search('x', { fetchPage: async () => page(data) });
  assert.equal(ok.length, 4);
});
