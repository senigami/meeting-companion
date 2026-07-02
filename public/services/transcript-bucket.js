import { normalizeText } from './text.js';

// A finalized speech-recognition chunk counts as a complete sentence when it
// ends with terminal punctuation, when a newer final utterance has already
// started after it, or when it has settled for long enough that the speaker
// clearly moved on. The newest fresh unpunctuated chunk is the "partial" the
// operator is still reading; only its leading complete sentences may go.
const TERMINAL_END = /[.!?…]["')\]]*$/;

export const BUCKET_SETTLE_MS = 20000;
export const BUCKET_MAX_CHARS = 1600;
export const BUCKET_SEND_MAX_CHARS = 1000;

export function splitAtLastTerminator(text) {
  const clean = normalizeText(text);
  if (!clean) return { complete: '', tail: '' };
  const match = clean.match(/^([\s\S]*[.!?…]["')\]]*)\s*([\s\S]*)$/);
  if (!match) return { complete: '', tail: clean };
  return { complete: normalizeText(match[1]), tail: normalizeText(match[2]) };
}

export function partitionBucket(chunks = [], { now = Date.now(), settleMs = BUCKET_SETTLE_MS } = {}) {
  const list = (Array.isArray(chunks) ? chunks : []).filter((chunk) => chunk && normalizeText(chunk.text));
  const consumable = [];
  const remainder = [];

  list.forEach((chunk, index) => {
    const isNewest = index === list.length - 1;
    const settled = now - chunk.at >= settleMs;
    const punctuated = TERMINAL_END.test(normalizeText(chunk.text));

    if (!isNewest || punctuated || settled) {
      consumable.push(chunk);
      return;
    }

    const { complete, tail } = splitAtLastTerminator(chunk.text);
    if (complete) consumable.push({ ...chunk, text: complete });
    if (tail) remainder.push({ ...chunk, text: tail });
  });

  return { consumable, remainder };
}

export function removeConsumed(chunks = [], consumed = []) {
  if (!Array.isArray(consumed) || !consumed.length) return chunks;
  const list = Array.isArray(chunks) ? chunks : [];

  return list
    .map((chunk) => {
      const match = consumed.find((item) => item.at === chunk.at && chunk.text.startsWith(item.text));
      if (!match) return chunk;
      const leftover = normalizeText(chunk.text.slice(match.text.length));
      return leftover ? { ...chunk, text: leftover } : null;
    })
    .filter(Boolean);
}

export function bucketText(chunks = [], preview = '', { maxChars = BUCKET_MAX_CHARS } = {}) {
  const stream = (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => normalizeText(chunk?.text))
    .filter(Boolean)
    .join(' ')
    .trim();

  const combined = [stream, normalizeText(preview)].filter(Boolean).join(' ').trim();
  return combined.length > maxChars ? combined.slice(-maxChars) : combined;
}

export function trimBucket(chunks = [], { maxChars = BUCKET_MAX_CHARS } = {}) {
  const list = (Array.isArray(chunks) ? chunks : []).filter((chunk) => chunk && normalizeText(chunk.text));
  let total = list.reduce((sum, chunk) => sum + chunk.text.length + 1, 0);
  let start = 0;
  while (start < list.length - 1 && total > maxChars) {
    total -= list[start].text.length + 1;
    start += 1;
  }
  return start ? list.slice(start) : list;
}
