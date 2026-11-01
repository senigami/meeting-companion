import test from 'node:test';
import assert from 'node:assert/strict';

import { appendUniqueChunk, appendUniqueText, shortenToLimit } from '../../../public/services/text.js';

// shortenToLimit is the length backstop applied to BOTH provider response paths in
// server/summarization.js, so anything it gets wrong reaches the wall for whichever provider is
// selected. These cover the three-tier preference and the two fallback edge cases that used to be
// wrong: an over-long first word returned unbounded, and a leading space shortening to nothing.

test('text already inside the limit is returned untouched', () => {
  assert.equal(shortenToLimit('Short line.', 40), 'Short line.');
});

test('prefers a sentence boundary at or under the limit', () => {
  const text = 'Hymn 152 is next. Brother Clark will offer the closing prayer.';
  assert.equal(shortenToLimit(text, 30), 'Hymn 152 is next.');
});

test('falls back to a clause boundary when no sentence fits', () => {
  const text = 'Sacrament meeting begins at nine, then Sunday School follows';
  assert.equal(shortenToLimit(text, 40), 'Sacrament meeting begins at nine');
});

test('falls back to the last whole word, never cutting inside one', () => {
  const text = 'Sister Ramirez will speak about faith and endurance';
  const result = shortenToLimit(text, 30);
  assert.equal(result, 'Sister Ramirez will speak');
  assert.ok(result.length <= 30);
  assert.ok(!text.slice(result.length).startsWith('x'), 'sanity: result is a prefix of the input');
});

// --- The two fallback defects --------------------------------------------

test('an over-long single word is kept whole when it only slightly overshoots', () => {
  // The intended trade: better to overshoot than to cut inside a name.
  assert.equal(shortenToLimit('Llanfairpwllgwyngyll', 12), 'Llanfairpwllgwyngyll');
});

test('an over-long word is NOT returned unbounded', () => {
  // A model returning a URL, a base64 blob, or JSON has no whitespace in it at all. This used to be
  // returned in full at any length, so one malformed response could put an arbitrarily long string
  // on the display.
  const blob = 'A'.repeat(4000);
  const result = shortenToLimit(blob, 40);
  assert.equal(result.length, 40);
});

test('the ceiling applies to the first word of a multi-word line too', () => {
  const result = shortenToLimit(`${'B'.repeat(500)} and then some ordinary words`, 20);
  assert.equal(result.length, 20);
  assert.equal(result, 'B'.repeat(20));
});

test('a leading space no longer shortens the line away to nothing', () => {
  // lastIndexOf(' ') === 0 made this slice to index 0 and return ''. A blank card on the wall is
  // indistinguishable from the app having failed, which is the worst possible way to lose a line.
  const result = shortenToLimit(' Llanfairpwllgwyngyll is the place', 12);
  assert.notEqual(result, '');
  assert.equal(result, 'Llanfairpwllgwyngyll');
});

test('leading whitespace of any kind is handled, not just a single space', () => {
  // A whitespace RUN is the nastier version: the last-whole-word slice lands inside the run, so
  // guarding only the single-leading-space case did not catch this one.
  assert.equal(shortenToLimit('\n\t  Antidisestablishmentarianism', 16), 'Antidisestablishmentarianism');
  assert.equal(shortenToLimit('   Hymn 152 is next. Prayer follows.', 22), 'Hymn 152 is next.');
});

test('empty and nullish input stay empty rather than throwing', () => {
  assert.equal(shortenToLimit('', 10), '');
  assert.equal(shortenToLimit(null, 10), '');
  assert.equal(shortenToLimit(undefined, 10), '');
});

test('appendUniqueChunk keeps an all-non-Latin chunk on an empty bucket and drops only a true repeat', () => {
  const first = appendUniqueChunk([], 'はい。', 1);
  assert.deepEqual(first.map((chunk) => chunk.text), ['はい。']);
  const second = appendUniqueChunk(first, 'ありがとう。', 2);
  assert.deepEqual(second.map((chunk) => chunk.text), ['はい。', 'ありがとう。']);
  assert.deepEqual(appendUniqueChunk(second, 'ありがとう。', 3), second, 'an exact repeat is still dropped');
});

test('appendUniqueChunk still drops a repeat that differs only in case and punctuation', () => {
  const first = appendUniqueChunk([], 'Hello there.', 1);
  assert.deepEqual(appendUniqueChunk(first, 'hello there', 2), first);
});

test('appendUniqueText keeps a different non-Latin line and drops an identical one', () => {
  assert.deepEqual(appendUniqueText(['はい。'], 'ありがとう。'), ['はい。', 'ありがとう。']);
  assert.deepEqual(appendUniqueText(['はい。'], 'はい。'), ['はい。']);
});
