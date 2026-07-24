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
export const summaryIntervalOptions = [2, 5, 10, 15];
export const summaryIntervalSliderMax = summaryIntervalOptions.length - 1;

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
  const numeric = clampNumber(value, summaryIntervalOptions[0], summaryIntervalOptions.at(-1), fallback);
  return nearestOption(numeric, summaryIntervalOptions, fallback);
}

export function summaryIntervalSliderIndexFromSeconds(value, fallback = 5) {
  const seconds = clampSummaryIntervalSeconds(value, fallback);
  const index = summaryIntervalOptions.indexOf(seconds);
  return index === -1 ? 0 : index;
}

export function summaryIntervalSecondsFromSliderIndex(value, fallback = 5) {
  const index = Math.round(clampNumber(value, 0, summaryIntervalSliderMax, 0));
  return summaryIntervalOptions[index] ?? clampSummaryIntervalSeconds(fallback, fallback);
}
