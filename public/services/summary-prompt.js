// The display contract, in one place: a card is at most this many words, because it is read at a
// distance in one glance by someone who may be hard of hearing. Exported so every summarizer honours
// the same number -- the demo summarizer used its own character budget and put lines on the wall
// twice this long, and nothing caught it because the limit only existed as prose inside the prompt.
export const SUMMARY_MAX_WORDS = 14;

// The operator can set a card length, but maxWords lands directly inside the prompt text sent to the
// model, so it is clamped rather than trusted: anything non-numeric or outside the range falls back
// to the shared default. The clamp lives here, next to the prompt it protects, so the number in a
// prompt is always the number that was honoured -- when the clamp lived only on the server, the
// client could hand back a prompt claiming a limit the server had already rejected.
export const MAX_WORDS_MIN = 6;
export const MAX_WORDS_MAX = 24;

export function clampMaxWords(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return SUMMARY_MAX_WORDS;
  const rounded = Math.round(numeric);
  if (rounded < MAX_WORDS_MIN || rounded > MAX_WORDS_MAX) return SUMMARY_MAX_WORDS;
  return rounded;
}

export function modeInstruction(mode = 'speaker') {
  switch (mode) {
    case 'information':
      return 'Prioritize exact dates, times, places, hymn numbers, assignments, and announcements. Copy every number, name, and date exactly; drop the surrounding courtesy words rather than shortening a detail.';
    case 'song':
      return 'Only show hymn or song status. Do not show lyrics or commentary.';
    case 'prayer':
      return 'Write a short prayer-shaped line that keeps the main requests and tone. Start with a simple opening like "Heavenly Father" and end with "Amen". Do not summarize line by line.';
    case 'speaker':
    default:
      return 'Focus on the specific story, event, teaching, feeling, invitation, or example.';
  }
}

export function cleanModelLine(line = '') {
  return String(line).trim().replace(/^[-•*]\s*/, '').replace(/^"|"$/g, '').replace(/\s+/g, ' ');
}

// The cap on how many discrete ideas one summarize call may put on the wall. Reading load is one
// combined quantity (words/card x cards/min) -- three short cards for a burst of announcements is an
// acceptable spike, but uncapped would let a dense chunk flood the wall all at once.
export const MAX_LINES_PER_CALL = 3;

// The runaway guard, in ONE place, because it was in three and they disagreed.
//
// #49 raised the server's information-mode cap to 12 and the fix never reached the display: both
// client drivers re-run cleanModelLines on the server's reply with no maxLines, so they re-capped at
// the MAX_LINES_PER_CALL default of 3. Measured after #59 merged -- the server returned five
// announcements and the display got three, with "Ward council meets at 6:30" dropped exactly as #49
// described. A cap fixed at one layer and re-applied at the next is not fixed.
//
// So the number lives here and every caller that needs a runaway bound imports it. MAX_LINES_PER_CALL
// stays 3 because it is the CONTRACT of the older buildSummarizePrompt (which genuinely asks for
// three lines), not a display limit -- do not merge the two constants, they mean different things.
export const RUNAWAY_LINE_GUARD = 12;

function lineKey(line = '') {
  return cleanModelLine(line).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isVagueLine(line = '') {
  return [
    /^he is talking about faith$/i,
    /^she is talking about faith$/i,
    /^they are talking about faith$/i,
    /\b(talking|speaking|sharing|discussing) about faith\b/i,
    /\b(talking|speaking|sharing|discussing) about the message\b/i,
    /^\s*(something important is being shared|the speaker is giving encouragement|they are sharing something important)\s*$/i,
    /^\s*(faith|message|encouragement|teaching|lesson|announcement|summary)\s*$/i,
    /\bstill talking about\b/i
  ].some((pattern) => pattern.test(line));
}

export function shouldAcceptModelLine(line, visibleLines = []) {
  const clean = cleanModelLine(line);
  if (!clean) return false;
  if (isVagueLine(clean)) return false;

  const key = lineKey(clean);
  if (!key) return false;

  const visibleKeys = visibleLines.map(lineKey);
  if (visibleKeys.includes(key)) return false;

  return true;
}

// Splits a model reply into up to MAX_LINES_PER_CALL separate ideas, cleaning and accepting each
// independently -- ORDER is preserved (a reader getting the benediction before the closing hymn is a
// real defect) and a duplicate-of-visible or vague SIBLING line is dropped without suppressing the
// others in the same reply. cleanModelLine itself stays untouched (other callers depend on its
// single-line collapse of internal whitespace); this only does the newline split that sits above it.
// maxLines defaults to MAX_LINES_PER_CALL, which is what the Claude path (buildSummarizePrompt)
// still needs: that prompt asks for three lines and three is the contract. The OpenAI path passes a
// higher ceiling deliberately -- its prompt now asks for one thought per line and lets
// packLinesIntoCards decide card sizing, so capping at three there silently discarded the tail of a
// long testimony (measured: 8 lines returned, 5 dropped, no error and no telemetry).
export function cleanModelLines(text = '', visibleLines = [], { maxLines = MAX_LINES_PER_CALL } = {}) {
  return cleanModelLinesWithLoss(text, visibleLines, { maxLines }).accepted;
}

// The same work, reporting what the CAP threw away (#58).
//
// Three things can drop a line here and only one of them is a loss. A line matching something already
// on screen, or repeating a sibling in the same reply, is supposed to go -- that is the duplicate
// filter doing its job. A line dropped because the cap was reached is real speech that never reaches
// the reader, and until now it was indistinguishable from a clean call: the only telemetry was
// wasShortened, which describes shortenToLimit trimming a line's characters, a different mechanism
// entirely.
//
// That gap is why #49, #63 and #65 each survived being "fixed". Every one was a bound discarding
// content while the call reported success, and each was found by a person tracing the path by hand
// rather than by anything the system said. discardedByCap is what the system says now.
//
// Counted, not inferred: the loop keeps going after the cap so the remainder is actually examined,
// because "raw lines minus accepted" would also count blanks and legitimate duplicate drops. Which
// means the dedupe bookkeeping has to keep running past the cap too -- see seenKeys below.
export function cleanModelLinesWithLoss(text = '', visibleLines = [], { maxLines = MAX_LINES_PER_CALL } = {}) {
  const rawLines = String(text || '').split(/\r?\n/);
  const accepted = [];
  const seenKeys = [];
  let discardedByCap = 0;

  for (const rawLine of rawLines) {
    const clean = cleanModelLine(rawLine);
    if (!clean) continue;
    if (!shouldAcceptModelLine(clean, [...visibleLines, ...accepted])) continue;

    const key = lineKey(clean);
    if (seenKeys.includes(key)) continue;

    if (accepted.length >= maxLines) {
      // Register the key even though nothing is accepted, or the count over-reports. seenKeys used to
      // be written only on accept, so a line repeating a sibling PAST the cap was never registered,
      // failed the dedupe check nobody had added it to, and was counted as a cap loss. Measured by
      // Cato: "One. Two. Three. Three." at a cap of 2 reported 2 losses when one line of speech was
      // lost, and it inflates worst on exactly the input models actually produce, a repeating tail.
      seenKeys.push(key);
      discardedByCap += 1;
      continue;
    }

    accepted.push(clean);
    seenKeys.push(key);
  }

  return { accepted, discardedByCap };
}

export function buildSummarizePrompt({
  mode = 'speaker',
  recentTranscript = '',
  previousBlock = '',
  visibleLines = [],
  maxWords = SUMMARY_MAX_WORDS
} = {}) {
  const wordLimit = clampMaxWords(maxWords);
  const visibleBlock = visibleLines.filter(Boolean).length
    ? visibleLines.filter(Boolean).map((line) => `- ${line}`).join('\n')
    : '- none';

  // The rolling two-block window (.agent/rolling-window-brief.md): the previous block is rendered
  // as its own labelled section, distinct from the current transcript, and marked context-only. A
  // concatenated blob would let the model re-summarize the previous block in different words, which
  // sails right past shouldAcceptModelLine's exact-key dedupe. Absent/empty previousBlock must leave
  // the prompt byte-identical to before this feature existed -- that is the regression guard for a
  // first tick, a mode change, or a failed previous call.
  const previousBlockText = String(previousBlock || '').trim();
  const visibleSection = `Visible lines already shown:\n${visibleBlock}`;
  const previousSection = previousBlockText
    ? `\n\nPrevious block (already summarized -- context only. Do NOT write a line about this block by itself; use it only to recover an idea that started in it and continues into the new text, or a distinct fact from it that did not fit in an earlier reply's three-line cap):\n${previousBlockText}`
    : '';
  const recentLabel = previousBlockText ? 'New transcript (summarize this)' : 'Recent transcript';
  const recentSection = `${recentLabel}:\n${String(recentTranscript).trim()}`;

  return `
You are creating large-print assistive text for one deaf, low-vision person during a church meeting.
American Sign Language is their first language and English is their second, so write clean, simple
English -- never ASL gloss or ASL word order, which is not a writing system and reads as broken text.
They read slowly and see poorly, so every word on the card has to earn its place: one card is one
glance, and a word spent on filler is a word they pay for.

Return zero, one, two, or three lines, one idea per line, separated by newlines. Never merge two
ideas into one line -- if the transcript holds several distinct facts (for example, two announcements,
or a hymn number and a separate assignment), write each on its own line, in the order they were
spoken, rather than folding them into a single crowded sentence or dropping all but one.
Only add a line when the transcript contains something useful that is new or more specific than the lines already shown.
Only return an empty string if the new transcript repeats what a visible line already says,
or holds no words at all. Never return an empty string because what was said seems unimportant,
small, or ordinary. If it is new, compress it and return it.
Avoid lines like "He is talking about faith."

Write a single short line that would help someone reading from across the room.
Do not use labels such as "main point," "speaker," "summary," or "announcement."
Do not say "still talking about."
Use plain, specific language.
Lead with the topic or the person the line is about, then say what about it. Never open with a
subordinate clause ("If you are able to help, ...") -- put the thing first ("Working bee Saturday").
Preserve names, dates, times, hymn numbers, scripture references, assignments, and places exactly as
they were said. These are what a reader cannot recover from context; never paraphrase a number. This
does not relax when the transcript is long: compression means dropping detail, never dropping or
softening a name, date, time, hymn number, or assignment, and the word maximum below is still a
ceiling to cut toward, not a target to reach by rounding a number off.
Write every number that was spoken as digits, never as words: 9:00 rather than nine o'clock, hymn
136 rather than hymn one hundred and thirty six, 19 rather than nineteen, $4 rather than four
dollars, John 14:26-27 rather than the fourteenth chapter of John. Digits are faster to read and
harder to misread from across the room. This is about the FORM of a number that was said, and it
never licenses supplying one that was not: the rule below wins wherever the two touch.
Never invent a number, name, date, time, or other specific detail that was not spoken. A descriptive
or ordinal reference ("our first hymn," "the closing hymn," "next week's reading," "the usual
volunteers") stays exactly that -- do not turn it into "hymn number one" or any other specific
designation unless that designation was actually said. If no number was spoken, carry the speaker's
own descriptive wording instead of supplying one. A confident specific you made up is worse than a
faithful vague line: never guess a detail to sound precise.
Use everyday words and no abbreviations. No idioms, figures of speech, sarcasm, or wordplay: if the
speaker used one, write what it means instead of what they said.
Name the person rather than writing "he", "she", or "they", unless the name is on a visible line
directly above.
One idea per line. Active voice. Do not join two thoughts with "and" or a semicolon.
Maximum ${wordLimit} words, and fewer whenever fewer will do. Count the words in your line before
returning it: if it is longer than ${wordLimit} words, cut whole words from the end until it is
not, rather than returning it as written. Never cut a name, date, time, hymn number, scripture
reference, or assignment to make room -- if the line cannot hold ${wordLimit} words AND every
required detail verbatim, drop a surrounding word instead, never the detail.
Do not add information.
Do not return an empty string merely because the content seems minor. Compress it instead.
Do not repeat what a visible line already says.
When the transcript holds more than one card's worth of speech, write the core message as it stands
now, not the opening of it -- a reader who gets the gist a little late can still follow the meeting; a
reader who only ever gets paragraph one of five cannot. If something important in the transcript is
missing from the visible lines, say that now: this may be the only chance the reader gets at it.
If the transcript holds more distinct facts than fit in three lines, still write the three most
important now and do not silently drop the rest -- an item that does not fit this call is expected to
be recovered on a later call, once it appears in the previous-block context below, rather than lost.

Mode: ${mode}
${modeInstruction(mode)}

Prayer mode should read like a short, simple prayer rather than a status note.

Do not produce generic statements such as:
- He is talking about faith.
- They are talking about the message.
- Something important is being shared.
- The speaker is giving encouragement.

${visibleSection}${previousSection}

${recentSection}
`.trim();
}
