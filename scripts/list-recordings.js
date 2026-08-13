#!/usr/bin/env node
// One line per recording, so ADR-0004's retention rule is actually workable (#8). The rule keeps a
// recording until it has been used for tuning and then deletes it, deliberately by hand, because
// only a person can judge when a recording's value is spent. Nothing supported making that judgment:
// to tell whether a file was still worth reading you had to open it, and replay-recording.js reports
// on one file at a time and only if you already know which.
//
// Deleting stays `rm`, per the issue. The gap was seeing, not deleting.
//
// Usage: node scripts/list-recordings.js [dir] [--json]
//   Default dir is recordings/ relative to the repo, not to cwd.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

import { resolveAppCommit } from '../server/app-commit.js';
import { parseRecordingLines, summarizeRecording, formatLoss } from './lib/recording-summary.js';

// Resolved against this script's own directory rather than process.cwd(), for the same reason
// replay-recording.js does it: the script gets run by absolute path from elsewhere, and asking git
// about whatever directory the operator is standing in would compare recordings against a different
// repository (or none) and print a confident, wrong staleness verdict.
const REPO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function shortCommit(commit) {
  if (!commit || commit === 'unknown') return 'unknown';
  const dirty = commit.endsWith('-dirty');
  const bare = dirty ? commit.slice(0, -'-dirty'.length) : commit;
  return bare.slice(0, 8) + (dirty ? '-dirty' : '');
}

function formatDuration(firstAt, lastAt) {
  if (!firstAt || !lastAt) return '?';
  const ms = Date.parse(lastAt) - Date.parse(firstAt);
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const minutes = Math.round(ms / 60000);
  return minutes < 1 ? '<1m' : `${minutes}m`;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function padLeft(value, width) {
  const text = String(value);
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

async function readOne(dir, name) {
  const path = join(dir, name);
  try {
    const raw = await readFile(path, 'utf8');
    const { records, unparseable } = parseRecordingLines(raw);
    return { name, path, ...summarizeRecording(records, { unparseable }) };
  } catch (error) {
    // One unreadable file must not hide every other file's counts, which is the whole point of a
    // listing. Report it in place and keep going.
    return { name, path, readError: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const dirArg = args.find((arg) => !arg.startsWith('--'));
  const dir = dirArg ? dirArg : join(REPO_DIR, 'recordings');

  let names;
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.ndjson')).sort();
  } catch (error) {
    console.error(`Cannot read ${dir}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const name of names) rows.push(await readOne(dir, name));

  if (asJson) {
    console.log(JSON.stringify({ dir, currentCommit: resolveAppCommit(REPO_DIR), recordings: rows }, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log(`No recordings in ${dir}.`);
    return;
  }

  const currentCommit = resolveAppCommit(REPO_DIR);

  console.log(`${rows.length} recording(s) in ${dir}\n`);
  console.log(
    `${pad('session', 26)} ${padLeft('mins', 5)} ${padLeft('chunks', 6)} ${padLeft('calls', 5)} ${padLeft('failed', 6)} ${padLeft('short', 5)} ${padLeft('lost', 5)}  ${pad('commit', 16)} prompt`
  );

  for (const row of rows) {
    const session = basename(row.name, '.ndjson');
    if (row.readError) {
      console.log(`${pad(session, 26)} UNREADABLE: ${row.readError}`);
      continue;
    }

    const header = row.header;
    // "unknown" rather than blank: a recording made before the header field existed must say so, not
    // read as though it matched (issue #4's own requirement that old recordings still replay).
    const commit = shortCommit(header?.appCommit);
    const stale = header?.appCommit && header.appCommit !== 'unknown' && currentCommit !== 'unknown' && header.appCommit !== currentCommit;

    console.log(
      `${pad(session, 26)} ${padLeft(formatDuration(row.firstAt, row.lastAt), 5)} ${padLeft(row.chunkCount, 6)} ${padLeft(row.summaryCount, 5)} ${padLeft(row.failedCount, 6)} ${padLeft(row.shortenedCount, 5)} ${padLeft(formatLoss(row), 5)}  ${pad(commit + (stale ? '*' : ''), 16)} ${header?.promptHash || 'unknown'}`
    );

    if (row.unparseable > 0) {
      console.log(`${' '.repeat(26)} note: ${row.unparseable} unreadable line(s), so the counts above are a floor, not a total.`);
    }
    if (row.clientLost > 0) {
      console.log(`${' '.repeat(26)} WARNING: ${row.clientLost} line(s) discarded CLIENT-side, which should be impossible (the #63 shape).`);
    }
  }

  console.log('');
  console.log('lost = lines of real speech dropped by a line cap and never displayed. n/r = the recording');
  console.log('predates that count (#58), so nobody was counting. It is not the same as zero.');
  console.log(`* = recorded under a different commit than the current checkout (${shortCommit(currentCommit)}), so the`);
  console.log('  prompt or pipeline may have changed since. Read those with replay-recording.js before trusting them.');
}

main().catch((error) => {
  console.error(`list-recordings failed: ${error.message}`);
  process.exitCode = 1;
});
