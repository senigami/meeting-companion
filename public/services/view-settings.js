import { MAX_WORDS_MIN, MAX_WORDS_MAX } from './summary-prompt.js';

export const FONT_SIZE_MIN = 24;
export const FONT_SIZE_MAX = 144;
// The font-size <input> itself moves on this fine-grained linear position
// scale, not raw pixels -- fontSizeFromSliderPosition/sliderPositionFromFontSize
// below map it onto pixels exponentially, so an equal drag distance is an
// equal *percentage* change in size, not an equal pixel change. A plain
// linear px slider makes the low end (24->28, a 17% jump) feel like a much
// bigger jump than the high end (140->144, a 3% jump) for the same physical
// drag distance; the fix is the mapping, not a different pixel range.
export const FONT_SIZE_SLIDER_MAX = 1000;
export const DISPLAY_MARGIN_MIN = 0;
export const DISPLAY_MARGIN_MAX = 40;
// The update interval moves one second at a time across its whole range, and the slider's value IS
// the number of seconds -- no option list, no index mapping. It used to snap to 2/5/10/15, which made
// the two settings worth comparing (5s against 10s) the only two you could reach and put everything
// between them out of range. Words-per-card below still uses a small option set on purpose: reading
// load is a perceptual judgement with a few sensible answers, where interval is a timing dial.
export const SUMMARY_INTERVAL_MIN_SECONDS = 2;
// Raised from 15 after measuring a whole talk through the pipeline (scripts/simulate-meeting.js).
// A longer interval gives the model more speech to compress, and compression improves with context:
// at 15s a 7.2 minute talk produced 7.3 minutes of reading for someone at 60 words a minute, which
// is breaking even. At 20s it produced 5.6 minutes, which is room to breathe, and still kept the
// line the whole talk was built toward. At 30s that line was gone, so the useful range ends well
// before the ceiling.
export const SUMMARY_INTERVAL_MAX_SECONDS = 30;
// 8 dropped (issue #44, Ansel): a name plus a number can eat eight words on its own, so 8 was never
// a usable setting for the reader this app is built for -- it was always going to be silently
// consumed by the label. 11 is now the floor.
export const summaryMaxWordsOptions = [11, 14, 17];
export const summaryMaxWordsSliderMax = summaryMaxWordsOptions.length - 1;
export const AUDIO_HIGH_PASS_HZ_MIN = 50;
export const AUDIO_HIGH_PASS_HZ_MAX = 150;
export const audioProcessingPresetOptions = ['off', 'gentle', 'normal'];

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function nearestOption(value, options, fallback) {
  if (!options.length) return fallback;
  return options.reduce((best, option) => {
    if (best == null) return option;
    return Math.abs(option - value) < Math.abs(best - value) ? option : best;
  }, null);
}

export function clampFontSize(value, fallback = 84) {
  return roundToStep(clampNumber(value, FONT_SIZE_MIN, FONT_SIZE_MAX, fallback), 4);
}

export function fontSizeFromSliderPosition(position, fallback = 84) {
  const ratio = clampNumber(position, 0, FONT_SIZE_SLIDER_MAX, 0) / FONT_SIZE_SLIDER_MAX;
  const raw = FONT_SIZE_MIN * (FONT_SIZE_MAX / FONT_SIZE_MIN) ** ratio;
  return clampFontSize(raw, fallback);
}

export function sliderPositionFromFontSize(size, fallback = 84) {
  const clamped = clampFontSize(size, fallback);
  const ratio = Math.log(clamped / FONT_SIZE_MIN) / Math.log(FONT_SIZE_MAX / FONT_SIZE_MIN);
  return Math.round(ratio * FONT_SIZE_SLIDER_MAX);
}

export function clampDisplayMargin(value, fallback = 4.5) {
  return roundToStep(clampNumber(value, DISPLAY_MARGIN_MIN, DISPLAY_MARGIN_MAX, fallback), 0.5);
}

export function clampSummaryIntervalSeconds(value, fallback = 5) {
  const numeric = clampNumber(value, SUMMARY_INTERVAL_MIN_SECONDS, SUMMARY_INTERVAL_MAX_SECONDS, fallback);
  return Math.round(numeric);
}

export function clampSummaryMaxWords(value, fallback = 14) {
  const numeric = clampNumber(value, summaryMaxWordsOptions[0], summaryMaxWordsOptions.at(-1), fallback);
  return nearestOption(numeric, summaryMaxWordsOptions, fallback);
}

export function summaryMaxWordsSliderIndexFromWords(value, fallback = 14) {
  const words = clampSummaryMaxWords(value, fallback);
  const index = summaryMaxWordsOptions.indexOf(words);
  return index === -1 ? 0 : index;
}

// The manual mid-meeting override (2026-08-09) needs single-digit granularity, not the three-option
// snap above -- reading load is a perceptual judgement with a few sensible AUTO-recommended answers,
// but an operator adjusting live wants every value in between reachable. Bounded to MAX_WORDS_MIN/MAX
// (summary-prompt.js), the same range the server silently clamps a summarize call to -- anything the
// slider could show outside it would be a number the app cannot actually honour.
export function clampSummaryMaxWordsOverride(value, fallback = MAX_WORDS_MIN) {
  return Math.round(clampNumber(value, MAX_WORDS_MIN, MAX_WORDS_MAX, fallback));
}

// summaryMaxWordsFromSliderIndex (slider index -> word count) was deleted with #44. Words per card
// is derived from the reading pace now, so nothing turns a slider position into a word count, and a
// tested-but-unused function of exactly that name is an invitation to wire the slider back up --
// which would restore the two-dials-that-disagree fault the issue exists to remove. The inverse
// (summaryMaxWordsSliderIndexFromWords, above) is still live: it positions the read-only slider to
// show the derived value.

export function clampAudioProcessingPreset(value, fallback = 'gentle') {
  return audioProcessingPresetOptions.includes(value) ? value : fallback;
}

export function clampAudioHighPassHz(value, fallback = 80) {
  return Math.round(clampNumber(value, AUDIO_HIGH_PASS_HZ_MIN, AUDIO_HIGH_PASS_HZ_MAX, fallback));
}

// The audio-processing booleans persist as the literal strings 'true'/'false' in localStorage,
// matching the existing summarizationSourceChosen pattern in runtime.js/start-app.js. A missing
// key (first run, or an older localStorage) falls back to the stage's documented default rather
// than reading as false.
export function clampAudioBoolean(value, fallback) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

// audioConditioningEnabled defaults to false: the conditioning graph in
// public/services/audio-processing.js has never run against real hardware, and this app's real
// end user is a Deaf adult relying on the transcript in a live, un-repeatable meeting -- an
// untested Web Audio graph between the mic and the recorder can only degrade what he cannot
// sanity-check. Defaulting to disabled restores exactly the pre-wiring capture behaviour (raw
// stream straight to the recorder) and makes the graph opt-in once someone verifies it in a real
// browser/room. The other eight values stay configured (not neutered) so switching this one flag
// is all a tested rollout needs. See .agent/janus-audio-wiring-20260729.md for the full reasoning
// and what remains an ask-first call (the browser-level AGC/noise-suppression/echo-cancel
// constraint values, which are a room-acoustics judgment, not a data-safety one).
export const AUDIO_SETTINGS_DEFAULTS = {
  audioProcessingPreset: 'gentle',
  audioHighPassEnabled: true,
  audioHighPassHz: 80,
  audioCompressorEnabled: true,
  audioLimiterEnabled: true,
  audioBrowserAgc: true,
  audioBrowserNoiseSuppression: false,
  audioBrowserEchoCancel: false,
  audioConditioningEnabled: false,
  // The chosen input device id, remembered across reloads. Empty string means "system default" --
  // see resolveDeviceId in audio-monitor.js for why a stale/unplugged id must fall back to this
  // rather than being passed straight to getUserMedia as an exact-match constraint.
  audioDeviceId: ''
};

// Single source of truth for the nine audio-settings key names, so any call site that needs to
// pluck ctx.state.audio* into a plain settings object (e.g. runtime.js's buildTranscriptionDriver)
// derives the list from here instead of hand-typing a fourth copy that can drift from this table,
// STORAGE (start-app.js), and STORAGE (runtime.js).
export const AUDIO_SETTINGS_KEYS = Object.keys(AUDIO_SETTINGS_DEFAULTS);
