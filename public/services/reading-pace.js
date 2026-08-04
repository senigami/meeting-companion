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

// Issue #44: with no reader profile applied, this is the pace the derived words-per-card budget
// assumes. Matches the pace actually measured for this app's real reader (summary-level.js,
// 2026-08-02: "about one word every two seconds -- roughly 30 wpm") rather than the 60-120 wpm range
// this app used to guess across before anyone was measured -- the whole point of #44 is to stop
// guessing once a real number exists, and a default that assumes the fast end of that old guess
// would make the unmeasured case (which is also the untested-user case) the most likely to overrun.
export const DEFAULT_MEDIAN_WPM = 30;

// The words-per-card budget is now ALWAYS derived (issue #44): one quantity (a measured or assumed
// pace) times the card interval, never two independent dials that could disagree. This wraps
// recommendWordsPerCard so callers never re-derive the arithmetic themselves -- reuse this, not a
// second copy of `wordsPerSecond * seconds`.
export function derivedCardWords(medianWpm, intervalSeconds) {
  return recommendWordsPerCard(medianWpm, intervalSeconds).words;
}

// What the reader can ACTUALLY get through in one interval, before any snapping to the settings
// range. Measured 2026-08-04, and the reason this exists: at 30 wpm every interval from 2s to 15s
// derived to "11 words" on screen, because the raw figure (1.0 words at 2s, 5.0 at 10s) was clamped
// up into summaryMaxWordsOptions and then displayed as though it were the budget. Deriving the number
// was meant to stop two settings disagreeing; snapping it reintroduced the disagreement and hid it
// behind a confident label, which is worse than the two dials were.
//
// So the prompt still gets a usable clamped number -- it cannot be asked for a 1-word card -- but the
// operator is told the truth, including when the truth is that the interval is too short for this
// reader. `belowFloor` is that signal, and it must never be presented as a word count.
//
// USABLE_CARD_WORDS_FLOOR comes from Ansel's ruling (2026-08-02): below roughly this, brief's own
// compression collapses to noise, because a name plus a number can eat eight words on its own. It is
// his call and not arithmetic, which is why it is named rather than inlined.
export const USABLE_CARD_WORDS_FLOOR = 10;

// Above the floor but without room to spare. Ansel's ruling, 2026-08-04: a boundary met with zero
// margin is brittle -- rounding in the measured pace flips the verdict with nothing changing about
// actual readability, and the live configuration (30 wpm at 20s = exactly 10) sits precisely on it.
// So "marginal" is a third state, shown as a working budget but never as a healthy one.
export const MARGINAL_CARD_WORDS_CEILING = 12;

// A card this short is barely a phrase, but it is still somebody's words and it still goes up. The
// alternative Ansel offered -- suppress the card for that tick -- is the one thing this app must not
// do: #32 is the whole record of what happens when the summarizer decides some speech was not worth
// showing. So the floor here is a sanity bound on the prompt, not permission to drop anything.
const MIN_PROMPT_WORDS = 3;

// words is the TRUE budget, not the clamped one. Ansel BLOCKED handing the prompt the floor value
// when the real figure is below it: at a 2s interval the true budget is one word and the prompt was
// being told eleven, which manufactures headroom nobody verified and makes a degraded card
// indistinguishable from a healthy one to the only component that could have compensated. The
// operator is told separately (belowFloor), and now so is the model.
export function readingBudget(medianWpm, intervalSeconds) {
  const { rawWords } = recommendWordsPerCard(medianWpm, intervalSeconds);
  const trueWords = Math.max(MIN_PROMPT_WORDS, Math.round(rawWords));
  return {
    rawWords,
    words: trueWords,
    belowFloor: rawWords < USABLE_CARD_WORDS_FLOOR,
    marginal: rawWords >= USABLE_CARD_WORDS_FLOOR && rawWords < MARGINAL_CARD_WORDS_CEILING
  };
}

// A profile (public/reading-pace.js's saved shape: { recordedAt, fontSizePx, cards }) carries no
// medianWpm field of its own -- it stores the raw per-card measurements, same as the results page,
// so this derives the one number the rest of the app needs from them the same way the results page
// does. Returns null for anything that is not a usable profile (missing, no cards), so callers can
// tell "no measurement" apart from "measured, but slow" without a magic number.
// Cards with no usable timing are FILTERED, not counted as zero. wordsPerMinute returns 0 for a
// missing or zero ms, and keeping those as data points drags the median toward nothing: measured
// 2026-08-04, a four-card profile with two untimed cards reported 15 wpm for a 30 wpm reader, and an
// entirely untimed profile reported 0 -- which then produced three-word cards for the rest of the
// meeting with nothing anywhere saying why. longerCardsReadSlower already filters on exactly this
// condition; the median path did not, and the median is the number the whole display is sized from.
//
// Returns null when nothing usable is left, so a caller can tell "no measurement" from "measured,
// and slow". Do not let this return 0: a 0 is indistinguishable from a real reading of a very slow
// reader at every call site downstream.
export function medianWpmFromProfile(profile) {
  if (!profile || !Array.isArray(profile.cards) || profile.cards.length === 0) return null;
  const wpmValues = profile.cards
    .map((card) => cardWordsPerMinute(card))
    .filter((wpm) => Number.isFinite(wpm) && wpm > 0);
  if (!wpmValues.length) return null;
  return median(wpmValues);
}
