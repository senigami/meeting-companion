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
// This used to be sized for BUCKET_SEND_MAX_CHARS (a 1000-char send slice) plus a little headroom,
// which held barely two minutes of speech. Now that takeOldestModeRun sends the whole oldest mode
// run every tick and there is no send-slice cap, this constant's only job is to be the outage
// buffer: how much speech a stalled or failing summarizer can hold before trimBucket starts
// dropping the oldest of it. Raised to 8000 (roughly ten minutes of speech at typical speaking
// pace) so a short provider outage does not start silently discarding meeting content.
export const BUCKET_MAX_CHARS = 8000;

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

// The whole oldest contiguous run of consumable chunks that share one mode, built directly from
// those chunks' own text so "what was sent" and "what gets consumed" are provably the same set --
// no separate slicing step to fall out of sync. A mode boundary ends the run early: one summarize
// call must never carry text captured under two different modes, because the prompt carries a
// single `Mode:` line. Chunks captured before mode-tagging existed (or by a caller that never
// tags) fall back to defaultMode, so an untagged chunk never wrongly starts or breaks a run.
//
// maxChars defaults to BUCKET_MAX_CHARS, the cap trimBucket already enforces on the whole bucket
// before this ever runs, so a run should never exceed it. If it somehow does, this throws instead
// of silently sending a slice while a caller consumes the whole (larger) run -- that mismatch is
// exactly how the head of a backlog was destroyed before (see the note on bucketText below).
// speaker (issue #40) breaks a run exactly as mode does, and issue #51 is why.
//
// What this guarantees, stated precisely because the obvious phrasing overclaims: two DIFFERENTLY
// TAGGED speakers are never merged into one card. It cannot fix an operator who has not retyped the
// name yet -- those chunks carry the previous name, nothing breaks, and the #51 harm happens anyway.
// That is inherent to a human-supplied label and is the residual risk #40 accepted when it chose a
// typed name over a guessed one. Carrying it from the
// leading chunk without splitting looked like the conservative reading of #40's deferral, and it
// produced a card asserting one person's name over another person's words. Reproduced before the fix:
// two chunks, "I know the Church is true." (Brother Ashcroft) then "Thank you Brother Ashcroft. I
// lost my job last year." (Sister Ellsworth), summarized as one run and labelled Brother Ashcroft.
//
// The reader cannot hear the room, so he has no way to detect that. An unlabelled card asserts
// nothing; that one asserts something false about a real person in front of the congregation, which
// makes the labelled state worse than the unlabelled state it replaced.
//
// This is NOT the deferred work. #40 defers speaker-aware SUMMARIZATION -- pronoun resolution, the
// prompt knowing who is talking -- and the prompt stays completely speaker-blind here. Where a run
// ends is a bucket decision, and the bucket has always been allowed to make it.
export function takeOldestModeRun(consumable = [], { defaultMode = null, defaultSpeaker = null, maxChars = BUCKET_MAX_CHARS } = {}) {
  const list = (Array.isArray(consumable) ? consumable : []).filter((chunk) => chunk && normalizeText(chunk.text));
  if (!list.length) return { chunks: [], mode: defaultMode, speaker: defaultSpeaker, text: '' };

  const runMode = list[0].mode ?? defaultMode;
  const runSpeaker = list[0].speaker ?? defaultSpeaker;
  const chunks = [];
  for (const chunk of list) {
    if ((chunk.mode ?? defaultMode) !== runMode) break;
    // ?? and not ||, and the difference is the whole guarantee. Every live path produces '' for
    // "no speaker" (start-app.js's initial state, setSpeakerName's trim, replay's `|| ''`), and ''
    // is NOT nullish, so an empty speaker DOES break the run. That is deliberate: '' is what the
    // operator clearing the name field produces, and those cards must go unlabelled rather than
    // inherit the previous person's name. Folding '' into the fallback would reintroduce #51 for
    // exactly the operator action most likely to be a correction.
    //
    // The nullish branch itself only catches a genuinely absent field -- a chunk buffered before #40
    // shipped. No current path writes one, so treat it as belt-and-braces, not as live behaviour.
    if ((chunk.speaker ?? runSpeaker) !== runSpeaker) break;
    chunks.push(chunk);
  }

  const text = chunks.map((chunk) => normalizeText(chunk.text)).join(' ').trim();
  if (text.length > maxChars) {
    throw new Error('transcript send text exceeds the safe cap -- refusing to send a slice while consuming the whole run');
  }

  return { chunks, mode: runMode, speaker: runSpeaker, text };
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
