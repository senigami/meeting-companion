// Packs the model's thought-per-line reply into cards of a given word budget.
//
// Steve's observation, 2026-08-02, from a real testimony: asked for "no more than 3 lines", the
// model returned 8 -- and no amount of asking changed it (3x15, 3x17 and 2x20 all returned the
// byte-identical 8 lines). What it IS reliably good at is splitting by thought. What it is bad at
// is arithmetic about its own output.
//
// So stop asking. The model splits, this packs: greedily merge adjacent lines while they fit the
// per-card word budget. A line is never split across cards -- a thought that is already over budget
// on its own gets its own card rather than being cut, because cutting mid-thought is the thing the
// display is least able to survive (and segmentTranscriptText's 120-char pass will handle a genuine
// monster downstream).
//
// Order is preserved absolutely. These are somebody's sentences in the order they said them.

const DEFAULT_CARD_WORDS = 15;

function countWords(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

export function packLinesIntoCards(lines, { cardWords = DEFAULT_CARD_WORDS } = {}) {
  const budget = Number.isFinite(cardWords) && cardWords > 0 ? Math.round(cardWords) : DEFAULT_CARD_WORDS;
  const cards = [];
  let current = '';
  let currentWords = 0;

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;
    const words = countWords(line);

    // Fits alongside what we already have: merge. Note `currentWords > 0` rather than a truthiness
    // check on `current` -- an empty accumulator must start a card even for an over-budget line,
    // otherwise a long first thought would push an empty string onto the output.
    if (currentWords > 0 && currentWords + words <= budget) {
      current = `${current} ${line}`;
      currentWords += words;
      continue;
    }

    if (currentWords > 0) cards.push(current);
    current = line;
    currentWords = words;
  }

  if (currentWords > 0) cards.push(current);
  return cards;
}
