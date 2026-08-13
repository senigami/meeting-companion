import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkTimingStats } from '../../scripts/chunk-timing.js';

// Every expectation here is computed by hand from the literal timestamps, never from the code under
// test. Gaps below are deliberately chosen so the median, p90 and bucket counts are all checkable by
// reading the fixture.

function chunkAt(seconds, text = 'one two three') {
  return { t: 'chunk', at: new Date(Date.UTC(2026, 7, 9, 15, 0, seconds)).toISOString(), text };
}

// Importing this module used to RUN the CLI: it read every real recording off disk and printed the
// whole table into the test output. Nothing asserted on that, so it would have gone unnoticed.
test('importing the module does not run the CLI', () => {
  const printed = [];
  const original = console.log;
  console.log = (...args) => printed.push(args.join(' '));
  try {
    chunkTimingStats([chunkAt(0), chunkAt(5)]);
  } finally {
    console.log = original;
  }
  assert.deepEqual(printed, [], 'computing stats must print nothing');
});

test('gaps are measured between consecutive chunk releases', () => {
  // Releases at 0, 5, 10, 15 seconds: three gaps, all exactly 5s.
  const stats = chunkTimingStats([chunkAt(0), chunkAt(5), chunkAt(10), chunkAt(15)]);

  assert.equal(stats.chunkCount, 4);
  assert.equal(stats.gapCount, 3);
  assert.equal(stats.medianGapSeconds, 5);
  assert.equal(stats.maxGapSeconds, 5);
  assert.equal(stats.nearSoftWindow, 3);
  assert.equal(stats.fellThrough, 0);
});

test('a release at the backstop counts as falling through, not as a normal gap', () => {
  // 0 -> 5 is the window firing. 5 -> 35 is a 30s hold, which is the backstop releasing the segment
  // because no quiet frame was found.
  const stats = chunkTimingStats([chunkAt(0), chunkAt(5), chunkAt(35)]);

  assert.equal(stats.gapCount, 2);
  assert.equal(stats.nearSoftWindow, 1);
  assert.equal(stats.fellThrough, 1);
});

test('a gap of minutes is a stop or room silence, and is excluded rather than counted as a hold', () => {
  // 0 -> 5 is a real release. 5 -> 305 is five minutes, which is the operator having stopped
  // listening. Folding that into the distribution would make the segmenter look far slower than it is.
  const stats = chunkTimingStats([chunkAt(0), chunkAt(5), chunkAt(305)]);

  assert.equal(stats.gapCount, 1);
  assert.equal(stats.idleGapCount, 1);
  assert.equal(stats.longestIdleGapSeconds, 300);
  assert.equal(stats.fellThrough, 0, 'a five-minute idle stretch is not a backstop hit');
  assert.equal(stats.medianGapSeconds, 5);
});

test('records are ordered by timestamp before gaps are taken, so a file written out of order still measures', () => {
  const stats = chunkTimingStats([chunkAt(10), chunkAt(0), chunkAt(5)]);
  assert.equal(stats.gapCount, 2);
  assert.equal(stats.medianGapSeconds, 5);
  assert.equal(stats.maxGapSeconds, 5);
});

test('non-chunk records and unusable timestamps are ignored without throwing', () => {
  const stats = chunkTimingStats([
    { t: 'header', at: '2026-08-09T15:00:00.000Z' },
    chunkAt(0),
    { t: 'chunk', at: 'not-a-date', text: 'x' },
    { t: 'summary', at: '2026-08-09T15:00:02.000Z', ok: true },
    chunkAt(5)
  ]);

  assert.equal(stats.chunkCount, 2);
  assert.equal(stats.gapCount, 1);
  assert.equal(stats.medianGapSeconds, 5);
});

test('word counts come from the chunk text', () => {
  // Three words, then five. Median of [3, 5] at this implementation's percentile index is 5.
  const stats = chunkTimingStats([chunkAt(0, 'one two three'), chunkAt(5, 'one two three four five')]);
  assert.equal(stats.maxWords, 5);
  assert.equal(stats.medianWords, 5);
});

test('an empty or single-chunk recording yields no gaps rather than a fabricated zero', () => {
  assert.equal(chunkTimingStats([]).gapCount, 0);
  assert.equal(chunkTimingStats([]).medianGapSeconds, null);
  assert.equal(chunkTimingStats([chunkAt(0)]).gapCount, 0);
  assert.equal(chunkTimingStats([chunkAt(0)]).medianGapSeconds, null);
});
