// The one prompt both OpenAI and Claude summarize through (server/summarization.js). Per-mode job,
// chosen by mode:
//
//   speaker      -> third-person summary of the main point (2026-08-08 ruling: this used to keep
//                   the speaker's own voice; a first version that did attributed other people's
//                   facts to the speaker -- "I was retired then, after thirty-one years driving a
//                   delivery truck" was Harold's story, not the speaker's -- hence the attribution
//                   rule below).
//   prayer       -> still read as a prayer being offered, not reported on.
//   information  -> summarize. Facts matter, voice does not.
//   song         -> status only, which the app already treats as its own thing.

// One card, about this many words -- a target to compress toward, not a hard cap (Steve: he is fine
// getting 11 or 12 when the content needed it). Measured against ~90 words of speech per 15s tick:
// a fixed per-CARD budget compresses properly, where the old three-lines-of-14-words shape landed at
// 47-48.8% and this landed 19-35% depending on input density.
export const CARD_WORDS = 15;

// Tested 2026-08-08 against real recorded speech: dropping the who-this-is-for backstory and
// keeping only the two directives changed nothing observable in the output.
const READER = `Write clean, simple English. Never ASL gloss or ASL word order.`;

const VERBATIM = `Keep these exactly as spoken, never paraphrased and never rounded: names, dates,
times, numbers, hymn numbers, and scripture references.

Replace idioms, figures of speech and long words with plain everyday words. Say what was meant, not
the picture they used to say it.

Write numbers as digits, not words: 9:00 rather than nine o'clock, 19 rather than nineteen, $4
rather than four dollars, John 14:26-27 rather than the fourteenth chapter of John. Digits are
faster to read and harder to misread at a distance.

Never invent a name, number, date, or detail that was not said. Do not say the same thing twice.
Return only the text, with no preamble.`;

export function buildMinimalSummarizePrompt({
  recentTranscript = '',
  mode = 'speaker',
  maxWords = CARD_WORDS,
  level = 'condense'
} = {}) {
  const text = String(recentTranscript).trim();
  const cardWords = Number.isFinite(maxWords) && maxWords > 0 ? Math.round(maxWords) : CARD_WORDS;

  // BRIEF: one card, third person, the single most important thing. Chosen when the reading budget
  // is too small for anything else -- see summary-level.js for the measurement behind that.
  //
  // Third person here is a REVERSAL of this file's original rule, made on evidence rather than
  // taste. Keeping a speaker's own voice was the better goal and it is what the condense level below
  // still does; at ten words it stopped working. Steve, after running it live 2026-08-02: it "gave
  // bad feedback on what they were actually saying and really messed things up". First person has no
  // room left to attribute anything, so a compressed sentence in the speaker's voice reads as a
  // claim THEY made -- and when the compression picks the wrong clause, the display has quietly put
  // words in somebody's mouth in front of the congregation. A report cannot make that mistake,
  // because it never pretends to be them.
  if (level === 'brief') {
    const subject = mode === 'prayer'
      ? 'This is a prayer being offered.'
      : mode === 'speaker'
        ? 'This is somebody speaking to the congregation.'
        : 'This is meeting information: announcements, dates, times, assignments, logistics.';

    return `
${READER}

${subject}

Write ONE line, target ${cardWords} words. Pick the single most important thing and write only that.

Report it, in the third person. Do not write in the speaker's voice and do not write as "I".

Do not spend words on who is talking. Never say "the speaker", "someone", or "a member". Lead with
the thing itself. Name a person only when a name was actually said and the point depends on it.

Never return nothing because what was said seems unimportant, ordinary or repetitive. Compress it
instead. Return nothing only when the text holds no words at all, or repeats a line already shown.

${VERBATIM}

Text:
${text}
`.trim();
  }

  // PRAYER: still its own shape -- a prayer read in third person stops being a prayer, so this one
  // stays in first person rather than moving to the report style speaker mode now uses.
  //
  // 2026-08-08: dropped "keep the address and the amen" after Steve hit a real fabricated Amen.
  // Reproduced it directly: with that instruction, 4/4 mid-prayer chunks (no address or amen
  // actually spoken) got BOTH bookended on, every single call, because the model read "keep" as
  // "every card should look like a complete prayer" rather than "preserve it if it's there."
  // Removing the instruction and testing the same chunks plus a genuine opening and closing: all
  // four came out correct, with the real address/amen still preserved by the ordinary verbatim
  // rule below when they were actually said, and nothing added when they weren't.
  if (mode === 'prayer') {
    return `
${READER}

This is a prayer. It must still read as a prayer being offered, not as a report that someone
prayed.

Put each separate thought on its own line, in the order they were said. Do not number them and do
not add bullets.

${VERBATIM}

Text:
${text}
`.trim();
  }

  // SPEAKER: third person, one card's worth of length per call. Steve's ruling, 2026-08-08, tested
  // against a real recorded talk: direct, simple instructions for exactly what is wanted, no
  // narration -- and no "keep their voice" framing, which is a deliberate reversal of this branch's
  // original shape (see git history). The mandate is fitting on one card at the target length, not
  // forcing exactly one line out of the model -- if it ever returns more than one, packLinesIntoCards
  // still packs/sizes them same as any other mode; nothing downstream assumes a single line.
  if (mode === 'speaker') {
    return `
${READER}

Summarize the main point using simple words, as if explaining it to an 8 year old. Third person only
-- never write as the speaker or use "I".

Keep facts attached to whoever they are about: if a name is mentioned, that name did it, not the
speaker.

${VERBATIM}

Your target is about ${cardWords} words.

Text:
${text}
`.trim();
  }

  // SUMMARIZE: announcements and logistics. Facts survive, wording does not.
  //
  // Note what this no longer says: a total number of lines. It used to cap at three, and
  // cleanModelLines capped at three too, so the two agreed and nothing looked wrong -- while a fourth
  // announcement in one tick was discarded with no error, no telemetry and wasShortened false (#49).
  // A cap that matches the prompt rather than the speech is the whole shape of that bug.
  //
  // Ansel's ruling, 2026-08-04: the 3 was only ever burst control for a display that rendered a
  // whole result at once, and that display is gone -- the release queue hands over one card every few
  // seconds however many lines a call returns, so the queue is what protects him from a burst, not
  // the cap. A runaway guard belongs in code (maxLines, now 12 to match the speaker path), never in
  // the model's instructions.
  return `
${READER}

This is meeting information: announcements, dates, times, assignments, logistics. Summarize it as
if explaining it to an 8 year old. Third person, facts only, no voice to preserve.

Write one line, target ${cardWords} words, per SEPARATE announcement. Two announcements are
two lines; one announcement said at length is still one line. Lead with the thing itself ("Working
bee Saturday"), never with a clause about it ("If you are able to help...").

${VERBATIM}

Text:
${text}
`.trim();
}


// ---------------------------------------------------------------------------
// Steve's question, 2026-08-01: are we sending prior context the right way?
//
// No. Everything above builds ONE user message with the previous block and the already-shown lines
// pasted in as prose sections. The model is handed a description of a conversation rather than a
// conversation. That makes "do not repeat what is already shown" a request it can ignore, which is
// exactly where issue #25 keeps failing.
//
// This builds real turns instead: the rules as a system message, then each earlier block as a user
// turn with the card we actually displayed as the assistant turn that answered it, then the new
// block. The model can now SEE what it already wrote, in the position where its own prior output
// belongs, so not repeating itself is structural rather than instructed.

// Deterministic, non-cryptographic (FNV-1a) hash -- this exists to detect "the prompt changed",
// never to secure anything, so 32 bits is plenty and no crypto dependency is needed in the browser.
function fnv1aHash(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// Issue #4: the recording header needs a value that tracks the prompt actually in use, not a
// hand-maintained version constant someone will forget to bump. So this hashes the REAL rules text
// buildMinimalSummarizePrompt produces (the same string buildMinimalSummarizeMessages sends as the
// system turn), for a fixed set of mode/level combinations at the fixed CARD_WORDS default -- not a
// hash of the source file, which would also change on comment edits that alter no model behavior.
// The sample input is fixed (recentTranscript: '') on purpose: the hash must track the INSTRUCTIONS,
// not whatever transcript a particular call happens to carry.
//
// The list must cover every branch of buildMinimalSummarizePrompt, or an edit to an uncovered one
// changes the real prompt and leaves the hash sitting still -- a stale recording that reads as
// current, which is worse than no hash at all. prayer/brief is here for that reason: it is the only
// case that reaches the brief path's prayer subject line.
export const PROMPT_HASH_SAMPLE_CASES = [
  { mode: 'speaker', level: 'condense' },
  { mode: 'prayer', level: 'condense' },
  { mode: 'information', level: 'condense' },
  { mode: 'speaker', level: 'brief' },
  { mode: 'prayer', level: 'brief' },
  { mode: 'information', level: 'brief' }
];

export function computeSummaryPromptHash() {
  const combined = PROMPT_HASH_SAMPLE_CASES
    .map(({ mode, level }) => buildMinimalSummarizePrompt({ recentTranscript: '', mode, level, maxWords: CARD_WORDS }))
    .join(' ');
  return fnv1aHash(combined);
}

export function buildMinimalSummarizeMessages({
  recentTranscript = '',
  mode = 'speaker',
  maxWords = CARD_WORDS,
  level = 'condense',
  history = [],
  historyTurns = 4
} = {}) {
  const text = String(recentTranscript).trim();
  // Reuse the single-message builder for the rules, then strip the transcript it appends: the text
  // belongs in its own final turn, not inside the instructions.
  const full = buildMinimalSummarizePrompt({ recentTranscript: '', mode, maxWords, level });
  const rules = full.replace(/\n*Text:\n*$/, '').trim();

  const messages = [{ role: 'system', content: rules }];
  for (const turn of history.slice(-historyTurns)) {
    // Trim BEFORE the guard, not after. A whitespace-only entry passed the truthiness check and then
    // trimmed to '', producing an empty content block. OpenAI tolerates that; Anthropic rejects the
    // whole request with a 400, so once the Claude path started using these messages (#47) it became a
    // failed summarize call rather than a slightly odd turn. Found by Cato before it shipped.
    const spoken = String(turn?.spoken ?? '').trim();
    const shown = String(turn?.shown ?? '').trim();
    if (!spoken || !shown) continue;
    messages.push({ role: 'user', content: spoken });
    messages.push({ role: 'assistant', content: shown });
  }
  messages.push({ role: 'user', content: text });
  return messages;
}
