// An experiment, not yet wired into the app. The live prompt (summary-prompt.js) tells the model
// what to write: three lines maximum, one idea per line, lead with the topic, write the core
// message rather than the opening, do not repeat a visible line, return nothing if the moment is
// thin. Measured over a whole talk, that produced MORE cards than there were utterances, said the
// same thing twice, and drifted between calling the speaker "the speaker" and writing as "I".
//
// Steve's instruction: give the model the block of text and the length to reduce it to. Nothing
// else. Compression is the whole job, so the prompt should describe compression and let the text
// keep its own shape.
//
// The one thing this keeps from the accessibility contract is the part that is about the reader
// rather than about style: plain words, no idioms, and details that cannot be recovered from
// context must survive verbatim.

// A block is reduced to this share of its own length. 0.35 is a starting point, not a finding:
// the talk simulation measured the current prompt at 49%, which is too much reading for someone
// who reads at 60 words per minute.
export const TARGET_RATIO = 0.35;

// Never ask for fewer than this. Compressing a short block to a handful of words loses detail
// rather than shortening prose.
export const MIN_TARGET_WORDS = 12;

export function targetWordsFor(text, { ratio = TARGET_RATIO, minWords = MIN_TARGET_WORDS } = {}) {
  const spoken = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  if (!spoken) return 0;
  return Math.max(minWords, Math.round(spoken * ratio));
}

export function buildMinimalSummarizePrompt({ recentTranscript = '', ratio = TARGET_RATIO } = {}) {
  const text = String(recentTranscript).trim();
  const target = targetWordsFor(text, { ratio });

  return `
You are shortening speech from a church meeting so it can be read on a large display by one person
who is Deaf and has low vision. American Sign Language is their first language and English is their
second, so write clean, simple English. Never ASL gloss or ASL word order.

Shorten the text below to about ${target} words. Going a little over is better than losing meaning.

Keep it in the speaker's own words and point of view. If they say "I", write "I". Never describe
them from outside ("the speaker said", "he explained"). You are shortening what they said, not
reporting it.

Keep exactly as spoken, never paraphrased: names, dates, times, numbers, hymn numbers, and
scripture references.

Replace idioms, figures of speech and long words with plain everyday words. Say what was meant.

Do not add anything that was not said. Do not repeat yourself. Write one idea per line.

Return only the shortened text, with no preamble.

Text:
${text}
`.trim();
}
