#!/usr/bin/env node
// Simulates a whole meeting through the REAL summarization pipeline (partitionBucket ->
// takeOldestModeRun -> summarizeWithSource), on a virtual clock, so prompt quality can be judged
// without anyone speaking into a microphone and without waiting out real meeting-length gaps.
//
// Source material is the scripted 44-line meeting in public/services/transcription/demo.js,
// imported rather than duplicated. Timing is derived, not simulated by waiting: 150 words per
// minute of speech plus a 900ms gap between utterances, exactly as described in the harness brief
// (a close cousin of, but simpler than, demo.js's own natural-pause model, which this script does
// not need since nothing here streams word-by-word).
//
// Usage: node scripts/simulate-meeting.js [--prompt current|variant] [--speed N]
// --speed is accepted but ignored for waiting -- there is no real waiting to scale, only a virtual
// clock -- and exists purely so a future caller can scale the (currently fixed) 900ms virtual gap.

import 'dotenv/config';
import OpenAI from 'openai';

import { DEMO_SCRIPT } from '../public/services/transcription/demo.js';
import { partitionBucket, takeOldestModeRun, removeConsumed, BUCKET_SETTLE_MS } from '../public/services/transcript-bucket.js';
import { normalizeText } from '../public/services/text.js';
import { createTranscriptItems, appendTranscriptItems } from '../public/services/transcript-display.js';
import { summarizeWithSource } from '../server/summarization.js';

const WORDS_PER_MINUTE = 150;
const GAP_MS = 900;
const TICK_MS = 5000;
// Experiment knob: hold a summarize call until at least this many words have accumulated, so a
// card is built from a thought rather than a single sentence. 0 reproduces today's behaviour.
const MIN_WORDS = Number(process.argv.find((a) => a.startsWith('--minwords='))?.split('=')[1] || 0);

function parseArgs(argv) {
  const args = { prompt: 'current', speed: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--prompt') args.prompt = argv[++i];
    else if (argv[i] === '--speed') args.speed = Number(argv[++i]) || 1;
  }
  return args;
}

function truncate(text, max) {
  const clean = String(text || '');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function wordCount(text) {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.prompt !== 'current' && args.prompt !== 'variant') {
    console.error(`Unknown --prompt value "${args.prompt}". Use "current" or "variant".`);
    process.exitCode = 1;
    return;
  }

  if (args.prompt === 'variant') {
    let variantModule;
    try {
      variantModule = await import('../public/services/summary-prompt-variant.js');
    } catch (_error) {
      console.error(
        'public/services/summary-prompt-variant.js does not exist on this branch -- there is no ' +
          '"variant" prompt to run. Add that file (exporting buildSummarizePromptVariant) before ' +
          'using --prompt variant.'
      );
      process.exitCode = 1;
      return;
    }
    if (typeof variantModule.buildSummarizePromptVariant !== 'function') {
      console.error(
        'public/services/summary-prompt-variant.js exists but does not export buildSummarizePromptVariant.'
      );
      process.exitCode = 1;
      return;
    }
    // Nothing further to do here today: server/summarization.js has no seam for injecting an
    // alternate prompt builder, and the brief is explicit that this module is not to be
    // restructured to add one speculatively. If --prompt variant is needed for real, that seam is
    // the smallest honest follow-up, not something to bolt on for a file that does not exist yet.
    console.error(
      'summary-prompt-variant.js was found, but server/summarization.js has no prompt-builder ' +
        'injection seam yet, and this harness does not add one speculatively. Wire the seam first.'
    );
    process.exitCode = 1;
    return;
  }

  const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  if (!openaiClient) {
    console.error('OPENAI_API_KEY is not set (checked via dotenv/config). Nothing to call.');
    process.exitCode = 1;
    return;
  }

  // Virtual clock -- no real waiting anywhere in this script.
  let now = 0;
  let bucket = [];
  let mode = DEMO_SCRIPT[0]?.mode || 'speaker';
  let lastSentText = '';
  let lastSentBlock = null; // { text, mode }
  let transcriptItems = [];

  const calls = [];
  let summarizeCalls = 0;
  let cardsProduced = 0;
  let emptyCalls = 0;
  let wordsDisplayed = 0;

  async function runTick({ settleMs = BUCKET_SETTLE_MS, force = false } = {}) {
    const { consumable } = partitionBucket(bucket, { now, settleMs });
    if (!force && MIN_WORDS > 0) {
      const words = consumable.map((c) => c.text).join(' ').trim().split(/\s+/).filter(Boolean).length;
      if (words < MIN_WORDS) return;
    }
    if (!consumable.length) return;

    const run = takeOldestModeRun(consumable, { defaultMode: mode });
    if (!run.text) return;

    const recent = run.text;
    if (recent === lastSentText) return;

    const sendMode = run.mode;
    const previousBlock =
      lastSentBlock && lastSentBlock.mode === sendMode ? lastSentBlock.text : '';
    const visibleLines = transcriptItems.slice(-10).map((item) => item.text);

    let result;
    let error = null;
    try {
      result = await summarizeWithSource({
        source: 'openai',
        mode: sendMode,
        recentTranscript: recent,
        previousBlock,
        visibleLines,
        openaiClient
      });
    } catch (err) {
      error = err;
      result = { line: '' };
    }

    summarizeCalls += 1;
    const lines = result.line ? result.line.split('\n').filter(Boolean) : [];

    calls.push({
      at: now,
      mode: sendMode,
      chunkCount: run.chunks.length,
      recentTranscript: recent,
      lines,
      error
    });

    if (!lines.length) emptyCalls += 1;

    lastSentText = recent;
    lastSentBlock = { text: recent, mode: sendMode };
    bucket = removeConsumed(bucket, run.chunks);

    if (result.line) {
      const nextItems = createTranscriptItems({ text: result.line, mode: sendMode, source: 'ai', createdAt: now });
      transcriptItems = appendTranscriptItems(transcriptItems, nextItems);
      cardsProduced += nextItems.length;
      nextItems.forEach((item) => {
        wordsDisplayed += wordCount(item.text);
      });
    }
  }

  let nextTickAt = TICK_MS;

  for (const entry of DEMO_SCRIPT) {
    if (entry.mode) mode = entry.mode;
    if (entry.pauseBeforeMs) now += entry.pauseBeforeMs;

    bucket = [...bucket, { at: now, text: entry.text, mode }];

    const durationMs = (wordCount(entry.text) / WORDS_PER_MINUTE) * 60 * 1000;
    now += durationMs + GAP_MS;

    while (now >= nextTickAt) {
      await runTick();
      nextTickAt += TICK_MS;
    }
  }

  // Final drain, the way stopListening does: settleMs: 0 forces everything still sitting in the
  // bucket to be treated as settled.
  await runTick({ settleMs: 0, force: true });

  console.log('=== Summarize calls ===');
  calls.forEach((call, index) => {
    console.log(`\n[${index + 1}] t=${Math.round(call.at)}ms mode=${call.mode} chunksConsumed=${call.chunkCount}`);
    console.log(`  recentTranscript: ${truncate(call.recentTranscript, 160)}`);
    if (call.error) {
      console.log(`  ERROR: ${call.error?.message || call.error}`);
    } else if (!call.lines.length) {
      console.log('  (no lines returned)');
    } else {
      call.lines.forEach((line) => {
        console.log(`  -> "${line}" (${wordCount(line)} words)`);
      });
    }
  });

  console.log('\n=== Cards as displayed ===');
  if (!transcriptItems.length) {
    console.log('(no cards were displayed)');
  } else {
    transcriptItems.forEach((item) => console.log(item.text));
  }

  console.log('\n=== Summary ===');
  console.log(`Utterances in: ${DEMO_SCRIPT.length}`);
  console.log(`Summarize calls made: ${summarizeCalls}`);
  console.log(`Cards produced: ${cardsProduced}`);
  console.log(`Cards that came back empty: ${emptyCalls}`);
  console.log(`Total words displayed: ${wordsDisplayed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
