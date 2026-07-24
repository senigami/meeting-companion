import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds,
  summaryIntervalOptions,
  summaryIntervalSecondsFromSliderIndex,
  summaryIntervalSliderIndexFromSeconds,
  fontSizeFromSliderPosition,
  sliderPositionFromFontSize,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_SLIDER_MAX
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

test('font size slider position maps exponentially, not linearly, onto pixels', () => {
  // Endpoints land exactly on the real min/max.
  assert.equal(fontSizeFromSliderPosition(0), FONT_SIZE_MIN);
  assert.equal(fontSizeFromSliderPosition(FONT_SIZE_SLIDER_MAX), FONT_SIZE_MAX);
  assert.equal(sliderPositionFromFontSize(FONT_SIZE_MIN), 0);
  assert.equal(sliderPositionFromFontSize(FONT_SIZE_MAX), FONT_SIZE_SLIDER_MAX);

  // The midpoint of slider travel is the geometric mean, not the
  // arithmetic mean -- this is the whole point: equal drag distance is
  // equal *percentage* change, not equal pixel change.
  const midpoint = fontSizeFromSliderPosition(FONT_SIZE_SLIDER_MAX / 2);
  const geometricMean = Math.sqrt(FONT_SIZE_MIN * FONT_SIZE_MAX);
  assert.ok(Math.abs(midpoint - geometricMean) <= 4, `expected ~${geometricMean}, got ${midpoint}`);
  const arithmeticMean = (FONT_SIZE_MIN + FONT_SIZE_MAX) / 2;
  assert.notEqual(midpoint, arithmeticMean);

  // Equal-sized slider steps produce a growing pixel delta as position
  // increases (the "even feel" the mapping exists for). Compare wide
  // blocks (first third vs. last third of travel), not adjacent single
  // steps -- 4px rounding on individual samples is real quantization
  // noise, not a flaw in the underlying curve, and would make an
  // adjacent-step comparison flaky.
  const third = FONT_SIZE_SLIDER_MAX / 3;
  const firstThirdDelta = fontSizeFromSliderPosition(third) - fontSizeFromSliderPosition(0);
  const lastThirdDelta = fontSizeFromSliderPosition(FONT_SIZE_SLIDER_MAX) - fontSizeFromSliderPosition(2 * third);
  assert.ok(
    lastThirdDelta > firstThirdDelta,
    `expected the last third of travel to cover more pixels than the first (exponential curve), got ${firstThirdDelta} then ${lastThirdDelta}`
  );

  // Round-trips (within the pixel step's own rounding) for a value that
  // falls exactly on a 4px step.
  assert.equal(fontSizeFromSliderPosition(sliderPositionFromFontSize(84)), 84);
});
