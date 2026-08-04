// How hard to compress, decided by how many words the reader can actually get through before the
// next card replaces this one.
//
// Measured 2026-08-02: the reader's real pace is about one word every two seconds -- roughly 30 wpm,
// far slower than anything this app was built assuming. In a 20-second window that is ten words. Ten
// words cannot carry what somebody said; it can carry the single most important thing they said, and
// Steve's instruction after watching it live is that having that one thing is worth more than having
// a faithful account he cannot finish reading.
//
// So there are two levels, and the reading budget picks between them:
//
//   brief    -> one line, third person, the single core point. What survives ten words.
//   condense -> the existing behaviour: shorten what was said, keep it in their voice, several
//               cards. Correct when the reader has room for it.
//
// condense is deliberately kept rather than replaced. It is the better output when there is time
// for it, and the whole reason for a level rather than a rewrite is that the right answer changes
// with the pace of the person reading (Steve, 2026-08-02: "we should be able to have various levels
// of summarization that can adapt to how fast we're doing the update").

export const SUMMARY_LEVELS = ['brief', 'condense'];

// At or below this per-card budget there is no room for anybody's voice -- only for the point. The
// figure is the reading budget, not a preference: 11 words at 30 wpm is already 22 seconds of
// reading, which is a whole update interval spent on one card.
export const BRIEF_MAX_CARD_WORDS = 11;

export function chooseSummaryLevel({ cardWords } = {}) {
  const words = Number(cardWords);
  if (!Number.isFinite(words) || words <= 0) return 'brief';
  return words <= BRIEF_MAX_CARD_WORDS ? 'brief' : 'condense';
}

export function isSummaryLevel(value) {
  return SUMMARY_LEVELS.includes(value);
}
