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

// A genuine new sentence starts with a capital letter or a digit. A fragment that starts with a
// lowercase letter is always a continuation of the sentence before it -- this is what actually
// caught the funeral-notice bug: "11:00 a." + "m." merge into "a.m." via ABBREVIATION_END above
// (the generic single-letter case), but that merge is a one-step lookback, so testing the *next*
// fragment against the now-merged "...a.m." tail fails (its last token is "m.", preceded by a
// period, not whitespace) and "in the chapel." was left stranded as its own lowercase-leading
// card, severing the location from the funeral it belonged to. Rather than widen ABBREVIATION_END
// to look through an arbitrary number of periods -- which would also swallow a genuinely new
// sentence any time an abbreviation happens to open it -- this checks the fragment being emitted,
// not the one already merged: no split-off fragment may start a card in lowercase, full stop.
function startsLowercase(text) {
  return /^[a-z]/.test(text.trimStart());
}

function splitBySentence(text) {
  const sentenceMatches = String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!sentenceMatches) return [];

  const merged = [];
  sentenceMatches.forEach((part) => {
    const previous = merged[merged.length - 1];
    const continuesAbbreviation = previous && ABBREVIATION_END.test(previous.trimEnd());
    const continuesLowercase = previous && startsLowercase(part);
    if (continuesAbbreviation || continuesLowercase) {
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

// One model response is one card (Steve's ruling, 2026-07-29): do NOT sentence-split AI text.
// splitBySentence used to run unconditionally regardless of the maxChars passed in here, which is
// how a two-fact summary ("...gutters. Do it before winter.") became two cards and orphaned a
// clause -- the AI_LINE_SAFETY_MAX_CHARS bound in createTranscriptItems was gating splitLongChunk
// only, never the sentence split. splitByThought (blank-line/newline breaks) still applies, since
// that is a structural break the model itself emitted, not a sentence boundary we are inventing.
// The sole remaining split is the runaway-length safety wrap below.
function segmentAiResponseText(text, { maxChars = AI_LINE_SAFETY_MAX_CHARS } = {}) {
  const thoughtChunks = splitByThought(text);
  if (!thoughtChunks.length) return [];

  return thoughtChunks.flatMap((chunk) => splitLongChunk(chunk, maxChars));
}

export function createTranscriptItems({
  text,
  mode,
  source = 'ai',
  createdAt = Date.now(),
  maxChars = DEFAULT_MAX_CHARS
} = {}) {
  // One model response is one card: an AI line is never sentence-split, only guarded against a
  // runaway length (see segmentAiResponseText above). Raw/manually-typed text still goes through
  // full sentence + width segmentation, because a pasted wall of text genuinely needs breaking up.
  const segments = source === 'ai'
    ? segmentAiResponseText(text, { maxChars: Math.max(maxChars, AI_LINE_SAFETY_MAX_CHARS) })
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
