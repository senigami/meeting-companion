#!/usr/bin/env node
// Reader/replay helper for the debugging/tuning recorder (ADR-0004, backlog items 2-3). Loads one
// session's ndjson file and prints each summary line paired with the chunk text it consumed, so a
// real meeting can be read back and correlated by eye without hand-parsing the file.
//
// This is deliberately NOT the "full replay transcription source" from backlog item 2 (a driver
// that re-feeds a recorded session through the live pipeline at its original timing) -- that is a
// separate, larger piece of work and out of scope here. This script only reads and correlates what
// was already recorded.
//
// Usage: node scripts/replay-recording.js recordings/<session-id>.ndjson [--json]

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { resolveAppCommit } from '../server/app-commit.js';
import { parseRecordingLines, summarizeRecording } from './lib/recording-summary.js';

// Resolved against THIS script's own directory, not process.cwd(): the script is routinely run by
// absolute path from somewhere else, and asking git about whatever directory the operator happens
// to be standing in would compare the recording against a different repository (or none) and print
// a confident, wrong staleness warning.
const REPO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function printHeader(header) {
  if (!header) {
    // Explicit, not silent: an old recording with no header must say so rather than being read as
    // "matched" or quietly skipped -- issue #4's own requirement that old recordings still replay.
    console.log('No header record (recorded before this field existed) -- commit/prompt/settings unknown.\n');
    return;
  }

  console.log(`header: commit=${header.appCommit} promptHash=${header.promptHash} maxWords=${header.maxWords} provider=${header.provider} intervalSeconds=${header.intervalSeconds}`);

  const currentCommit = resolveAppCommit(REPO_DIR);
  if (header.appCommit === 'unknown' || currentCommit === 'unknown') {
    console.log(`(commit comparison skipped: recorded=${header.appCommit}, current=${currentCommit})\n`);
  } else if (header.appCommit !== currentCommit) {
    console.log(`WARNING: this recording was made under commit ${header.appCommit}, but the current checkout is at ${currentCommit}. The prompt or pipeline may have changed since -- treat this recording as possibly stale.\n`);
  } else {
    console.log('(recorded commit matches the current checkout)\n');
  }
}

async function main() {
  const [, , filePath, ...flags] = process.argv;
  if (!filePath) {
    console.error('Usage: node scripts/replay-recording.js <path-to-session.ndjson> [--json]');
    process.exitCode = 1;
    return;
  }

  const asJson = flags.includes('--json');
  const raw = await readFile(filePath, 'utf8');
  // Parsing moved into the shared reader (#8), which also stopped this crashing outright on a
  // session that ended in a hard quit: the file is appended a line at a time, so a partial last line
  // is a normal file, and JSON.parse over every line threw and printed nothing at all.
  const { records, unparseable } = parseRecordingLines(raw);
  if (unparseable > 0 && !asJson) {
    console.log(`NOTE: ${unparseable} line(s) could not be parsed and are not counted below. A partial last line usually means the session ended abruptly.\n`);
  }

  const header = records.find((record) => record.t === 'header') || null;
  if (!asJson) printHeader(header);

  const chunksById = new Map();
  for (const record of records) {
    if (record.t === 'chunk') chunksById.set(record.id, record);
  }

  const pairs = records
    .filter((record) => record.t === 'summary')
    .map((summary) => ({
      at: summary.at,
      mode: summary.mode,
      ok: summary.ok,
      wasShortened: summary.wasShortened,
      discardedByCap: summary.discardedByCap,
      discardedByCapClient: summary.discardedByCapClient,
      latencyMs: summary.latencyMs,
      sent: summary.sent,
      returned: summary.returned,
      error: summary.error,
      consumedChunks: (summary.consumedIds || [])
        .map((id) => chunksById.get(id))
        .filter(Boolean)
        .map((chunk) => chunk.text)
    }));

  if (asJson) {
    console.log(JSON.stringify({ header, pairs }, null, 2));
    return;
  }

  // A count written and never read is the same failure the count exists to fix. This tool is the human
  // facing reader of a recording, and it surfaced wasShortened while saying nothing about discarded
  // lines -- so a session that silently dropped four announcements printed "0 shortened" and looked
  // clean, which is exactly how #49, #63 and #65 each survived being fixed. Found by Cato (#58).
  //
  // Counted in scripts/lib/recording-summary.js as of #8, shared with list-recordings.js. Two tools
  // printing the same numbers from two implementations is how they come to disagree, and the cheap
  // one is the one people trust.
  const counts = summarizeRecording(records, { unparseable });
  const { chunkCount, summaryCount, manualCount, failedCount, shortenedCount, linesLost, clientLost } = counts;
  const lossText = counts.countWasRecorded ? `${linesLost} line(s) DISCARDED` : 'discards NOT RECORDED (predates this field)';

  console.log(`${chunkCount} chunk(s), ${summaryCount} summarize call(s), ${failedCount} failed, ${shortenedCount} shortened, ${lossText}.\n`);
  // Counted and named, but deliberately NOT replayed (#139). A manual line never went through the
  // pipeline this tool replays -- the operator typed it straight onto the wall -- so feeding it back
  // through the summarizer would invent a call that never happened. Saying so is the point: a replay
  // that silently omitted them read as a complete account of the meeting, and was not one.
  if (manualCount > 0) {
    console.log(`NOTE: ${manualCount} line(s) were typed by the operator. They are in the recording but are not replayed, because they never went through the summarizer.\n`);
  }
  if (linesLost > 0) {
    console.log(`WARNING: ${linesLost} line(s) of real speech never reached the display, dropped by a line cap.\n`);
  }
  if (clientLost > 0) {
    console.log(`WARNING: ${clientLost} line(s) were discarded by the CLIENT, which should never happen -- the server and client disagree about how many lines may survive (the #63 shape).\n`);
  }

  for (const pair of pairs) {
    console.log(`--- ${pair.at} [${pair.mode || 'unknown mode'}] ${pair.ok ? 'ok' : `FAILED: ${pair.error}`} ---`);
    console.log(`sent:     ${pair.sent}`);
    console.log(`returned: ${pair.returned || '(nothing)'}`);
    if (pair.wasShortened) console.log('(line was shortened to fit the display limit)');
    if (pair.discardedByCap > 0) console.log(`(${pair.discardedByCap} line(s) DISCARDED by the line cap and never shown)`);
    if (pair.discardedByCapClient > 0) console.log(`(${pair.discardedByCapClient} discarded client-side, which should be impossible)`);
    if (typeof pair.latencyMs === 'number') console.log(`latency:  ${pair.latencyMs}ms`);
    console.log('');
  }
}

main().catch((error) => {
  console.error(`replay-recording failed: ${error.message}`);
  process.exitCode = 1;
});
