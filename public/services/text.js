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

// Shortens `text` to at most maxChars WITHOUT ever cutting inside a word and WITHOUT adding an
// ellipsis. An earlier version of this idea (public/services/summarization/demo.js line 16-19)
// found that a fixed-offset slice + "..." reads as the line having been mangled rather than
// shortened, so this applies the same three-tier preference the demo summarizer settled on:
// sentence boundary at-or-under the limit, then clause boundary, then last whole word.
// server/summarization.js applies this identically to both the OpenAI and Claude response paths
// so neither provider can silently keep the fixed-offset bug the other one fixed.
export function shortenToLimit(text, maxChars) {
  const str = String(text || '');
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
  if (lastSpace === -1) {
    // No whole word fits inside maxChars at all (an unusually long single word). Returning the
    // full first word -- even if it slightly exceeds maxChars -- is still better than cutting
    // inside it, which rule 1 never allows.
    const nextSpace = str.indexOf(' ');
    return nextSpace === -1 ? str.trim() : str.slice(0, nextSpace).trim();
  }
  return truncated.slice(0, lastSpace).trim();
}
