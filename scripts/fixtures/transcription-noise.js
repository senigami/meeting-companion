// Applies, at modest and tunable rates, the specific kinds of error our own transcription pipeline
// produces -- modeled directly on real captured examples in recordings/*.ndjson, not invented
// generic typos. Notable real cases that shaped this list:
//   - "we have three items of board business" transcribed as "...of word business" (a homophone
//     substitution), and "sister Karen Nielsen" transcribed moments later as "sister Karen Nelson"
//     (a name coming back as a different, similar-sounding name), both in
//     recordings/2026-07-31T03-18-26-461Z.ndjson.
//   - "brother Daniel Ashcroft" / "sister Daniel Ashworth" -- the same name pattern again, in the
//     same recording.
//   - "hymn 142" transcribed as "him 142" in recordings/2026-07-30T20-56-17-394Z.ndjson.
//   - "good morning brothers and sisters Welcome to our sacrament..." -- a lowercase sentence start
//     immediately followed by a capitalized word with no terminal punctuation between them, i.e. a
//     dropped period producing a run-on, in the same recording.
//   - "This is a test to see how well the." -- the tail of a segment (here, presumably "microphone
//     works") dropped entirely, in recordings/2026-07-31T18-30-52-855Z.ndjson.
//
// degrade() is a pure, deterministic function: given the same text and seed it always returns the
// same output, so a noisy run can be reproduced exactly. It uses a small seeded PRNG rather than
// Math.random for that reason.

// Rates are deliberately conservative -- this should read as a good transcription with occasional
// faults, not a broken one. Tune here, not inline.
export const DROP_TRAILING_WORDS_RATE = 0.08;
export const DROP_TERMINAL_PUNCTUATION_RATE = 0.15;
export const HOMOPHONE_SUBSTITUTION_RATE = 0.06;
export const LOWERCASE_SENTENCE_START_RATE = 0.1;
export const MERGE_WITH_NEXT_RATE = 0.04;

// Homophone/near-homophone confusions our pipeline is known to make, modeled on the real
// substitutions above: common words that sound alike, and the "a name comes back as a different,
// similar-sounding name" pattern. Matching is whole-word and case-insensitive; the replacement
// preserves the original's leading capitalization.
const HOMOPHONE_PAIRS = [
  ['hymn', 'him'],
  ['board', 'word'],
  ['Nielsen', 'Nelson'],
  ['Ashcroft', 'Ashworth'],
  ['Whitfield', 'Whitford'],
  ['Karen', 'Kieran'],
  ['prophet', 'profit'],
  ['their', 'there'],
  ['bear', 'bare']
];

// A tiny seeded PRNG (mulberry32) so repeated calls with the same seed produce the same sequence
// of "random" decisions, and different string seeds are turned into a 32-bit int via a simple
// string hash.
function hashSeed(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i += 1) {
    h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRng(seed) {
  return mulberry32(hashSeed(seed));
}

function matchCase(sample, replacement) {
  if (sample[0] === sample[0].toUpperCase() && sample[0] !== sample[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function applyHomophoneSubstitution(text, rng) {
  const words = text.split(/(\s+)/);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const clean = word.replace(/[^a-zA-Z]/g, '');
    if (!clean) continue;
    const pair = HOMOPHONE_PAIRS.find(([a]) => a.toLowerCase() === clean.toLowerCase());
    if (pair && rng() < HOMOPHONE_SUBSTITUTION_RATE) {
      const replaced = matchCase(clean, pair[1]);
      words[i] = word.replace(clean, replaced);
    }
  }
  return words.join('');
}

function dropTrailingWords(text, rng) {
  if (rng() >= DROP_TRAILING_WORDS_RATE) return text;
  const words = text.trim().split(/\s+/);
  if (words.length <= 3) return text;
  const dropCount = rng() < 0.5 ? 1 : 2;
  return words.slice(0, words.length - dropCount).join(' ');
}

function dropTerminalPunctuation(text, rng) {
  if (rng() >= DROP_TERMINAL_PUNCTUATION_RATE) return text;
  return text.replace(/[.!?]+\s*$/, '');
}

function lowercaseSentenceStart(text, rng) {
  if (rng() >= LOWERCASE_SENTENCE_START_RATE) return text;
  if (!text.length) return text;
  return text[0].toLowerCase() + text.slice(1);
}

// Deterministically per-utterance: given the same seed and index, decide whether this utterance's
// terminal punctuation is dropped AND it is glued directly onto the next utterance with no
// separator, reproducing the observed "...for Sunday March 9th we will open by singing..." seam.
export function shouldMergeWithNext(seed, index) {
  const rng = createRng(`${seed}:merge:${index}`);
  return rng() < MERGE_WITH_NEXT_RATE;
}

// Applies the noise types above to a single utterance's text. `seed` combined with the text itself
// keys the RNG, so degrade() is pure and deterministic: the same (text, seed) pair always produces
// the same output, and different utterances at the same seed do not all roll identically.
export function degrade(text, { seed = 'default' } = {}) {
  const clean = String(text || '');
  if (!clean) return clean;

  const rng = createRng(`${seed}:${clean}`);

  let result = clean;
  result = applyHomophoneSubstitution(result, rng);
  result = dropTrailingWords(result, rng);
  result = dropTerminalPunctuation(result, rng);
  result = lowercaseSentenceStart(result, rng);

  return result;
}
