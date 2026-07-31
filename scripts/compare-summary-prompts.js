// Runs the SAME transcript text through the CURRENT summary prompt (buildSummarizePrompt) and a
// PROPOSED variant (buildSummarizePromptVariant), so Steve can compare real model output instead of
// deciding between the two from theory alone. No new dependencies: reuses the `openai` package and
// model id already used by server/summarization.js.
//
// Usage: node scripts/compare-summary-prompts.js
// Reads OPENAI_API_KEY from .env the same way server.js does, so it works without exporting
// anything into the shell first.

import 'dotenv/config';
import OpenAI from 'openai';
import { buildSummarizePrompt, SUMMARY_MAX_WORDS } from '../public/services/summary-prompt.js';
import { buildSummarizePromptVariant } from '../public/services/summary-prompt-variant.js';
import { DEFAULT_OPENAI_MODEL } from '../server/model-config.js';

const RUNS_PER_FIXTURE = 3;

const fixtures = [
  {
    name: 'testimony-with-idiom',
    mode: 'speaker',
    visibleLines: [],
    transcript: `
      um, I just want to say that, a couple months ago, my husband lost his job and honestly the
      floor dropped out from under me when he told me. we didn't know how we were gonna make rent
      that month. but, um, our home teacher showed up that same night, before we'd even told anyone,
      and just sat with us. and I know that wasn't a coincidence.
    `.trim()
  },
  {
    name: 'announcements',
    mode: 'information',
    visibleLines: [],
    transcript: `
      okay a couple of quick things before we get started. the ward temple trip is, uh, next
      Saturday, August the 8th, we're meeting in the parking lot at 7am sharp. also, our opening
      hymn today is going to be hymn number 19, so if you want to grab a hymn book. and, um, one
      more thing, the youth combined activity has moved from Wednesday to Thursday this week.
    `.trim()
  },
  {
    name: 'prayer',
    mode: 'prayer',
    visibleLines: [],
    transcript: `
      Heavenly Father, we're just so grateful to be able to gather together today, um, in this
      building, with each other. we ask that thy spirit would be with us as the meeting continues,
      and we ask a special blessing on those who are sick, that they'd feel comfort. we say these
      things in the name of Jesus Christ, amen.
    `.trim()
  },
  {
    name: 'story-long',
    mode: 'speaker',
    visibleLines: [],
    transcript: `
      so, when I was, um, nineteen, I got called to serve a mission out in, uh, the Philippines,
      and I remember landing and just being completely overwhelmed, I didn't speak a word of
      Tagalog. my first area was this little village, no running water some days, and my
      companion at the time got really sick our second month there, so I was basically out
      knocking doors alone for, like, three weeks straight, which terrified me. and there was
      this one family, the Reyes family, who kept letting us back in even when nobody else would,
      and, um, it wasn't until years later, after I'd been home a long time, that I found out the
      dad had been planning to ask us to stop coming, right before we helped him get his son to a
      hospital one night. and that's when I understood that showing up, even when you're scared
      and you don't know the language, is sometimes the whole point.
    `.trim()
  }
];

function wordCount(line) {
  return String(line).trim().split(/\s+/).filter(Boolean).length;
}

async function callModel(client, prompt) {
  const completion = await client.chat.completions.create({
    model: DEFAULT_OPENAI_MODEL,
    temperature: 0.2,
    max_tokens: 300,
    messages: [
      { role: 'system', content: 'Return only the line text, one idea per line, or an empty string. No quotes. No markdown.' },
      { role: 'user', content: prompt }
    ]
  });
  return completion.choices?.[0]?.message?.content || '';
}

function printResult(label, text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    console.log(`  ${label}: (empty)`);
    return;
  }
  for (const line of lines) {
    console.log(`  ${label}: [${wordCount(line)}w] ${line}`);
  }
}

async function runFixture(client, fixture) {
  console.log(`\n=== Fixture: ${fixture.name} (mode: ${fixture.mode}) ===`);
  console.log(`SUMMARY_MAX_WORDS = ${SUMMARY_MAX_WORDS}`);

  for (let run = 1; run <= RUNS_PER_FIXTURE; run += 1) {
    console.log(`\n-- run ${run}/${RUNS_PER_FIXTURE} --`);

    const currentPrompt = buildSummarizePrompt({
      mode: fixture.mode,
      recentTranscript: fixture.transcript,
      visibleLines: fixture.visibleLines
    });
    try {
      const currentText = await callModel(client, currentPrompt);
      printResult('CURRENT ', currentText);
    } catch (err) {
      console.log(`  CURRENT : ERROR - ${err.message}`);
    }

    const variantPrompt = buildSummarizePromptVariant({
      mode: fixture.mode,
      recentTranscript: fixture.transcript,
      visibleLines: fixture.visibleLines
    });
    try {
      const variantText = await callModel(client, variantPrompt);
      printResult('PROPOSED', variantText);
    } catch (err) {
      console.log(`  PROPOSED: ERROR - ${err.message}`);
    }
  }
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set. Set it in the environment and re-run this script.');
    process.exitCode = 1;
    return;
  }

  const client = new OpenAI({ apiKey });

  for (const fixture of fixtures) {
    await runFixture(client, fixture);
  }
}

main();
