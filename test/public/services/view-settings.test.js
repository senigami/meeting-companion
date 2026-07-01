import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds,
  summaryIntervalOptions,
  summaryIntervalSecondsFromSliderIndex,
  summaryIntervalSliderIndexFromSeconds
} from '../../../public/services/view-settings.js';

test('view settings clamp to safe display ranges', () => {
  assert.equal(clampFontSize(12), 24);
  assert.equal(clampFontSize(200), 144);
  assert.equal(clampDisplayMargin(-3), 0);
  assert.equal(clampDisplayMargin(99), 40);
  assert.equal(clampSummaryIntervalSeconds(1), 2);
  assert.equal(clampSummaryIntervalSeconds(99), 15);
});

test('summary interval options stay quick to adjust', () => {
  assert.deepEqual(summaryIntervalOptions, [2, 5, 10, 15]);
});

test('summary interval slider maps to the same discrete values', () => {
  assert.equal(summaryIntervalSliderIndexFromSeconds(2), 0);
  assert.equal(summaryIntervalSliderIndexFromSeconds(5), 1);
  assert.equal(summaryIntervalSliderIndexFromSeconds(10), 2);
  assert.equal(summaryIntervalSliderIndexFromSeconds(15), 3);
  assert.equal(summaryIntervalSecondsFromSliderIndex(0), 2);
  assert.equal(summaryIntervalSecondsFromSliderIndex(1), 5);
  assert.equal(summaryIntervalSecondsFromSliderIndex(2), 10);
  assert.equal(summaryIntervalSecondsFromSliderIndex(3), 15);
});
