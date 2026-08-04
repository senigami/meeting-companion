import test from 'node:test';
import assert from 'node:assert/strict';

import {
  median,
  wordsPerMinute,
  cardWordsPerMinute,
  recommendWordsPerCard,
  recommendSummaryIntervalSeconds,
  longerCardsReadSlower,
  derivedCardWords,
  medianWpmFromProfile,
  DEFAULT_MEDIAN_WPM,
  readingBudget,
  USABLE_CARD_WORDS_FLOOR
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
  // 8 dropped from the option set (issue #44): a name plus a number can eat eight words on its own.
  assert.ok([11, 14, 17].includes(fast.words));
  assert.ok([11, 14, 17].includes(slow.words));
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

// Issue #44: words-per-card is collapsed into one derived quantity -- pace times interval -- rather
// than two dials that could disagree. This is the arithmetic the live app now reads through
// derivedCardWords instead of re-deriving.
test('derivedCardWords is exactly recommendWordsPerCard(pace, interval).words, not a second copy of the arithmetic', () => {
  assert.equal(derivedCardWords(30, 20), recommendWordsPerCard(30, 20).words);
  assert.equal(derivedCardWords(90, 20), recommendWordsPerCard(90, 20).words);
});

test('derivedCardWords moves with the interval at a fixed pace', () => {
  // Same reader, a longer window: more words fit in it. 5s and 20s both floor to the same snapped
  // option (11) now that 8 is gone, so the interval has to move further to show a difference.
  const short = derivedCardWords(30, 5);
  const long = derivedCardWords(30, 30);
  assert.ok(long > short, 'a longer interval at the same pace must derive more words per card, not fewer');
});

test('DEFAULT_MEDIAN_WPM matches the pace this app is actually built around', () => {
  // 30 wpm is the measured real-world pace (see summary-level.js) -- the default with no profile
  // applied assumes the slow case rather than the old 60-120wpm guess range's fast end.
  assert.equal(DEFAULT_MEDIAN_WPM, 30);
});

test('medianWpmFromProfile derives the same median the results page shows, from raw cards', () => {
  const profile = {
    recordedAt: '2026-08-02T00:00:00.000Z',
    fontSizePx: 84,
    cards: [
      { words: 6, ms: 12000 }, // 30 wpm
      { words: 10, ms: 20000 }, // 30 wpm
      { words: 4, ms: 4000 } // 60 wpm, the outlier
    ]
  };
  assert.equal(medianWpmFromProfile(profile), 30);
});

test('medianWpmFromProfile returns null for a missing or empty profile, never a fabricated pace', () => {
  assert.equal(medianWpmFromProfile(null), null);
  assert.equal(medianWpmFromProfile({ cards: [] }), null);
  assert.equal(medianWpmFromProfile({}), null);
});

// Measured 2026-08-04, and the reason readingBudget exists at all: at 30 wpm every interval from 2s
// to 15s produced a displayed budget of "11 words", because the raw figure was clamped up into
// summaryMaxWordsOptions and then shown as though it were the budget. Deriving the number was meant
// to stop two settings disagreeing; snapping it reintroduced the disagreement and hid it.
test('readingBudget reports the true budget, not the clamped one, when the interval is too short', () => {
  const short = readingBudget(30, 2);
  assert.ok(short.rawWords < 2, `2s at 30 wpm is about one word, got ${short.rawWords}`);
  assert.equal(short.belowFloor, true, 'and the operator must be told, not shown a snapped number');

  const tenSeconds = readingBudget(30, 10);
  assert.ok(tenSeconds.rawWords < USABLE_CARD_WORDS_FLOOR);
  assert.equal(tenSeconds.belowFloor, true);
});

test('readingBudget stops flagging once the interval genuinely fits the reader', () => {
  // 30 wpm x 20s = 10 words, which is the floor Ansel set and the app's real working point.
  const working = readingBudget(30, 20);
  assert.equal(Math.round(working.rawWords), 10);
  assert.equal(working.belowFloor, false);
  assert.equal(readingBudget(30, 40).belowFloor, false);
});

test('the prompt gets the TRUE budget, never the floor value dressed up as one', () => {
  // This test used to assert the opposite -- that a below-floor budget was clamped UP to the floor
  // before reaching the prompt. Ansel BLOCKED that on 2026-08-04: at a 2s interval the real budget is
  // one word and the prompt was being told eleven, which manufactures headroom nobody verified and
  // makes a degraded card indistinguishable from a healthy one to the only component that could have
  // compensated for it. The operator learns from belowFloor; the model learns from the number.
  const short = readingBudget(30, 2);
  assert.equal(short.belowFloor, true);
  assert.ok(short.words < USABLE_CARD_WORDS_FLOOR, `the prompt must not be told ${short.words} when the real budget is ${short.rawWords}`);

  const tenSeconds = readingBudget(30, 10);
  assert.equal(tenSeconds.words, 5, 'five seconds of reading is five words, and the prompt is told five');
});

test('a barely-there budget still produces a card, because the alternative is dropping speech', () => {
  // Ansel offered "suppress the card for that tick" as an alternative. That is #32's harm -- the
  // summarizer deciding somebody's words were not worth showing -- so the floor here is a sanity
  // bound on the prompt, never permission to drop anything.
  const tiny = readingBudget(30, 2);
  assert.ok(tiny.words >= 3, `a card must still be askable, got ${tiny.words}`);
});

test('a budget sitting exactly on the floor reads as marginal, not as healthy', () => {
  // Ansel BLOCKED treating zero margin as a clean pass: the live configuration (30 wpm at 20s) lands
  // exactly on 10, where rounding in the measured pace flips the verdict with nothing changing about
  // actual readability.
  const onTheFloor = readingBudget(30, 20);
  assert.equal(Math.round(onTheFloor.rawWords), 10);
  assert.equal(onTheFloor.belowFloor, false);
  assert.equal(onTheFloor.marginal, true, 'exactly on the floor must not report as comfortable');

  assert.equal(readingBudget(30, 30).marginal, false, 'and a real margin reports as healthy');
  assert.equal(readingBudget(30, 2).marginal, false, 'below the floor is its own state, not marginal');
});

test('a faster reader clears the floor at a short interval, so the flag tracks the reader not the clock', () => {
  assert.equal(readingBudget(120, 10).belowFloor, false);
  assert.equal(readingBudget(30, 10).belowFloor, true);
});
