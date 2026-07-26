import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketText,
  partitionBucket,
  removeConsumed,
  splitAtLastTerminator,
  takeSendableChunks,
  trimBucket
} from '../../../public/services/transcript-bucket.js';

const NOW = 1_000_000;

test('splitAtLastTerminator keeps the dangling tail', () => {
  assert.deepEqual(
    splitAtLastTerminator('We sang hymn 152. And then the bishop'),
    { complete: 'We sang hymn 152.', tail: 'And then the bishop' }
  );
  assert.deepEqual(splitAtLastTerminator('no punctuation here'), { complete: '', tail: 'no punctuation here' });
  assert.deepEqual(splitAtLastTerminator(''), { complete: '', tail: '' });
});

test('older finals are consumable even without punctuation', () => {
  const chunks = [
    { text: 'welcome everyone to the meeting', at: NOW - 5000 },
    { text: 'we will start with a hymn', at: NOW - 1000 }
  ];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW });
  assert.equal(consumable.length, 1);
  assert.equal(consumable[0].text, 'welcome everyone to the meeting');
  assert.equal(remainder.length, 1);
  assert.equal(remainder[0].text, 'we will start with a hymn');
});

test('the newest punctuated final is fully consumable', () => {
  const chunks = [{ text: 'The closing hymn is number 152.', at: NOW - 1000 }];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW });
  assert.equal(consumable.length, 1);
  assert.equal(remainder.length, 0);
});

test('a fresh unpunctuated newest final stays in the bucket', () => {
  const chunks = [{ text: 'and then we will hear from', at: NOW - 1000 }];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW });
  assert.equal(consumable.length, 0);
  assert.equal(remainder.length, 1);
});

test('a settled unpunctuated final eventually drains', () => {
  const chunks = [{ text: 'and then we will hear from the choir', at: NOW - 25000 }];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW, settleMs: 20000 });
  assert.equal(consumable.length, 1);
  assert.equal(remainder.length, 0);
});

test('only the complete leading sentences of the newest chunk are consumable', () => {
  const chunks = [{ text: 'We sang hymn 152. And then the bishop', at: NOW - 1000 }];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW });
  assert.equal(consumable[0].text, 'We sang hymn 152.');
  assert.equal(remainder[0].text, 'And then the bishop');
});

test('removeConsumed drops fully consumed chunks and keeps split tails', () => {
  const chunks = [
    { text: 'welcome everyone', at: NOW - 5000 },
    { text: 'We sang hymn 152. And then the bishop', at: NOW - 1000 }
  ];
  const consumed = [
    { text: 'welcome everyone', at: NOW - 5000 },
    { text: 'We sang hymn 152.', at: NOW - 1000 }
  ];
  const remaining = removeConsumed(chunks, consumed);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].text, 'And then the bishop');
});

test('removeConsumed leaves chunks that arrived after partition untouched', () => {
  const chunks = [
    { text: 'old line', at: NOW - 5000 },
    { text: 'brand new line', at: NOW }
  ];
  const remaining = removeConsumed(chunks, [{ text: 'old line', at: NOW - 5000 }]);
  assert.deepEqual(remaining.map((chunk) => chunk.text), ['brand new line']);
});

test('bucketText joins chunks with the interim preview and caps length from the end', () => {
  const chunks = [{ text: 'first part', at: NOW }];
  assert.equal(bucketText(chunks, 'still speaking'), 'first part still speaking');
  const long = bucketText([{ text: 'x'.repeat(50), at: NOW }], '', { maxChars: 10 });
  assert.equal(long.length, 10);
});

test('trimBucket drops the oldest whole chunks beyond the cap but never the newest', () => {
  const chunks = [
    { text: 'a'.repeat(30), at: 1 },
    { text: 'b'.repeat(30), at: 2 },
    { text: 'c'.repeat(30), at: 3 }
  ];
  const trimmed = trimBucket(chunks, { maxChars: 65 });
  assert.deepEqual(trimmed.map((chunk) => chunk.text[0]), ['b', 'c']);
  const single = trimBucket([{ text: 'z'.repeat(500), at: 1 }], { maxChars: 100 });
  assert.equal(single.length, 1);
});

test('takeSendableChunks keeps the oldest chunks that fit, leaving the rest for the next tick', () => {
  const chunks = [
    { at: NOW, text: 'A'.repeat(40) },
    { at: NOW + 1, text: 'B'.repeat(40) },
    { at: NOW + 2, text: 'C'.repeat(40) }
  ];

  const taken = takeSendableChunks(chunks, 85);

  // Oldest-first, so the display marches in the order things were said, and nothing is consumed
  // that was not also sent -- the head of a backlog used to be removed without ever being summarized.
  assert.deepEqual(taken.map((chunk) => chunk.text[0]), ['A', 'B']);
});

test('takeSendableChunks always returns at least one chunk so an over-long chunk still makes progress', () => {
  const chunks = [{ at: NOW, text: 'D'.repeat(400) }];

  assert.equal(takeSendableChunks(chunks, 100).length, 1);
  assert.deepEqual(takeSendableChunks([], 100), []);
});
