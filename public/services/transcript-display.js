import { normalizeText } from './text.js';

const DEFAULT_MAX_CHARS = 120;
const MAX_DISPLAY_ITEMS = 24;
let nextTranscriptItemId = 0;

function splitByThought(text) {
  const chunks = String(text || '')
    .split(/(?:\r?\n)+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  return chunks.length ? chunks : [];
}

function splitBySentence(text) {
  const sentenceMatches = String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!sentenceMatches) return [];
  return sentenceMatches.map((part) => normalizeText(part)).filter(Boolean);
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
  return segmentTranscriptText(text, { maxChars }).map((segment, index) => ({
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
