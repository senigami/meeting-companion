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

  console.log(`${chunkCount} chunk(s), ${summaryCount} summarize call(s), ${failedCount} failed, ${shortenedCount} shortened.\n`);

  for (const pair of pairs) {
    console.log(`--- ${pair.at} [${pair.mode || 'unknown mode'}] ${pair.ok ? 'ok' : `FAILED: ${pair.error}`} ---`);
    console.log(`sent:     ${pair.sent}`);
    console.log(`returned: ${pair.returned || '(nothing)'}`);
    if (pair.wasShortened) console.log('(line was shortened to fit the display limit)');
    if (typeof pair.latencyMs === 'number') console.log(`latency:  ${pair.latencyMs}ms`);
    console.log('');
  }
}

main().catch((error) => {
  console.error(`replay-recording failed: ${error.message}`);
  process.exitCode = 1;
});
