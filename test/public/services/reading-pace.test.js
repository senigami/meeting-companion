import test from 'node:test';
import assert from 'node:assert/strict';

import {
  median,
  wordsPerMinute,
  cardWordsPerMinute,
  recommendWordsPerCard,
  recommendSummaryIntervalSeconds,
  longerCardsReadSlower
} from '../../../public/services/reading-pace.js';

test('median handles even and odd counts', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([5]), 5);
  assert.equal(median([]), 0);
  // order of input must not matter
  assert.equal(median([10, 1, 2, 9, 5]), 5);
});

test('wordsPerMinute arithmetic', () => {
  // 10 words in 5000ms (5s) = 120 wpm
  assert.equal(wordsPerMinute(10, 5000), 120);
  // 6 words in 6000ms (6s) = 60 wpm
  assert.equal(wordsPerMinute(6, 6000), 60);
  // zero or negative elapsed time is not a valid rate
  assert.equal(wordsPerMinute(10, 0), 0);
  assert.equal(wordsPerMinute(10, -100), 0);
});

test('cardWordsPerMinute wraps a { words, ms } record', () => {
  assert.equal(cardWordsPerMinute({ words: 11, ms: 11000 }), 60);
});

test('recommendWordsPerCard moves down as the median falls, snapped to app option steps', () => {
  const fast = recommendWordsPerCard(180);
  const slow = recommendWordsPerCard(60);
  assert.ok(slow.words < fast.words, 'a slower reader should get fewer words per card');
  assert.ok([8, 11, 14, 17].includes(fast.words));
  assert.ok([8, 11, 14, 17].includes(slow.words));
  // shown arithmetic must reproduce the raw value before snapping
  assert.equal(slow.rawWords, (60 / 60) * slow.seconds);
});

test('recommendSummaryIntervalSeconds moves up as the median falls', () => {
  const fast = recommendSummaryIntervalSeconds(180, 14);
  const slow = recommendSummaryIntervalSeconds(60, 14);
  assert.ok(slow.seconds >= fast.seconds, 'a slower reader should get a longer interval');
});

test('longerCardsReadSlower detects a negative slope (longer cards read slower)', () => {
  const cards = [
    { words: 6, ms: 3000 }, // 120 wpm
    { words: 11, ms: 7333 }, // ~90 wpm
    { words: 16, ms: 16000 } // 60 wpm
  ];
  const result = longerCardsReadSlower(cards);
  assert.equal(result.verdict, 'yes');
  assert.ok(result.slope < 0);
});

test('longerCardsReadSlower reports "no" when pace holds steady or improves with length', () => {
  const cards = [
    { words: 6, ms: 3000 }, // 120 wpm
    { words: 11, ms: 5500 }, // 120 wpm
    { words: 16, ms: 8000 } // 120 wpm
  ];
  const result = longerCardsReadSlower(cards);
  assert.notEqual(result.verdict, 'yes');
});

test('longerCardsReadSlower reports not-enough-data with fewer than two usable points', () => {
  assert.equal(longerCardsReadSlower([]).verdict, 'not-enough-data');
  assert.equal(longerCardsReadSlower([{ words: 6, ms: 3000 }]).verdict, 'not-enough-data');
});
