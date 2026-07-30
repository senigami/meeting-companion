export function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function toLowerKey(text) {
  return normalizeText(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function appendUniqueText(list, text) {
  const clean = normalizeText(text);
  if (!clean) return list;
  if (toLowerKey(list[list.length - 1] || '') === toLowerKey(clean)) return list;
  return [...list, clean];
}

export function appendUniqueChunk(chunks, text, at = Date.now(), mode = null) {
  const clean = normalizeText(text);
  if (!clean) return chunks;
  const last = chunks[chunks.length - 1];
  if (toLowerKey(last?.text || '') === toLowerKey(clean)) return chunks;
  return [...chunks, { text: clean, at, mode }];
}

// A sentence boundary for shortening purposes: terminal punctuation, optionally followed by a
// closing quote/bracket, followed by whitespace or end-of-string. Mirrors TERMINAL_END
// (transcript-bucket.js) but is matched mid-string via a global scan rather than anchored at $.
const SENTENCE_BOUNDARY = /[.!?…]["')\]]*(?=\s|$)/g;

// Same clause-break idea as the demo summarizer's CLAUSE_BREAK
// (public/services/summarization/demo.js): a comma, semicolon, colon or dash followed by
// whitespace still reads as a phrase someone said; an arbitrary word does not.
const CLAUSE_BREAK = /[,;:—-]\s+/g;

// How far a single unbreakable word may overshoot maxChars before shortenToLimit stops protecting it
// and cuts anyway. Two is generous on purpose: real over-long words (a long surname, a compound
// place name) sit just past the limit, while the cases this guards against -- a URL, a base64 blob, a
// model that returned JSON -- are orders of magnitude past it, not a little past it.
const UNBREAKABLE_WORD_FACTOR = 2;

// Shortens `text` to at most maxChars WITHOUT ever cutting inside a word and WITHOUT adding an
// ellipsis. An earlier version of this idea (public/services/summarization/demo.js line 16-19)
// found that a fixed-offset slice + "..." reads as the line having been mangled rather than
// shortened, so this applies the same three-tier preference the demo summarizer settled on:
// sentence boundary at-or-under the limit, then clause boundary, then last whole word.
// server/summarization.js applies this identically to both the OpenAI and Claude response paths
// so neither provider can silently keep the fixed-offset bug the other one fixed.
export function shortenToLimit(text, maxChars) {
  // Leading whitespace is stripped up front rather than in the fallback branch, because it does not
  // just make the output untidy -- it corrupts every index this function reasons about. With a
  // whitespace RUN at the front, the last-whole-word slice lands inside that run and returns the
  // empty string, and no amount of guarding the lastSpace === 0 case catches it. A display line never
  // wants its leading whitespace preserved anyway.
  const str = String(text || '').replace(/^\s+/, '');
  if (str.length <= maxChars) return str;

  let bestSentence = '';
  SENTENCE_BOUNDARY.lastIndex = 0;
  for (const match of str.matchAll(SENTENCE_BOUNDARY)) {
    const end = match.index + match[0].length;
    if (end > maxChars) break;
    bestSentence = str.slice(0, end).trim();
  }
  if (bestSentence) return bestSentence;

  let bestClause = '';
  for (const match of str.matchAll(CLAUSE_BREAK)) {
    const run = str.slice(0, match.index).trim();
    if (run.length > maxChars) break;
    bestClause = run;
  }
  if (bestClause) return bestClause;

  const truncated = str.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace <= 0) {
    // No whole word fits inside maxChars at all (an unusually long single word). Returning the
    // full first word -- even if it slightly exceeds maxChars -- is still better than cutting
    // inside it, which rule 1 never allows.
    //
    // `lastSpace === 0` lands here too, and must: slicing to index 0 returns the empty string, so a
    // line whose first character is a space and whose first word is over-long used to shorten to
    // nothing at all. A blank card on the wall is indistinguishable from the app having failed.
    const leading = str.replace(/^\s+/, '');
    const nextSpace = leading.indexOf(' ');
    const firstWord = (nextSpace === -1 ? leading : leading.slice(0, nextSpace)).trim();

    // The ceiling rule 1 was missing. Overshooting the limit to keep a word intact is the intended
    // trade, but it was unbounded: one malformed response with no whitespace in it (a URL, a base64
    // blob, a model returning JSON) would be returned in full, at any length. Past this factor the
    // input is not a long word, it is not words at all, so the no-cutting-inside-a-word courtesy
    // stops being owed and a hard cut protects the display.
    if (firstWord.length > maxChars * UNBREAKABLE_WORD_FACTOR) return firstWord.slice(0, maxChars);
    return firstWord;
  }
  return truncated.slice(0, lastSpace).trim();
}
