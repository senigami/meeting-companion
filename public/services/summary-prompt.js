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

