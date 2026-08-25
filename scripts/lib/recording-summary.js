// Shared reader for the debugging/tuning recorder's ndjson files (ADR-0004). Both
// scripts/replay-recording.js (one session in detail) and scripts/list-recordings.js (every session,
// one line each) count from here.
//
// Extracted rather than reimplemented on purpose. The counts these two tools print are the same
// counts, and this repo has already paid for two places disagreeing about how many lines survived
// (#58, #63): a listing that says a session is clean while the detail view says four lines were
// discarded is worse than having no listing, because the cheap view is the one people will trust.

// A recording is appended a line at a time while a meeting runs, so the last line of a session that
// ended in a crash or a hard quit can be a partial JSON object. That is a normal file on disk, not a
// corrupt one, and it must not take the reader down with it -- especially the listing, where one bad
// file would otherwise hide every other file's counts. Unparseable lines are counted and reported
// rather than swallowed: "I could not read 1 line" and "there was nothing there" are different facts.
export function parseRecordingLines(raw = '') {
  const records = [];
  let unparseable = 0;

  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      unparseable += 1;
    }
  }

  return { records, unparseable };
}

export function summarizeRecording(records = [], { unparseable = 0 } = {}) {
  const header = records.find((record) => record.t === 'header') || null;
  const chunks = records.filter((record) => record.t === 'chunk');
  const summaries = records.filter((record) => record.t === 'summary');
  // #139: manual lines were recorded from #135 onward but counted nowhere, so a session's stats
  // described the AI's half of the meeting and silently omitted the operator's -- which is the half
  // that is guaranteed correct, and often the half typed BECAUSE the AI got something wrong.
  const manuals = records.filter((record) => record.t === 'manual');

  const linesLost = summaries.reduce((total, s) => total + (Number(s.discardedByCap) || 0), 0);
  const clientLost = summaries.reduce((total, s) => total + (Number(s.discardedByCapClient) || 0), 0);

  // A recording made before #58 carries no discard count at all, and rendering that unknown as a
  // confident 0 is the same failure one step removed: the reader cannot tell "nothing was lost" from
  // "nobody was counting". Whether the field was RECORDED is a separate fact from its value.
  const countWasRecorded = summaries.some((s) => typeof s.discardedByCap === 'number');

  const times = records.map((record) => record.at).filter(Boolean).sort();

  return {
    header,
    unparseable,
    chunkCount: chunks.length,
    summaryCount: summaries.length,
    manualCount: manuals.length,
    failedCount: summaries.filter((s) => !s.ok).length,
    shortenedCount: summaries.filter((s) => s.wasShortened).length,
    linesLost,
    clientLost,
    countWasRecorded,
    firstAt: times[0] || null,
    lastAt: times[times.length - 1] || null
  };
}

// Rendered the same way in both tools so a session cannot read as clean in one and lossy in the
// other. "n/r" is not zero: it means the field predates #58 and nobody was counting.
export function formatLoss({ linesLost, countWasRecorded }) {
  if (!countWasRecorded) return 'n/r';
  return String(linesLost);
}
