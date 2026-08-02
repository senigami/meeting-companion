// Pure arithmetic for the reading-pace measurement page (issue #14). Kept separate from the page
// itself so it can be unit tested without a DOM: median (not mean -- one distracted card should
// not skew the number Steve trusts), words-per-minute from a single timed card, and the
// recommended words-per-card/summary-interval derived from a measured median.
//
// summaryMaxWordsOptions/clampSummaryMaxWords/clampSummaryIntervalSeconds are the same option set
// and clamping the live app's Timing settings use (public/services/view-settings.js), so a
// recommendation this module produces is always a value the app can actually be set to.
import {
  summaryMaxWordsOptions,
  clampSummaryMaxWords,
  clampSummaryIntervalSeconds,
  SUMMARY_INTERVAL_MIN_SECONDS,
  SUMMARY_INTERVAL_MAX_SECONDS
} from './view-settings.js';

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  if (count === 0) return 0;
  const mid = Math.floor(count / 2);
  return count % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Words per minute for one card: words / (ms / 60000).
export function wordsPerMinute(words, ms) {
  if (!ms || ms <= 0) return 0;
  return (words / ms) * 60000;
}

// A card's words-per-minute, given its word count and elapsed ms -- convenience wrapper over a
// single { words, ms } record, matching the shape recorded per card during the measurement flow.
export function cardWordsPerMinute(card) {
  return wordsPerMinute(card.words, card.ms);
}

// The recommendation: how many words fit in a comfortable reading window at the measured pace,
// snapped to the app's existing word-count steps (8/11/14/17), plus the interval that gives a
// steady cadence at that word count. Both move in the direction you would expect as the median
// drops -- a slower median yields fewer words per card and a longer interval -- because both
// derive from the same wordsPerMinute input, just aimed at different existing option sets.
//
// COMFORTABLE_READING_SECONDS is how long a reader should be able to spend on a card before the
// next one is due, chosen to sit inside the app's own summary-interval range (2s-30s) rather than
// invent a new constant; the shown arithmetic is `words = medianWpm / 60 * seconds`, so Steve can
// re-derive the answer from the number on screen without trusting this module.
const COMFORTABLE_READING_SECONDS = 12;

export function recommendWordsPerCard(medianWpm, seconds = COMFORTABLE_READING_SECONDS) {
  const rawWords = (medianWpm / 60) * seconds;
  const words = clampSummaryMaxWords(rawWords, summaryMaxWordsOptions[0]);
  return { rawWords, words, seconds };
}

export function recommendSummaryIntervalSeconds(medianWpm, words) {
  const rawSeconds = medianWpm > 0 ? (words / medianWpm) * 60 : SUMMARY_INTERVAL_MIN_SECONDS;
  const seconds = clampSummaryIntervalSeconds(
    Math.round(rawSeconds),
    SUMMARY_INTERVAL_MIN_SECONDS
  );
  return { rawSeconds, seconds };
}

// Does reading proportionally slow down as a card gets longer? Returns the correlation direction
// as a plain label rather than a raw coefficient, since the results page shows this to Steve, not
// to another program. Compares each card's words-per-minute against its word count: a negative
// slope (more words -> lower wpm) means longer cards read proportionally slower, which is the
// signal that words-per-card should come down.
export function longerCardsReadSlower(cards) {
  const points = cards
    .map((card) => ({ words: card.words, wpm: wordsPerMinute(card.words, card.ms) }))
    .filter((point) => point.words > 0 && point.wpm > 0);

  if (points.length < 2) return { slope: 0, verdict: 'not-enough-data' };

  const meanWords = points.reduce((sum, p) => sum + p.words, 0) / points.length;
  const meanWpm = points.reduce((sum, p) => sum + p.wpm, 0) / points.length;

  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    const dWords = point.words - meanWords;
    const dWpm = point.wpm - meanWpm;
    numerator += dWords * dWpm;
    denominator += dWords * dWords;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const verdict = slope < -0.5 ? 'yes' : slope > 0.5 ? 'no' : 'unclear';
  return { slope, verdict };
}

export const READING_PACE_COMFORTABLE_SECONDS = COMFORTABLE_READING_SECONDS;
