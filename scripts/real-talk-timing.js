#!/usr/bin/env node
// The other half of #72: chunk-timing.js can only measure the segmenter's own release behaviour
// (see its header), never the pause structure of real human speech, because a pause shorter than
// the redemption window was swallowed before it was ever recorded. This script reads real subtitle
// timings from a real talk instead -- the one thing an invented fixture cannot supply.
//
// READ THIS BEFORE TRUSTING THE OUTPUT. Caption cues carry a START time each, not an end time, so a
// "gap" here is the interval between one cue starting and the next one starting -- which includes
// however long the first cue's own sentence took to say, not just the silence after it. That makes
// every gap an UPPER BOUND on the true pause length, never a measurement of it. A caption track
// cannot answer "how long was the silence" on its own; it can only rule out pauses longer than the
// gap it reports. Treat every number below in that light -- it is evidence, not ground truth.
//
// Fixture: scripts/fixtures/real-talk-caption-timing-2026-08-04.json -- cue start times and word
// counts only, extracted from the real talk's own manual captions (video linked in issue #72,
// Steve, 2026-08-04). No caption text is stored anywhere in this repo, per the issue's own
// copyright constraint: the words are someone else's; the timing is what's being measured.
//
// Usage: node scripts/real-talk-timing.js [--json]

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE_PATH = join(REPO_DIR, 'scripts/fixtures/real-talk-caption-timing-2026-08-04.json');

// Mirrored from transcription/openai.js, same reasoning as chunk-timing.js: importing a browser
// module built around Web Audio/a VAD bundle just to read two numbers costs more than the drift
// risk of a literal, and the values are printed below where a reader can check them.
const SOFT_SEGMENT_SECONDS = 5;
const MAX_SEGMENT_SECONDS = 30;
// Silero's own redemption window (openai.js's onFrameProcessed) -- the shortest pause the VAD is
// willing to treat as "still the same utterance" before it would consider releasing early.
const REDEMPTION_SECONDS = 2.5;

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function median(sorted) {
  return percentile(sorted, 0.5);
}

export function realTalkTimingStats(fixture) {
  const cues = [...(fixture.cues || [])].sort((a, b) => a.startSec - b.startSec);
  const gaps = [];
  for (let i = 1; i < cues.length; i += 1) {
    const gap = cues[i].startSec - cues[i - 1].startSec;
    if (gap > 0) gaps.push(gap);
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const totalWords = cues.reduce((sum, cue) => sum + cue.words, 0);

  // These count gaps that COULD have exceeded the window (an upper bound on the pause itself), not
  // gaps that definitely did -- see the file header. "At least N gaps this long" is the honest claim.
  const atLeastRedemption = gaps.filter((seconds) => seconds >= REDEMPTION_SECONDS).length;
  const atLeastSoftWindow = gaps.filter((seconds) => seconds >= SOFT_SEGMENT_SECONDS).length;
  const atLeastBackstop = gaps.filter((seconds) => seconds >= MAX_SEGMENT_SECONDS).length;

  return {
    cueCount: cues.length,
    durationSeconds: fixture.durationSeconds ?? (cues.length ? cues[cues.length - 1].startSec : null),
    totalWords,
    wordsPerSecond: fixture.durationSeconds ? +(totalWords / fixture.durationSeconds).toFixed(3) : null,
    gapCount: gaps.length,
    medianGapSeconds: median(sorted),
    p90GapSeconds: percentile(sorted, 0.9),
    maxGapSeconds: sorted.length ? sorted[sorted.length - 1] : null,
    gapsAtLeastRedemptionWindow: atLeastRedemption,
    gapsAtLeastSoftWindow: atLeastSoftWindow,
    gapsAtLeastBackstop: atLeastBackstop
  };
}

function round(value) {
  return value === null || value === undefined ? '-' : (Math.round(value * 10) / 10).toFixed(1);
}

async function main() {
  const asJson = process.argv.includes('--json');
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
  const stats = realTalkTimingStats(fixture);

  if (asJson) {
    console.log(JSON.stringify({ redemptionSeconds: REDEMPTION_SECONDS, softSegmentSeconds: SOFT_SEGMENT_SECONDS, maxSegmentSeconds: MAX_SEGMENT_SECONDS, source: fixture.source, ...stats }, null, 2));
    return;
  }

  console.log(`Real talk: ${fixture.source}`);
  console.log(`${stats.cueCount} cues over ${stats.durationSeconds}s, ${stats.totalWords} words (${round(stats.wordsPerSecond)} words/sec)`);
  console.log(`Cue-start gaps -- median ${round(stats.medianGapSeconds)}s, p90 ${round(stats.p90GapSeconds)}s, max ${round(stats.maxGapSeconds)}s`);
  console.log(`Gaps >= redemption window (${REDEMPTION_SECONDS}s): ${stats.gapsAtLeastRedemptionWindow} of ${stats.gapCount}`);
  console.log(`Gaps >= soft window (${SOFT_SEGMENT_SECONDS}s): ${stats.gapsAtLeastSoftWindow} of ${stats.gapCount}`);
  console.log(`Gaps >= backstop (${MAX_SEGMENT_SECONDS}s): ${stats.gapsAtLeastBackstop} of ${stats.gapCount}`);
  console.log('\nEvery gap above is an upper bound on the true pause (cue START to cue START, not silence-to-silence) -- see this file\'s header.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
