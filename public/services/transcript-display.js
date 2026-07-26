import { normalizeText } from './text.js';

const DEFAULT_MAX_CHARS = 120;
// A 14-word line runs to roughly 90 characters, so this only ever catches a summarizer that
// ignored its own limit -- not the ordinary long-but-complete sentence that the 120-char default
// was splitting into two cards ("...clear the gutters" / "before winter.").
const AI_LINE_SAFETY_MAX_CHARS = 240;
const MAX_DISPLAY_ITEMS = 24;
let nextTranscriptItemId = 0;

function splitByThought(text) {
  const chunks = String(text || '')
    .split(/(?:\r?\n)+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  return chunks.length ? chunks : [];
}

// Titles and initials end in a period without ending a sentence. Splitting on the bare period put
// a card on the wall reading only "Bro." and moved the rest to the next one -- and "Bro.", "Sis."
// and "Pres." are everyday words in this room, not edge cases.
const ABBREVIATION_END = /(?:^|\s)(?:bro|sis|pres|dr|mr|mrs|ms|st|jr|sr|vs|no|approx|dept|vol|ch|fig|e\.g|i\.e|[a-z])\.$/i;

function splitBySentence(text) {
  const sentenceMatches = String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!sentenceMatches) return [];

  const merged = [];
  sentenceMatches.forEach((part) => {
    const previous = merged[merged.length - 1];
    if (previous && ABBREVIATION_END.test(previous.trimEnd())) {
      merged[merged.length - 1] = `${previous}${part}`;
      return;
    }
    merged.push(part);
  });

  return merged.map((part) => normalizeText(part)).filter(Boolean);
}

function splitLongChunk(text, maxChars) {
  const clean = normalizeText(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const words = clean.split(/\s+/);
  const chunks = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = word;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [clean];
}

export function segmentTranscriptText(text, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const thoughtChunks = splitByThought(text);
  const sentenceChunks = thoughtChunks.length ? thoughtChunks.flatMap(splitBySentence) : [];
  const chunks = sentenceChunks.length ? sentenceChunks : thoughtChunks;
  if (!chunks.length) return [];

  return chunks.flatMap((chunk) => splitLongChunk(chunk, maxChars));
}

export function createTranscriptItems({
  text,
  mode,
  source = 'ai',
  createdAt = Date.now(),
  maxChars = DEFAULT_MAX_CHARS
} = {}) {
  // An AI line arrives already bounded by the summarizers' shared word limit, so re-splitting it
  // here can only do harm: a single grammatically complete sentence with no internal punctuation
  // (a long announcement, say) was being word-wrapped at 120 characters into two cards, which put
  // "...clear the gutters" on one card and "before winter." on the next. Segmenting is for raw or
  // manually-typed text, where a wall of characters genuinely does need breaking up.
  // The exemption is not unconditional: a model can disobey its 14-word instruction, and one
  // 60-word card is worse to read from the back of a hall than two. So AI lines keep a generous
  // safety bound well above any obedient line, and only a runaway one gets wrapped.
  const segments = source === 'ai'
    ? segmentTranscriptText(text, { maxChars: Math.max(maxChars, AI_LINE_SAFETY_MAX_CHARS) })
    : segmentTranscriptText(text, { maxChars });

  return segments.map((segment, index) => ({
    id: `transcript-${createdAt}-${nextTranscriptItemId + index}`,
    mode,
    text: segment,
    createdAt,
    source
  }));
}

export function appendTranscriptItems(items, nextItems) {
  const existing = Array.isArray(items) ? [...items] : [];
  const additions = Array.isArray(nextItems) ? nextItems : [];

  for (const item of additions) {
    const last = existing[existing.length - 1];
    if (last && normalizeText(last.text).toLowerCase() === normalizeText(item.text).toLowerCase()) {
      continue;
    }
    existing.push(item);
  }

  nextTranscriptItemId += additions.length;
  return existing.slice(-MAX_DISPLAY_ITEMS);
}

export function isTranscriptNearBottom(viewport, threshold = 96) {
  if (!viewport) return true;
  const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  return remaining <= threshold;
}
