// An experiment, not yet wired into the app.
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

export function buildMinimalSummarizePrompt({ recentTranscript = '', mode = 'speaker' } = {}) {
  const text = String(recentTranscript).trim();

  // CONDENSE: the speaker's own words, made shorter. Their voice is the point.
  if (mode === 'speaker' || mode === 'prayer') {
    const shape = mode === 'prayer'
      ? `This is a prayer. It must still read as a prayer being offered, not as a report that someone
prayed. Keep the address ("Heavenly Father", "Dear Lord") and the amen.`
      : `This is somebody speaking to the congregation. It must still read as them talking.`;

    return `
${READER}

${shape}

Write ONE line of no more than ${CARD_WORDS} words. One line, not two, not three. Whatever the
length of the text below, it becomes a single short line: pick what matters most and say only that.

Shortening is the whole job: do not retell it, do not explain it, and never describe the speaker
from outside ("the speaker said", "he explained", "she shared"). Cut words, keep theirs.

Keep every fact attached to whoever it was about. If they say "I lost my job", write "I lost my
job". If they say "Harold retired after thirty-one years", that is Harold, not the speaker. Never
move somebody else's actions, feelings or history onto the person talking.

${VERBATIM}

Text:
${text}
`.trim();
  }

  // SUMMARIZE: announcements and logistics. Facts survive, wording does not.
  return `
${READER}

This is meeting information: announcements, dates, times, assignments, logistics. Summarize it. The
wording does not matter, the facts do. Third person is correct here, and there is no need to keep
anybody's voice.

Write one line of no more than ${CARD_WORDS} words per SEPARATE announcement, and no more than
three lines in total. Two announcements are two lines; one announcement said at length is still one
line. Lead with the thing itself ("Working bee Saturday"), never with a clause about it ("If you
are able to help...").

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
  history = [],
  historyTurns = 4
} = {}) {
  const text = String(recentTranscript).trim();
  // Reuse the single-message builder for the rules, then strip the transcript it appends: the text
  // belongs in its own final turn, not inside the instructions.
  const full = buildMinimalSummarizePrompt({ recentTranscript: '', mode });
  const rules = full.replace(/\n*Text:\n*$/, '').trim();

  const messages = [{ role: 'system', content: rules }];
  for (const turn of history.slice(-historyTurns)) {
    if (!turn?.spoken || !turn?.shown) continue;
    messages.push({ role: 'user', content: String(turn.spoken).trim() });
    messages.push({ role: 'assistant', content: String(turn.shown).trim() });
  }
  messages.push({ role: 'user', content: text });
  return messages;
}
