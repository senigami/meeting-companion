// The prompt the OpenAI summarization path uses. (It began as an experiment beside the original
// summary-prompt.js, which the Claude path still uses; that asymmetry is deliberate, see
// server/summarization.js.)
//
// Steve's rule, and the thing to get right here: these are TWO different jobs, chosen by mode.
//
//   speaker, prayer  -> CONDENSE. Shorten what was said and leave it in their voice. A talk stays a
//                       talk, a prayer stays a prayer. Do not retell it, do not report on it.
//   information      -> SUMMARIZE. Announcements, dates, logistics. Facts matter, voice does not,
//                       and third person is correct here.
//   song             -> status only, which the app already treats as its own thing.
//
// The live prompt (summary-prompt.js) does one job for all modes and tells the model how to lay the
// result out: three lines, one idea per line, lead with the topic, write the core message rather
// than the opening. Measured over a 1082 word talk that produced more cards than there were
// utterances, repeated itself, and drifted between "the speaker" and "I".
//
// A first version of this file condensed everything regardless of mode. It read far better but
// attributed other people's facts to the speaker ("I was retired then, after thirty-one years
// driving a delivery truck" was Harold, not the speaker), which is a confident falsehood on a wall
// read by someone who cannot hear the room. Hence the attribution rule below.

// One card, about this many words. NOT a per-line cap: the live prompt allows up to three lines of
// 14 words, which is 42 words a call, and the model takes all three nearly every time. Measured
// against ~90 words of speech per 15s tick that lands at 47%, which is what the whole-talk run
// actually produced (48.8%). A fixed per-CARD budget compresses properly: measured directly, 90
// words in gave 17 out (19%) and 46 gave 16 (35%).
export const CARD_WORDS = 15;

const READER = `You are preparing text for a large display read by one person who is Deaf and has low
vision. American Sign Language is their first language and English is their second, so write clean,
simple English. Never ASL gloss or ASL word order. They read slowly, so every word has to earn its
place.`;

const VERBATIM = `Keep these exactly as spoken, never paraphrased and never rounded: names, dates,
times, numbers, hymn numbers, and scripture references.

Replace idioms, figures of speech and long words with plain everyday words. Say what was meant, not
the picture they used to say it.

Write numbers as digits, not words: 9:00 rather than nine o'clock, 19 rather than nineteen, $4
rather than four dollars, John 14:26-27 rather than the fourteenth chapter of John. Digits are
faster to read and harder to misread at a distance.

Do not add anything that was not said. Do not say the same thing twice. Return only the text, with
no preamble.`;

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

Write ONE line of no more than ${cardWords} words. One line only.

The reader gets about one word every two seconds, so this line is all they will manage before the
next one replaces it. Do not try to cover everything that was said. Pick the single most important
thing -- the one piece somebody would need to follow what is happening -- and write only that.

Report it, in the third person. Do not write in the speaker's voice and do not write as "I".

Do not spend words on who is talking. "The speaker", "someone", "a member" and the like tell the
reader nothing they cannot already see, and at this length they cost a fifth of the card. Lead with
the thing itself. Name a person only when a name was actually said and the point depends on it.

Never return nothing because what was said seems unimportant, ordinary or repetitive. Compress it
instead. Return nothing only when the text holds no words at all, or repeats a line already shown.

${VERBATIM}

Text:
${text}
`.trim();
  }

  // PRAYER: still its own shape -- a prayer read in third person stops being a prayer, so this one
  // keeps the address and the amen rather than moving to the report style speaker mode now uses.
  if (mode === 'prayer') {
    return `
${READER}

This is a prayer. It must still read as a prayer being offered, not as a report that someone
prayed. Keep the address ("Heavenly Father", "Dear Lord") and the amen.

Put each separate thought on its own line, in the order they were said. Do not number them and do
not add bullets. Do not worry about how many lines there are or how long each one is -- something
after you packs them into cards, and it can only do that if the thoughts arrive separated.

${VERBATIM}

Text:
${text}
`.trim();
  }

  // SPEAKER: third person, one summary per call. Steve's ruling, 2026-08-08, tested against a real
  // recorded talk: direct, simple instructions for exactly what is wanted, no narration -- and no
  // "keep their voice" framing, which is a deliberate reversal of this branch's original shape (see
  // git history). A word target belongs in the prompt now too: unlike the old shape, this one asks
  // for a single right-sized line instead of splitting into several for packLinesIntoCards to size,
  // so there is nothing left downstream to enforce the budget if the prompt doesn't ask for it.
  if (mode === 'speaker') {
    return `
${READER}

Summarize the main point using simple words, as if explaining it to a 5 year old. Third person only
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

This is meeting information: announcements, dates, times, assignments, logistics. Summarize it. The
wording does not matter, the facts do. Third person is correct here, and there is no need to keep
anybody's voice.

Write one line of no more than ${cardWords} words per SEPARATE announcement. Two announcements are
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
