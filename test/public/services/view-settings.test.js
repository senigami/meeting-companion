import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds,
  summaryIntervalOptions
} from '../../../public/services/view-settings.js';

test('view settings clamp to safe display ranges', () => {
  assert.equal(clampFontSize(12), 56);
  assert.equal(clampFontSize(200), 144);
  assert.equal(clampDisplayMargin(-3), 0);
  assert.equal(clampDisplayMargin(99), 10);
  assert.equal(clampSummaryIntervalSeconds(1), 2);
  assert.equal(clampSummaryIntervalSeconds(99), 15);
});

test('summary interval options stay quick to adjust', () => {
  assert.deepEqual(summaryIntervalOptions, [2, 5, 10, 15]);
});
