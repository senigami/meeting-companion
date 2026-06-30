export const FONT_SIZE_MIN = 56;
export const FONT_SIZE_MAX = 144;
export const DISPLAY_MARGIN_MIN = 0;
export const DISPLAY_MARGIN_MAX = 10;
export const summaryIntervalOptions = [2, 5, 10, 15];

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

export function clampDisplayMargin(value, fallback = 4.5) {
  return roundToStep(clampNumber(value, DISPLAY_MARGIN_MIN, DISPLAY_MARGIN_MAX, fallback), 0.5);
}

export function clampSummaryIntervalSeconds(value, fallback = 5) {
  const numeric = clampNumber(value, summaryIntervalOptions[0], summaryIntervalOptions.at(-1), fallback);
  return nearestOption(numeric, summaryIntervalOptions, fallback);
}
