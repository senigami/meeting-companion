import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds,
  clampSummaryMaxWords,
  SUMMARY_INTERVAL_MIN_SECONDS,
  SUMMARY_INTERVAL_MAX_SECONDS,
  summaryMaxWordsOptions,
  summaryMaxWordsFromSliderIndex,
  summaryMaxWordsSliderIndexFromWords,
  fontSizeFromSliderPosition,
  sliderPositionFromFontSize,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_SLIDER_MAX,
  clampAudioProcessingPreset,
  clampAudioHighPassHz,
  clampAudioBoolean,
  AUDIO_SETTINGS_DEFAULTS
} from '../../../public/services/view-settings.js';

test('view settings clamp to safe display ranges', () => {
  assert.equal(clampFontSize(12), 24);
  assert.equal(clampFontSize(200), 144);
  assert.equal(clampDisplayMargin(-3), 0);
  assert.equal(clampDisplayMargin(99), 40);
  assert.equal(clampSummaryIntervalSeconds(1), 2);
  assert.equal(clampSummaryIntervalSeconds(99), 30);
  assert.equal(clampSummaryMaxWords(1), 8);
  assert.equal(clampSummaryMaxWords(99), 17);
  assert.equal(clampSummaryMaxWords('garbage'), 14);
  assert.equal(clampSummaryMaxWords(undefined), 14);
});

test('summary interval spans 2s to 30s', () => {
  assert.equal(SUMMARY_INTERVAL_MIN_SECONDS, 2);
  // Raised from 15 on measured evidence: 20s is where a whole talk stops outrunning a reader at 60
  // words a minute, and 15s could not reach it. See the note in view-settings.js.
  assert.equal(SUMMARY_INTERVAL_MAX_SECONDS, 30);
  assert.equal(clampSummaryIntervalSeconds(20), 20, '20s must be reachable, which is the point of the change');
});

test('summary interval moves one second at a time, with no snapping to a coarse option set', () => {
  // The point of the change: every whole second in range is reachable. 5s and 10s used to be the
  // only comparable settings; 6s through 9s were simply unreachable.
  for (let seconds = SUMMARY_INTERVAL_MIN_SECONDS; seconds <= SUMMARY_INTERVAL_MAX_SECONDS; seconds += 1) {
    assert.equal(clampSummaryIntervalSeconds(seconds), seconds, `${seconds}s must be reachable`);
  }
});

test('summary interval clamps to the range and rounds to a whole second', () => {
  assert.equal(clampSummaryIntervalSeconds(0), 2);
  assert.equal(clampSummaryIntervalSeconds(1), 2);
  assert.equal(clampSummaryIntervalSeconds(99), 30);
  assert.equal(clampSummaryIntervalSeconds(7.4), 7);
  assert.equal(clampSummaryIntervalSeconds(7.6), 8);
  assert.equal(clampSummaryIntervalSeconds('9'), 9);
  assert.equal(clampSummaryIntervalSeconds('abc'), 5);
  assert.equal(clampSummaryIntervalSeconds(undefined), 5);
  assert.equal(clampSummaryIntervalSeconds(NaN, 11), 11);
});

test('summary max words options stay short for a slow, distance reader', () => {
  assert.deepEqual(summaryMaxWordsOptions, [8, 11, 14, 17]);
});

test('summary max words slider maps to the same discrete values', () => {
  assert.equal(summaryMaxWordsSliderIndexFromWords(8), 0);
  assert.equal(summaryMaxWordsSliderIndexFromWords(11), 1);
  assert.equal(summaryMaxWordsSliderIndexFromWords(14), 2);
  assert.equal(summaryMaxWordsSliderIndexFromWords(17), 3);
  assert.equal(summaryMaxWordsFromSliderIndex(0), 8);
  assert.equal(summaryMaxWordsFromSliderIndex(1), 11);
  assert.equal(summaryMaxWordsFromSliderIndex(2), 14);
  assert.equal(summaryMaxWordsFromSliderIndex(3), 17);

  // Garbage input on either helper falls back rather than throwing or landing off the option list.
  assert.equal(summaryMaxWordsSliderIndexFromWords('garbage'), 2);
  assert.equal(summaryMaxWordsFromSliderIndex('garbage'), 8);
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

test('audio processing preset clamps to a known preset name, defaulting to gentle', () => {
  assert.equal(clampAudioProcessingPreset('off'), 'off');
  assert.equal(clampAudioProcessingPreset('gentle'), 'gentle');
  assert.equal(clampAudioProcessingPreset('normal'), 'normal');
  assert.equal(clampAudioProcessingPreset('bogus'), 'gentle');
  assert.equal(clampAudioProcessingPreset(undefined), 'gentle');
  assert.equal(clampAudioProcessingPreset(null, 'normal'), 'normal');
});

test('audio high-pass cutoff clamps to 50-150Hz', () => {
  assert.equal(clampAudioHighPassHz(10), 50);
  assert.equal(clampAudioHighPassHz(9999), 150);
  assert.equal(clampAudioHighPassHz('80'), 80);
  assert.equal(clampAudioHighPassHz('garbage'), 80);
  assert.equal(clampAudioHighPassHz(undefined), 80);
});

test('audio boolean settings parse the literal localStorage strings, falling back when absent', () => {
  assert.equal(clampAudioBoolean('true', false), true);
  assert.equal(clampAudioBoolean('false', true), false);
  assert.equal(clampAudioBoolean(null, true), true);
  assert.equal(clampAudioBoolean(undefined, false), false);
  assert.equal(clampAudioBoolean('garbage', true), true);
});

test('audio settings defaults match the brief exactly', () => {
  assert.deepEqual(AUDIO_SETTINGS_DEFAULTS, {
    audioProcessingPreset: 'gentle',
    audioHighPassEnabled: true,
    audioHighPassHz: 80,
    audioCompressorEnabled: true,
    audioLimiterEnabled: true,
    audioBrowserAgc: true,
    audioBrowserNoiseSuppression: false,
    audioBrowserEchoCancel: false,
    audioConditioningEnabled: false,
    audioDeviceId: ''
  });
});
