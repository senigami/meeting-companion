import { normalizeText } from './text.js';

// A finalized speech-recognition chunk counts as a complete sentence when it
// ends with terminal punctuation, when a newer final utterance has already
// started after it, or when it has settled for long enough that the speaker
// clearly moved on. The newest fresh unpunctuated chunk is the "partial" the
// operator is still reading; only its leading complete sentences may go.
// The single definition of "this sentence has ended". Exported because it was previously duplicated
// with three slightly different spellings across the bucket, the demo summarizer's eligibility check
// and its trailing-punctuation trim -- two of which accepted a closing quote or bracket and one of
// which did not, so a sentence ending `gutters."` was permanently ineligible and the demo went mute
// on it.
export const TERMINAL_END = /[.!?…]["')\]]*$/;

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

// The oldest run of consumable chunks that fits inside the send cap, so "what was sent" and "what
// gets consumed" are the same set. bucketText slices to the LAST maxChars, so handing it the whole
// consumable set and then removing all of it silently destroyed the head of a large backlog -- speech
// that was never sent to a summarizer and never reached the wall. Oldest-first also keeps the display
// marching in the order things were said; whatever does not fit stays in the bucket for the next tick.
// Always returns at least one chunk, so a single over-long chunk can still make progress.
export function takeSendableChunks(consumable = [], maxChars = BUCKET_SEND_MAX_CHARS) {
  const list = (Array.isArray(consumable) ? consumable : []).filter((chunk) => chunk && normalizeText(chunk.text));
  if (!list.length) return [];

  const taken = [];
  let total = 0;
  for (const chunk of list) {
    const length = normalizeText(chunk.text).length + (taken.length ? 1 : 0);
    if (taken.length && total + length > maxChars) break;
    taken.push(chunk);
    total += length;
  }

  return taken;
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
