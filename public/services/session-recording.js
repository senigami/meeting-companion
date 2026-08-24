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
  intervalSeconds = null
} = {}) {
  return {
    t: 'header',
    at: new Date(at).toISOString(),
    appCommit: appCommit || 'unknown',
    promptHash: promptHash || 'unknown',
    maxWords: typeof maxWords === 'number' ? maxWords : null,
    provider: provider || '',
    intervalSeconds: typeof intervalSeconds === 'number' ? intervalSeconds : null
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
