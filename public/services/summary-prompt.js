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
// stays 3 as cleanModelLines's own default cap, distinct from RUNAWAY_LINE_GUARD below -- do not
// merge the two constants, they mean different things.
export const RUNAWAY_LINE_GUARD = 12;

// 2026-08-09, real session: "Okay.", "Let's see.", and "." each still went out as a full network
// call and came back "Nothing was said.", displayed as if it were a card. Steve: "if there was
// truly nothing being said it should never have sent blank to the summarizer in the first place."
//
// 2026-08-10 correction, also Steve, from a real prayer that never printed its closing: a first
// version of this gate required several real words, specifically to hold back a bare "Amen." one
// tick until more speech joined it -- but there is no way to tell "Amen" (a real, complete,
// meaningful word) apart from "Okay" (filler) by word count or character-script structure; they are
// both one word. Treating them the same way silently ate real content the gate had no business
// judging.
//
// "Gating bucket and summary should work the same" (Steve): the gate must never be stricter than
// what the summarizer's own prompt already promises (SIMPLE_RULES, summary-prompt-minimal.js:
// return nothing only when the text holds no real words at all) -- so this only rejects text with
// NO letter or digit in it at all, in any script. A stray "Okay." or a single non-English syllable
// can still reach the network, and occasionally come back a literal non-answer; isNonAnswerLine
// below is the display-side catch for that, the same way isRefusalLine already catches a refusal --
// moving the judgment call to where it can actually be made (after the model has seen the real
// text), not guessed blind beforehand.
export function hasSubstantiveContent(text = '') {
  return /[\p{L}\p{N}]/u.test(String(text));
}

function lineKey(line = '') {
  return cleanModelLine(line).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// 2026-08-09, real session: a foreign-language ASR fragment and an off-topic aside each got a real
// refusal back from the model ("I'm sorry, but I can only respond in English...", "I'm sorry, but I
// can't assist with that."), and it was displayed on the wall as if it were a summary. The server
// only treats a 200-with-no-content as empty (emptyReplyOrRethrow, server/summarization.js); a
// refusal has real text content and sailed straight through. This is the display-side backstop --
// checked the same way isVagueLine is, not as a provider-level failure, because the call itself
// succeeded and nothing about it should count against the failure-escalation counter.
//
// Narrowed 2026-08-09 (adversarial review): the first version matched a bare "I'm sorry" or "as an
// ai" prefix and, run against constructed legitimate content, rejected "I'm sorry for the
// confusion, the bishop explained.", "I'm sorry the meeting ran long, the leader said.", and "As an
// AI hobbyist, the speaker builds robots." -- real content, silently dropped the exact way a
// duplicate or vague line already is, with nothing distinguishing the loss. Requires the full
// refusal-shaped continuation now (matching both real observed cases), not just the opening words,
// and excludes the "cannot help but" idiom specifically, which shares a prefix with a real refusal.
function isRefusalLine(line = '') {
  return (
    /^\s*i'?m sorry,?\s+but\s+i\s+(can(?:not|'?t)\s*(?:assist|help)\b(?!\s+but)|can only respond in\b)/i.test(line) ||
    // Narrowed again 2026-08-12: this arm had no observed case behind it, unlike the one above, and
    // PRAYER mode is deliberately first person (summary-prompt-minimal.js), so "I cannot help my
    // brother without Thy strength" is a real prayer card this would have dropped silently. A
    // refusal either names what it will not do ("with that") or is the entire line.
    /^\s*i\s*(?:cannot|can'?t)\s*(?:assist|help)\s+(?:you\s+)?with\s+that\b/i.test(line) ||
    /^\s*i\s*(?:cannot|can'?t)\s*(?:assist|help)\s*[.!]?\s*$/i.test(line) ||
    /^\s*as an ai[,.]/i.test(line) ||
    /^\s*as an ai (?:language model|assistant)\b/i.test(line)
  );
}

// 2026-08-10: the display-side counterpart to widening hasSubstantiveContent above. Once the gate
// stopped pre-judging "is this enough to bother sending," the model occasionally does what it did
// in the original incident and answers with a literal statement that there is nothing to say
// ("Nothing was said.") instead of returning empty text as the prompt actually asks for. That is
// exactly as much a non-answer as an empty string, so it is caught here rather than displayed as a
// real card. Anchored to the specific observed phrasing and close variants, not a broad "nothing"
// match, so a real card that happens to start with the word "nothing" ("Nothing was decided at the
// meeting, so...") is not mistaken for one of these.
function isNonAnswerLine(line = '') {
  return /^(nothing|no)\s+(significant|important|much|really)?\s*(was\s+)?said\b\.?$/i.test(line.trim());
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
  if (isRefusalLine(clean)) return false;
  if (isNonAnswerLine(clean)) return false;

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
// maxLines defaults to MAX_LINES_PER_CALL; both real callers (server/summarization.js and the
// client drivers) pass RUNAWAY_LINE_GUARD explicitly instead, because a flat cap of three silently
// discarded the tail of a long testimony (measured: 8 lines returned, 5 dropped, no error and no
// telemetry).
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
