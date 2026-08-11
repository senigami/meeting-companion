#!/usr/bin/env node
// Runs the curated hard-case library (scripts/fixtures/hard-cases.js) through the REAL
// summarization pipeline (server/summarization.js, the same code the app calls), against a real
// provider. Steve's request, 2026-08-09: a permanent battering test for future prompt/gating
// changes, run against the specific real cases that already broke once, alongside a normal-flow
// baseline so a fix to one hard case can't quietly break the ordinary path.
//
// This makes real API calls and costs real tokens -- it is not part of `npm test`, is not
// deterministic (LLM output varies run to run), and most of what it prints needs a human reading
// the output against each case's `expectation`/`knownShortcoming`, not a pass/fail assertion. The
// few checks that ARE mechanical (one card, non-empty, no gate-blocked filler, wildly over budget)
// are flagged inline; everything else is for you to read.
//
// 2026-08-10 (Steve): every run also writes a timestamped markdown report to test-reports/
// (gitignored, same rationale as recordings/ -- ADR-0004) pairing the raw source text with the
// summary it produced, prefaced with the exact prompt sent, so the results can be read and judged
// independently rather than taken on trust from a terminal scroll.
//
// Usage: node scripts/battering-test.js [caseName ...]
//   With no arguments, runs every case in ALL_CASES.
//   node scripts/battering-test.js REPETITION_PRONE_SPEAKER NON_ENGLISH_TESTIMONY

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { summarizeWithSource } from '../server/summarization.js';
import { hasSubstantiveContent } from '../public/services/summary-prompt.js';
import { buildMinimalSummarizePrompt } from '../public/services/summary-prompt-minimal.js';
import { ALL_CASES } from './fixtures/hard-cases.js';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is not set. This script makes real API calls and needs one.');
  process.exit(1);
}

const requested = process.argv.slice(2);
const cases = requested.length ? ALL_CASES.filter((c) => requested.includes(c.name)) : ALL_CASES;

if (requested.length && !cases.length) {
  console.error(`No case matched: ${requested.join(', ')}`);
  console.error(`Known cases: ${ALL_CASES.map((c) => c.name).join(', ')}`);
  process.exit(1);
}

function wordCount(line) {
  return line ? line.trim().split(/\s+/).filter(Boolean).length : 0;
}

// The literal prompt sent for this case's mode/level/word target -- built with a placeholder
// transcript so the rules are visible without one real chunk standing in for all of them.
function promptFor(def) {
  const full = buildMinimalSummarizePrompt({ recentTranscript: '<transcript chunk>', mode: def.mode, level: def.level, maxWords: def.maxWords });
  return full;
}

async function runCase(def) {
  const report = [];
  report.push(`# ${def.name}`);
  report.push('');
  report.push(`mode=${def.mode}  level=${def.level}  target=${def.maxWords} words`);
  report.push('');
  report.push(`**Description:** ${def.description}`);
  report.push('');
  report.push(`**Expect:** ${def.expectation}`);
  if (def.knownShortcoming) {
    report.push('');
    report.push(`**Known, accepted shortcoming:** ${def.knownShortcoming}`);
  }
  report.push('');
  report.push('## Prompt used');
  report.push('');
  report.push('```');
  report.push(promptFor(def));
  report.push('```');
  report.push('');
  report.push('## Results');

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${def.name}  (mode=${def.mode}, level=${def.level}, target=${def.maxWords}w)`);
  console.log(def.description);
  console.log(`Expect:  ${def.expectation}`);
  if (def.knownShortcoming) console.log(`Known:   ${def.knownShortcoming}`);
  console.log('-'.repeat(70));

  let history = [];
  const lines = [];
  for (const [i, chunk] of def.chunks.entries()) {
    report.push('');
    report.push(`### #${i + 1}`);
    report.push('');
    report.push('**Raw text:**');
    report.push('');
    report.push(`> ${chunk}`);
    report.push('');

    if (!hasSubstantiveContent(chunk)) {
      console.log(`#${i + 1} GATED (hasSubstantiveContent rejected this before any call): ${JSON.stringify(chunk)}`);
      report.push('**Summary:** _(gated -- hasSubstantiveContent rejected this before any call reached the model)_');
      continue;
    }
    const result = await summarizeWithSource({
      source: 'openai',
      mode: def.mode,
      recentTranscript: chunk,
      visibleLines: lines.slice(-12),
      maxWords: def.maxWords,
      level: def.level,
      history,
      openaiApiKey: apiKey
    });
    const line = result.line || '';
    const cardCount = line ? line.split('\n').filter(Boolean).length : 0;
    // Multiple cards from one call is a real bug for information/brief (server/summarization.js
    // enforces exactly one there) but is CORRECT, intended behaviour for prayer and speaker's
    // condense level -- packLinesIntoCards exists specifically to turn several thoughts into
    // several word-budgeted cards for those two. Flagging it there would read as a defect that
    // isn't one.
    const oneCardEnforced = def.level === 'brief' || def.mode === 'information';
    const flags = [];
    if (!line) flags.push('EMPTY');
    if (oneCardEnforced && cardCount > 1) flags.push(`${cardCount} CARDS FROM ONE CALL (should be 1)`);
    // Per CARD, not the joined total -- prayer/speaker condense can legitimately return several
    // cards, and summing their word counts against a PER-CARD target is comparing the wrong two
    // numbers (a real 4-card reply "should" total ~40w against a 10w-per-card budget; that is not
    // an overshoot, that is four cards each near budget).
    const overWords = line
      ? line.split('\n').filter(Boolean).map(wordCount).filter((n) => n > def.maxWords * 2)
      : [];
    if (overWords.length) flags.push(`card(s) at ${overWords.join('/')}w, over 2x target`);

    console.log(`#${i + 1} sent: ${chunk.slice(0, 90)}${chunk.length > 90 ? '...' : ''}`);
    console.log(`   got:  ${line || '(nothing)'}${flags.length ? '  [' + flags.join('; ') + ']' : ''}`);

    report.push('**Summary:**');
    report.push('');
    report.push(line ? `> ${line.split('\n').join('\n> ')}` : '_(empty)_');
    if (flags.length) {
      report.push('');
      report.push(`**Flags:** ${flags.join('; ')}`);
    }

    if (line) {
      lines.push(line);
      history = [...history, { spoken: chunk, shown: line, at: Date.now() }];
    }
  }

  return report.join('\n');
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('test-reports', { recursive: true });

const allReports = [`Battering test run\nGenerated: ${new Date().toISOString()}\nCases: ${cases.map((c) => c.name).join(', ')}\n`];
for (const def of cases) {
  const report = await runCase(def);
  allReports.push(report);
}

const outPath = `test-reports/${timestamp}-battering-test.md`;
writeFileSync(outPath, allReports.join('\n\n---\n\n'));
console.log(`\nReport written to ${outPath}`);
