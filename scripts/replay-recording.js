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

async function main() {
  const [, , filePath, ...flags] = process.argv;
  if (!filePath) {
    console.error('Usage: node scripts/replay-recording.js <path-to-session.ndjson> [--json]');
    process.exitCode = 1;
    return;
  }

  const asJson = flags.includes('--json');
  const raw = await readFile(filePath, 'utf8');
  const records = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

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
    console.log(JSON.stringify(pairs, null, 2));
    return;
  }

  const chunkCount = records.filter((r) => r.t === 'chunk').length;
  const summaryCount = pairs.length;
  const failedCount = pairs.filter((p) => !p.ok).length;
  const shortenedCount = pairs.filter((p) => p.wasShortened).length;
  // A count written and never read is the same failure the count exists to fix. This tool is the human
  // facing reader of a recording, and it surfaced wasShortened while saying nothing about discarded
  // lines -- so a session that silently dropped four announcements printed "0 shortened" and looked
  // clean, which is exactly how #49, #63 and #65 each survived being fixed. Found by Cato (#58).
  const linesLost = pairs.reduce((total, p) => total + (Number(p.discardedByCap) || 0), 0);
  const clientLost = pairs.reduce((total, p) => total + (Number(p.discardedByCapClient) || 0), 0);

  console.log(`${chunkCount} chunk(s), ${summaryCount} summarize call(s), ${failedCount} failed, ${shortenedCount} shortened, ${linesLost} line(s) DISCARDED.\n`);
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
