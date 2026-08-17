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

// 2026-08-09, consolidated: this is now the ONE compression instruction every mode and level
// shares (Steve's own leaner prompt, retested directly against real problem chunks -- see decision
// log below). It replaced a heavier, separately-worded version of the same idea that had drifted:
// measured on the same real chunks, the old wording produced 14-24 word cards against a 10-word
// target; this one held 7-13. Having ONE wording for "how to compress" is also what makes every
// mode/level branch below just a small addition on top of a shared base, instead of each carrying
// its own near-duplicate copy that can drift out of sync with the others.
// 2026-08-10 (Steve, experimental -- "might be worth trying at least once"): added to test his own
// theory of why "Sandy White said..." kept recurring -- if the model has to be selective about which
// words earn a place, it may stop spending three of ten words on a preamble that adds no
// information. Reworded same day to Steve's own phrasing ("meaningfully contribute to the meaning
// being conveyed" is more precise than the first draft's "add real information" -- it also rules out
// redundant restatement, not just filler words).
const WORD_SELECTIVITY = `Be frugal with your words -- include only the ones that meaningfully
contribute to the meaning being conveyed.`;

const SIMPLE_RULES = (cardWords) => `Summarize the main point of this text using simple words, as
if explaining it to an 8 year old.

Your target output is about ${cardWords} words.

Replace idioms, figures of speech and long words with plain everyday words. Say what was meant, not
the picture they used to say it.

Favor the shortest amount of characters possible, digits for numbers, time, or amounts. John
14:26-27 rather than the fourteenth chapter of John.

${WORD_SELECTIVITY}`;

// A real missionary or member sometimes bears testimony in another language, and Steve does not
// want that lost -- without this, the model's default behaviour on non-English input was outright
// refusal ("I'm sorry, but I can only respond in English..."), observed directly in a real session
// and now also guarded against on the display side (isRefusalLine, summary-prompt.js). This is the
// other half of that fix: telling the model what TO do with non-English speech, not just catching it
// when it declines to.
//
// 2026-08-17: strengthened to an absolute, standalone rule after a real Thai-language segment that
// arrived as two blocks -- the second block translated correctly, the first came through untranslated.
// Sitting as one clause among several apparently let the model comply inconsistently across blocks;
// stating it as its own unconditional sentence is the fix.
const TRANSLATE = `You must respond only in English. Under no circumstances output any non-English
words, in any part of your response, for any block of input. If the speaker is not speaking in
English, translate the meaning into English -- never refuse to summarize non-English speech, and
never leave foreign words untranslated.`;

const THIRD_PERSON = `Write in the third person. Do not write as the speaker or use "I".`;

// 2026-08-17: generalizes NAME_ATTACHMENT's restraint (below) to the case where there is no name at
// all. A real speaker-mode session measured 16 of 113 cards opening with the literal words "The
// person" -- with no name available to attach in later blocks of a continuous talk, the model reached
// for a generic placeholder subject instead, and reading many cards in a row that all restate "The
// person" is fatiguing for a reader going card by card. Same test as NAME_ATTACHMENT, just extended to
// the unnamed case: don't reach for a subject just to have one.
const NO_PLACEHOLDER_SUBJECT = `Do not open every card with a generic stand-in subject ("the person",
"the speaker", "someone") just to have a subject. Lead with the point or action directly. Name who is
being talked about only when the card's point genuinely depends on identifying them. Keep personal
identifiers compact: when a card truly needs an unnamed subject, use "they" rather than "the person"
or "the speaker".`;

// 2026-08-09, consolidated: this used to be two separately-worded copies of the same invariant
// (one on the brief/prayer path, one on the speaker/information path), which is exactly the drift
// risk an adversarial review flagged -- a future edit to one copy has nothing forcing the other to
// follow. One wording now, used everywhere. Kept even though a small retest could not trigger a
// fabrication either way with or without it: the retest was two constructed chunks, not the
// adversarial sweep that found this gap the first time (2026-08-08 review: 12 tests protecting this
// exact contract were deleted alongside dead code, and nothing replaced them -- see
// summary-level.test.js). A small retest disproving a failure mode is not the same evidence as a
// review built to find one, so this line stays on every mode rather than being dropped on the
// strength of a sample that never tried to break it.
const ANTI_FABRICATION = `Keep names, dates, times, numbers, hymn numbers, and scripture references exactly as spoken, never paraphrased and never rounded.
Never invent a name, number, date, or detail that was not said. Return only the text, with no preamble.
When condensing multiple facts into one, favor keeping a scripture or verse reference, and what it
actually says, over other detail.`;

// Reverted 2026-08-09 to the wording tested and confirmed working earlier the same day, after a
// same-day edit ("never name the speaker at all") misread Steve's intent and was never what he
// asked for -- naming the speaker is not forbidden. The actual rule, from his own example: if the
// source text says "Harold said...", the summary can say "Harold said...". If later chunks about
// the same person don't restate a name and the point does not depend on it, don't add one. If
// naming becomes important again (the point depends on knowing whose story it is), it is fine to
// use it again. This one line covers both the speaker's own name and anyone else's, without
// special-casing either -- attach a name only when the source actually said it AND the point needs it.
const NAME_ATTACHMENT = `Keep facts attached to whoever they are about: if a name is mentioned, that
name did it, not the speaker. Name a person only when a name was actually said and the point
depends on it.`;

// 2026-08-17: measured against 575 real cards, raw input runs 1-114 words (median 26, p75 42, p90
// 54). Compressing a long raw chunk straight to a tight card target in one jump lost meaning --
// reproduced live against OpenAI on a real scripture chunk ("1 Nephi 11:21... Behold the Lamb of
// God" came back "The person felt something special in 1 Nephi 11:21.", the verse's actual content
// gone). Telling the model to condense in two internal steps within the same call, rather than
// jumping straight to the target, fixed it: verified against 5 real chunks (1 scripture-heavy, 4
// ordinary) with no regression and no added cost (still one call). Gated on the raw text actually
// being long enough for a jump that large to matter -- below the threshold there is nothing to lose
// by going straight to target, and BRIEF's tight budget can be reached from ANY raw length (see
// summary-level.js: brief is chosen by reading budget, not input length), so this applies there too.
const TWO_STAGE_WORD_THRESHOLD = 30;
const TWO_STAGE_INTERMEDIATE_WORDS = 27;
const TWO_STAGE_COMPRESSION = `Work in two internal steps, but return only the final result. First,
condense the Text below to about ${TWO_STAGE_INTERMEDIATE_WORDS} words, keeping names, numbers, and
what any cited scripture or verse actually says. Then condense that down further to the target word
count above. Return only that final result.`;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function buildMinimalSummarizePrompt({
  recentTranscript = '',
  mode = 'speaker',
  maxWords = CARD_WORDS,
  level = 'condense'
} = {}) {
  const text = String(recentTranscript).trim();
  const cardWords = Number.isFinite(maxWords) && maxWords > 0 ? Math.round(maxWords) : CARD_WORDS;
  const twoStage = text && wordCount(text) > TWO_STAGE_WORD_THRESHOLD ? `\n\n${TWO_STAGE_COMPRESSION}` : '';

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

${SIMPLE_RULES(cardWords)}${twoStage}

${TRANSLATE}

${subject}

${THIRD_PERSON}

${NO_PLACEHOLDER_SUBJECT}

${NAME_ATTACHMENT}

Never return nothing because what was said seems unimportant, ordinary or repetitive. Compress it
instead. Return nothing only when the text holds no words at all, or repeats a line already shown.

${ANTI_FABRICATION}

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
  //
  // 2026-08-10 (Steve): "put each separate thought on its own line" is gone -- it was the one
  // remaining prompt instruction anywhere in this file that asked for more than one line, and a
  // real prayer produced four separate cards from a single chunk because of it. One card per call
  // is enforced in CODE now (finishReply, server/summarization.js joins everything the model
  // returns onto one card rather than splitting or discarding), so the prompt does not need to ask
  // for a line count at all -- an explicit "write ONE line" was tried and then also removed
  // (Steve): the word target above already says how much to say, and the enforcement guarantees
  // one card regardless of what the model actually returns.
  if (mode === 'prayer') {
    return `
${READER}

${SIMPLE_RULES(cardWords)}${twoStage}

${TRANSLATE}

This is a prayer. It must still read as a prayer being offered, not as a report that someone
prayed.

${ANTI_FABRICATION}

Text:
${text}
`.trim();
  }

  // SPEAKER: third person, one card's worth of length per call. Steve's leaner prompt (see
  // SIMPLE_RULES above), 2026-08-09 -- the fuller version above had drifted word counts to 14-24 on
  // a 10-word target on real speech, without anyone noticing until today; this held 7-13 on the
  // same chunks. If the model ever returns more than one line anyway, finishReply
  // (server/summarization.js) keeps only the first -- one card per call, every mode, no exception
  // (2026-08-10).
  if (mode === 'speaker') {
    return `
${READER}

${SIMPLE_RULES(cardWords)}${twoStage}

${TRANSLATE}

${THIRD_PERSON}

${NO_PLACEHOLDER_SUBJECT}

${NAME_ATTACHMENT}

${ANTI_FABRICATION}

Text:
${text}
`.trim();
  }

  // SUMMARIZE: announcements and logistics. Facts survive, wording does not.
  //
  // 2026-08-09 reversal, Steve's call: this used to ask for one line PER SEPARATE announcement (a
  // 2026-08-04 ruling that a fourth announcement in one tick was being silently dropped, #49) --
  // but that traded one problem for a worse one. One summarize call could then hand back several
  // cards at once, which is exactly what a reader following along card by card cannot absorb: he
  // wants one call, one card. What #49 actually needed was for a real fourth announcement to survive
  // somewhere, not for it to arrive on the same tick as the other three -- and the release queue
  // already paces cards out one at a time regardless of how many a call returns, so a second
  // announcement that does not fit this card's word budget is simply left for the model to pick up on
  // its own next call against the fresh transcript, the same way speaker mode leaves the rest of a
  // long sentence for next time.
  return `
${READER}

${SIMPLE_RULES(cardWords)}${twoStage}

${TRANSLATE}

${THIRD_PERSON}

Pull out the most important information. If more than one announcement fits naturally in that
length, that is fine -- the point is one card, not exactly one fact. Lead with the thing itself
("Working bee Saturday"), never with a clause about it ("If you are able to help...").

${NO_PLACEHOLDER_SUBJECT}

${NAME_ATTACHMENT}

${ANTI_FABRICATION}

Text:
${text}
`.trim();
}


// ---------------------------------------------------------------------------
// Steve's question, 2026-08-01: are we sending prior context the right way?
//
// 2026-08-09 reversal, with real evidence. The 2026-08-01 answer here was "build real
// user/assistant turns, so the model can SEE its own prior output and not repeating itself is
// structural rather than instructed" -- and it worked for issue #25's failure (repeating the same
// CONTENT). It also caused a different failure nobody connected to it until today: a real session
// on one speaker produced fifteen straight cards all opening "Sandy White said/says..." -- the
// model imitating its own prior CARD's phrasing, not its content, because each prior card sat in
// the position an assistant turn a chat model is trained to continue the style of. Reproduced and
// isolated directly (retest against these ten real chunks, 2026-08-09): with the exact same rules
// and the exact same ten chunks, real turns produced the "Name said" preamble on cards 4-10 of 10;
// zero conversation history produced it on NONE, but also lost track of who was speaking, falling
// back to "the person"/"they" once the name stopped appearing in the raw chunk; and prior context
// folded into the SYSTEM message as plain text ("for context only, do not repeat or imitate the
// wording of these") kept the speaker's name where it was grammatically needed WITHOUT reproducing
// a "Name said" template on a single card. That is the shape below: one user/assistant PAIR (a
// worked example of length and tone) still lives here for that, but the ROLLING history beyond it is
// data, not more turns to imitate.

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

  // Folded into the system message as data, not more user/assistant turns -- see the block comment
  // above for why (2026-08-09 reversal, with a real reproduction). historyTurns still caps how many
  // entries get included; the caller (runtime.js) separately caps by a 60-second rolling window
  // before this ever sees the array.
  const contextLines = [];
  for (const turn of history.slice(-historyTurns)) {
    // Trim BEFORE the guard, not after. A whitespace-only entry passed the truthiness check and then
    // trimmed to '', producing an empty content block. OpenAI tolerates that; Anthropic rejects the
    // whole request with a 400, so once the Claude path started using these messages (#47) it became a
    // failed summarize call rather than a slightly odd turn. Found by Cato before it shipped.
    const spoken = String(turn?.spoken ?? '').trim();
    const shown = String(turn?.shown ?? '').trim();
    if (!spoken || !shown) continue;
    contextLines.push(`Said: "${spoken}" / Shown: "${shown}"`);
  }

  // 2026-08-17: strengthened after a real Thai-language segment (no named speaker) where the model
  // got stuck restating/looping on a phrase from prior output before eventually recovering. This
  // clause was already unconditional on speaker-naming (it only ever gated on contextLines.length,
  // never on whether a name appeared), so the fix is wording it as a hard constraint rather than a
  // note, not broadening when it applies.
  const system = contextLines.length
    ? `${rules}\n\nHard constraint, for context only, so you know who has been talking and what has already been shown -- do not repeat or imitate the wording of these, in whole or in part, for any reason, they are already on screen:\n${contextLines.join('\n')}\n\nHard constraint: summarize only the Text below. Never add a name, title, fact, or detail to the summary because it appeared in the context above -- if the Text does not say it, leave it out, even if the context does.`
    : rules;

  return [{ role: 'system', content: system }, { role: 'user', content: text }];
}
