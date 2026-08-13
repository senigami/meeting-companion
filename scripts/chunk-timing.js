#!/usr/bin/env node
// Derived timing statistics from real recorded sessions (#72). Prints the distribution of gaps
// between consecutive chunk releases, which is the only timing evidence already on disk.
//
// READ THIS BEFORE TRUSTING THE OUTPUT. What this measures is the release behaviour of the
// segmenter, NOT the pause structure of human speech. A chunk's timestamp is when the segmenter
// decided to release it, and that decision is made by the very constants #72 wants to check
// (SOFT_SEGMENT_SECONDS, MAX_SEGMENT_SECONDS, redemptionMs in transcription/openai.js). Any pause
// shorter than the redemption window was swallowed before it was ever recorded, so the real
// distribution of natural pauses cannot be recovered from these files at all. That half of #72 needs
// subtitle timings from a real talk, or real audio.
//
// What it CAN answer, and what it was written for: whether the soft window finds a cut or falls
// through to the backstop. A gap clustering near SOFT_SEGMENT_SECONDS means the window fired; a gap
// near MAX_SEGMENT_SECONDS means it fell through and the backstop released the segment instead. That
// question was previously answerable only by reasoning.
//
// Long gaps are not backstop hits. A gap of minutes is the operator having stopped listening, or a
// genuine silence in the room, and it is reported separately rather than folded into the buckets.
//
// Usage: node scripts/chunk-timing.js [dir-or-file ...] [--json]

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

import { parseRecordingLines } from './lib/recording-summary.js';

const REPO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// Mirrors the segmenter's own constants so the buckets mean something. Kept as literals rather than
// imported: transcription/openai.js is a browser module built around Web Audio and a VAD bundle, and
// importing it in node to read two numbers would pull all of that in. The cost is that these can
// drift from the real values, so they are printed in the output where a reader can check them.
const SOFT_SEGMENT_SECONDS = 5;
const MAX_SEGMENT_SECONDS = 30;
// Past this a gap is a stop or a real silence in the room, not a segmenter decision. Comfortably
// clear of MAX_SEGMENT_SECONDS so a genuine backstop hit is never counted as an idle stretch.
const IDLE_GAP_SECONDS = 60;

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function median(sorted) {
  return percentile(sorted, 0.5);
}

export function chunkTimingStats(records = []) {
  const chunks = records
    .filter((record) => record.t === 'chunk' && record.at)
    .map((record) => ({ at: Date.parse(record.at), words: String(record.text || '').trim().split(/\s+/).filter(Boolean).length }))
    .filter((chunk) => Number.isFinite(chunk.at))
    .sort((a, b) => a.at - b.at);

  const gaps = [];
  const idleGaps = [];
  for (let i = 1; i < chunks.length; i += 1) {
    const seconds = (chunks[i].at - chunks[i - 1].at) / 1000;
    if (seconds <= 0) continue;
    if (seconds >= IDLE_GAP_SECONDS) idleGaps.push(seconds);
    else gaps.push(seconds);
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const words = chunks.map((chunk) => chunk.words).sort((a, b) => a - b);

  // "Fell through" is the question #72 asks. A release at or past the backstop means the segmenter
  // never found a quiet frame to cut at, so the speaker was held for the full window.
  const fellThrough = gaps.filter((seconds) => seconds >= MAX_SEGMENT_SECONDS - 2).length;
  const nearSoftWindow = gaps.filter((seconds) => seconds >= SOFT_SEGMENT_SECONDS - 2 && seconds <= SOFT_SEGMENT_SECONDS + 2).length;

  return {
    chunkCount: chunks.length,
    gapCount: gaps.length,
    idleGapCount: idleGaps.length,
    longestIdleGapSeconds: idleGaps.length ? Math.round(Math.max(...idleGaps)) : null,
    medianGapSeconds: median(sorted),
    p90GapSeconds: percentile(sorted, 0.9),
    maxGapSeconds: sorted.length ? sorted[sorted.length - 1] : null,
    nearSoftWindow,
    fellThrough,
    medianWords: median(words),
    p90Words: percentile(words, 0.9),
    maxWords: words.length ? words[words.length - 1] : null
  };
}

function round(value) {
  return value === null ? '-' : (Math.round(value * 10) / 10).toFixed(1);
}

async function collectFiles(args) {
  const targets = args.filter((arg) => !arg.startsWith('--'));
  if (targets.length === 0) targets.push(join(REPO_DIR, 'recordings'));

  const files = [];
  for (const target of targets) {
    if (target.endsWith('.ndjson')) {
      files.push(target);
      continue;
    }
    const names = (await readdir(target)).filter((name) => name.endsWith('.ndjson')).sort();
    for (const name of names) files.push(join(target, name));
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');

  let files;
  try {
    files = await collectFiles(args);
  } catch (error) {
    console.error(`Cannot read recordings: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const file of files) {
    const { records } = parseRecordingLines(await readFile(file, 'utf8'));
    const stats = chunkTimingStats(records);
    // A session with almost no chunks says nothing about a distribution, and averaging it in with a
    // real one would quietly weaken the evidence rather than strengthen it.
    if (stats.gapCount >= 20) rows.push({ session: basename(file, '.ndjson'), ...stats });
  }

  if (asJson) {
    console.log(JSON.stringify({ softSegmentSeconds: SOFT_SEGMENT_SECONDS, maxSegmentSeconds: MAX_SEGMENT_SECONDS, sessions: rows }, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('No session had at least 20 chunk gaps, which is too few to say anything about a distribution.');
    return;
  }

  console.log(`Segmenter release timing. Soft window ${SOFT_SEGMENT_SECONDS}s, backstop ${MAX_SEGMENT_SECONDS}s.\n`);
  console.log('session                     gaps  median   p90   max  near-soft  fell-through  med.words');
  for (const row of rows) {
    console.log(
      `${row.session.padEnd(26)} ${String(row.gapCount).padStart(5)} ${round(row.medianGapSeconds).padStart(6)} ${round(row.p90GapSeconds).padStart(6)} ${round(row.maxGapSeconds).padStart(5)} ${String(row.nearSoftWindow).padStart(10)} ${String(row.fellThrough).padStart(13)} ${String(row.medianWords).padStart(10)}`
    );
    if (row.idleGapCount > 0) {
      console.log(`${' '.repeat(26)} ${row.idleGapCount} gap(s) over ${IDLE_GAP_SECONDS}s excluded as stops or room silence (longest ${row.longestIdleGapSeconds}s).`);
    }
  }

  console.log('');
  console.log('near-soft = releases within 2s of the soft window, so the segmenter found a cut.');
  console.log('fell-through = releases at or near the backstop, so it never found one and held the speaker.');
  console.log('');
  console.log('This measures the segmenter, NOT human speech. Pauses shorter than the redemption window');
  console.log('were swallowed before being recorded, so the real pause distribution is not in these files.');
  console.log('That half of #72 needs subtitle timings from a real talk, or real audio.');
}

// Only run the CLI when this file IS the program. chunkTimingStats is imported by its test, and
// without this guard that import ran main(), read every real recording off disk, and printed the whole
// table into the test output.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`chunk-timing failed: ${error.message}`);
    process.exitCode = 1;
  });
}
