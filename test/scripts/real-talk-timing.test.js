import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { realTalkTimingStats } from '../../scripts/real-talk-timing.js';

const REPO_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

// Every expectation here is computed by hand from a small literal fixture, never from the code
// under test -- same discipline as test/scripts/chunk-timing.test.js.
function fixture(cues, durationSeconds) {
  return { source: 'test-fixture', durationSeconds, cues };
}

test('gaps are measured between consecutive cue START times, not cue durations', () => {
  const stats = realTalkTimingStats(fixture([
    { startSec: 0, words: 5 },
    { startSec: 6, words: 5 },
    { startSec: 12, words: 5 }
  ], 12));

  assert.equal(stats.cueCount, 3);
  assert.equal(stats.gapCount, 2);
  assert.equal(stats.medianGapSeconds, 6);
  assert.equal(stats.maxGapSeconds, 6);
  assert.equal(stats.totalWords, 15);
  assert.equal(stats.wordsPerSecond, +(15 / 12).toFixed(3));
});

test('a gap at or past each threshold is counted as AT LEAST that long, not exactly that long', () => {
  // Gaps: 2 (below redemption), 3 (at/above redemption, below soft window), 5 (at soft window), 30
  // (at backstop). Deliberately chosen so each threshold catches a different subset.
  const stats = realTalkTimingStats(fixture([
    { startSec: 0, words: 1 },
    { startSec: 2, words: 1 },
    { startSec: 5, words: 1 },
    { startSec: 10, words: 1 },
    { startSec: 40, words: 1 }
  ], 40));

  assert.equal(stats.gapCount, 4);
  assert.equal(stats.gapsAtLeastRedemptionWindow, 3, 'gaps of 3, 5 and 30 all clear 2.5s');
  assert.equal(stats.gapsAtLeastSoftWindow, 2, 'gaps of 5 and 30 clear 5s; 2 and 3 do not');
  assert.equal(stats.gapsAtLeastBackstop, 1, 'only the 30s gap clears the 30s backstop');
});

test('cues out of chronological order are sorted before gaps are computed', () => {
  const stats = realTalkTimingStats(fixture([
    { startSec: 10, words: 1 },
    { startSec: 0, words: 1 },
    { startSec: 20, words: 1 }
  ], 20));

  assert.equal(stats.gapCount, 2);
  assert.equal(stats.medianGapSeconds, 10);
});

test('the committed real-talk fixture holds timings only, never the caption text', async () => {
  const raw = await readFile(join(REPO_DIR, 'scripts/fixtures/real-talk-caption-timing-2026-08-04.json'), 'utf8');
  const fixtureData = JSON.parse(raw);

  assert.ok(Array.isArray(fixtureData.cues) && fixtureData.cues.length > 0);
  for (const cue of fixtureData.cues) {
    const keys = Object.keys(cue).sort();
    assert.deepEqual(keys, ['startSec', 'words'], 'a cue must carry only its timing and word count, never its text');
  }

  const stats = realTalkTimingStats(fixtureData);
  assert.equal(stats.cueCount, fixtureData.cues.length);
  assert.ok(stats.gapCount > 0);
});
