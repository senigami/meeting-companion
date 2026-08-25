// Client-side half of the debugging/tuning recorder (ADR-0004, backlog items 2-3;
// server/session-recorder.js is the other half, and does the actual disk writes). Pure,
// dependency-free functions only -- no fetch calls here. The network call and its
// never-throw-into-the-pipeline handling live in runtime.js, right next to summarizeCurrentText,
// where that discipline already exists for INV-11.

const SESSION_ID_UNSAFE = /[^A-Za-z0-9_-]/g;

// One id per app session (not per meeting "run"), derived from a capture-time timestamp so files
// sort chronologically on disk. Must stay inside server/session-recorder.js's SAFE_SESSION_ID
// allow-list -- non-alphanumeric ISO characters (`:`, `.`) are replaced with `-` here so the id is
// already safe before it ever reaches the network.
export function createRecordingSessionId(at = Date.now()) {
  return new Date(at).toISOString().replace(SESSION_ID_UNSAFE, '-');
}

// The "audio to text" side: one final transcription chunk, exactly as captured. `id` is the
// chunk's own capture timestamp (already unique per chunk -- see appendUniqueChunk/nowFn in
// runtime.js) so a summary record's consumedIds can point back at the exact chunks it drained,
// without inventing a second id scheme.
// `inferred` (default false) marks a record whose text was NOT what the speech engine reported --
// currently only the sentence-end-on-silence follow-up in runtime.js, which appends a period after
// SENTENCE_END_SILENCE_MS of no recognition events and re-queues a record sharing the same `id` so
// it can be tied back to the original, byte-verbatim spoken record. Never silently fabricate text
// into these recordings without this flag -- they are the evidence used to compare microphones and
// prompts, and an unmarked inferred character would poison that comparison.
// `speaker` (issue #40): the operator-typed name active when this chunk was captured, so a replay
// of the recording reproduces the same speaker labels the operator actually saw, not whatever name
// happens to be in the field when the recording is replayed back through the pipeline.
// One header record, written once and first per session file (issue #4 / ADR-0004). It exists so a
// file that outlives the prompt/build it was recorded under can be recognised as stale by READING
// it, rather than by remembering which meeting used which commit. Metadata only, never the prompt
// text itself, never any transcript, never any part of a key (INV-8/INV-12) -- a hash of the prompt
// is the whole point: it changes when the prompt changes without ever carrying its words.
export function buildHeaderRecord({
  at = Date.now(),
  appCommit = 'unknown',
  promptHash = 'unknown',
  maxWords = null,
  provider = '',
  intervalSeconds = null,
  displayCap = null
} = {}) {
  return {
    t: 'header',
    at: new Date(at).toISOString(),
    appCommit: appCommit || 'unknown',
    promptHash: promptHash || 'unknown',
    maxWords: typeof maxWords === 'number' ? maxWords : null,
    provider: provider || '',
    intervalSeconds: typeof intervalSeconds === 'number' ? intervalSeconds : null,
    // Eighth key, added with the card records (#142). It is here rather than in a replay tool
    // because it is a property OF THIS RECORDING: the cap has already changed once, and a tool
    // hardcoding today's number would silently misreplay every file written under a different one.
    // Null on a recording made before this field existed, which a replay must read as "unknown",
    // never as "no cap".
    displayCap: typeof displayCap === 'number' ? displayCap : null
  };
}

export function buildChunkRecord({ at, mode, text, speaker = null, inferred = false }) {
  return {
    t: 'chunk',
    at: new Date(at).toISOString(),
    id: String(at),
    mode: mode || null,
    speaker: speaker || null,
    text: text || '',
    inferred: Boolean(inferred)
  };
}

// The "text to summary" side: what was actually sent to the provider and what came back, tied to
// the chunk ids it consumed. `wasShortened` must be passed through verbatim from
// server/summarization.js's own before/after shortenToLimit comparison -- it is the only direct
// measurement of whether the prompt-side length fix in 909fe1e is doing anything.
export function buildSummaryRecord({
  at,
  mode,
  consumedIds = [],
  hadPreviousBlock = false,
  sent = '',
  returned = '',
  provider = '',
  ok = false,
  error = null,
  latencyMs = null,
  wasShortened = false,
  verbatim = false,
  discardedByCap = 0,
  discardedByCapClient = 0
}) {
  return {
    t: 'summary',
    at: new Date(at).toISOString(),
    mode: mode || null,
    consumedIds: consumedIds.map(String),
    hadPreviousBlock: Boolean(hadPreviousBlock),
    sent,
    returned,
    provider,
    ok: Boolean(ok),
    error: error || null,
    latencyMs: typeof latencyMs === 'number' ? latencyMs : null,
    wasShortened: Boolean(wasShortened),
    verbatim: Boolean(verbatim),
    // Separate from wasShortened deliberately (#58). Shortening trims a line's characters and the line
    // still arrives; a discard means real speech never reached the reader. Three successive silent-loss
    // defects (#49, #63, #65) each looked like a clean call in this record because only the first of
    // those two failures was ever written down.
    discardedByCap: Number(discardedByCap) || 0,
    // Should always be 0. If it is not, the server and the client disagree about how many lines may
    // survive, which is the #63 shape and worth its own field rather than being summed away.
    discardedByCapClient: Number(discardedByCapClient) || 0
  };
}

// A correction is additive, never destructive: the summary record it targets stays in the file
// exactly as recorded, and this is the only durable trace that a human later decided it didn't
// belong in the report. `targetAt` is the corrected summary record's own `at` (already unique per
// summary, same idiom buildChunkRecord's `id` uses against a chunk) -- a row NUMBER would break the
// moment an earlier correction shifted the numbering, so this points at the record itself, not its
// position. `reason` is free text because "why" is exactly the fact this record exists to keep;
// recording the removal with no reason would just be a second, less honest way to delete a line.
export function buildCorrectionRecord({ at = Date.now(), targetAt, reason = '' }) {
  return {
    t: 'correction',
    at: new Date(at).toISOString(),
    targetAt: targetAt ? new Date(targetAt).toISOString() : null,
    reason: reason || ''
  };
}

// The recorded "mode" is one of four generic buckets (speaker/information/song/prayer), never who
// is actually talking -- speaker identity isn't captured on a summary record at all (only on a
// chunk, and only when the operator typed a name). Two different people can talk back-to-back
// inside one long "speaker" mode block with nothing in the data to mark the handoff, so a human who
// was actually in the room is the only source for where those breaks belong. Same targetAt idiom as
// buildCorrectionRecord, for the same reason: a row number shifts, a record's own timestamp doesn't.
export function buildSpeakerBreakRecord({ at = Date.now(), targetAt }) {
  return {
    t: 'speaker-break',
    at: new Date(at).toISOString(),
    targetAt: targetAt ? new Date(targetAt).toISOString() : null
  };
}

// A line the operator typed rather than one the app heard: "Show now", a program header send, and
// the fixed "Music is playing." line all land here. Until #135 these left no trace in the recording
// at all -- not logged imperfectly, logged nowhere -- so a session review or a replay showed only
// what the AI produced and silently omitted everything a human put on the wall beside it. That is
// the one class of card guaranteed to be correct, and it was the one class missing from the record.
// `text` is stored exactly as addLine normalized it (newline-separated when one send produced
// several cards), because what is worth keeping is what the reader actually saw.
export function buildManualLineRecord({ at = Date.now(), mode, text, speaker = null, isHeader = false }) {
  return {
    t: 'manual',
    at: new Date(at).toISOString(),
    mode: mode || null,
    speaker: speaker || null,
    text: text || '',
    isHeader: Boolean(isHeader)
  };
}

// --- What the reader actually read (#142) -------------------------------------------------------
//
// Everything above records what the app was TOLD and what a provider SAID. None of it records what
// ended up in front of the reader after the operator corrected it, and correcting it is the whole
// reason a human sits at the machine. Two of the three ways a card changes left no trace at all: an
// in-place edit (#125) wrote straight to state, and a live delete removed it silently. So a
// recording could say what the AI produced and could not say what was actually read.
//
// Keyed on the transcript item's own id rather than a row position, for the same reason
// buildCorrectionRecord uses targetAt: a position shifts the moment anything above it changes.
//
// WHAT A REPLAY GETS, stated precisely, because this is the spec a replay tool will be built from
// and an approximate version of it produces a wall the reader never saw. Applying card /
// card-edit / card-remove / card-restore in FILE order yields the READING HISTORY: every card ever
// shown, minus the ones a human took down. It is not the final wall on its own. Cards scrolling off
// past the display cap are deliberately unrecorded -- the reader saw them, and they left by
// scrolling rather than by anyone judging them wrong -- so after a long meeting the history holds
// far more cards than the screen ever did.
//
//   THE RULE: the wall at any point is the LAST `header.displayCap` survivors of the history, never
//   all of them. Skip it and a clear-after-trim replays as phantom cards: 30 land, the view silently
//   trims 6, the operator clears, and 24 removals applied to a 30-card model leave 6 cards standing
//   that were not on the screen.
//
// The cap is written into the header record rather than left as folklore, so a replay reads it from
// the file instead of hardcoding a number that has already moved once.
//
// Diffing the card records against the summaries they came from is the correction trail, and that
// part IS exact regardless of trimming: an edit records both what the AI said and what a human
// changed it to.

// One card that actually landed. Written per CARD, where a manual record is written per SEND -- one
// multi-line paste is one manual record and several cards, so the two are not redundant.
export function buildCardRecord({ at = Date.now(), cardId, mode, text, speaker = null, source = '', isHeader = false }) {
  return {
    t: 'card',
    at: new Date(at).toISOString(),
    cardId: cardId || null,
    mode: mode || null,
    speaker: speaker || null,
    source: source || '',
    text: text || '',
    isHeader: Boolean(isHeader)
  };
}

// `before` is kept, not just `after`. The point of this record is the comparison: what the AI said
// against what a human had to change it to. Storing only the corrected text throws away the half
// that says the summarizer got something wrong.
export function buildCardEditRecord({ at = Date.now(), cardId, before = '', after = '' }) {
  return {
    t: 'card-edit',
    at: new Date(at).toISOString(),
    cardId: cardId || null,
    before,
    after
  };
}

// `via` distinguishes the three routes off the wall, because they mean different things: 'delete' is
// the operator judging one specific card wrong, 'undo' is taking back the most recent thing, 'clear'
// is resetting the wall between segments. A card scrolling off past the display cap is NOT any of
// these and is never recorded -- the reader saw it, and it left by scrolling rather than by anyone
// deciding it should not have been there.
export function buildCardRemoveRecord({ at = Date.now(), cardId, text = '', via = '' }) {
  return {
    t: 'card-remove',
    at: new Date(at).toISOString(),
    cardId: cardId || null,
    text,
    via: via || ''
  };
}

// Undo after a Clear puts everything back. Without this a replay shows cards gone that are on the
// screen in front of the reader, which is the one thing this whole group of records exists to
// prevent.
export function buildCardRestoreRecord({ at = Date.now(), cardIds = [] }) {
  return {
    t: 'card-restore',
    at: new Date(at).toISOString(),
    cardIds: (Array.isArray(cardIds) ? cardIds : []).map(String)
  };
}
