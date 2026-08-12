import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeWithSource } from '../../server/summarization.js';
import { RUNAWAY_LINE_GUARD } from '../../public/services/summary-prompt.js';
import { readingBudget } from '../../public/services/reading-pace.js';
import { SUMMARY_INTERVAL_MAX_SECONDS } from '../../public/services/view-settings.js';

// summarizeWithSource now calls packages/ai-provider's callProvider for both providers, which talks
// HTTP (via fetchImpl) rather than an injected SDK client -- see issue #9. This mocks the OpenAI
// chat-completions endpoint the same shape the `openai` SDK actually calls, so `handler` sees the
// same { messages, max_tokens, ... } request body these tests asserted against before the move.
function openaiFetch(handler) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    const result = await handler(body);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

// Both providers send a real message array (buildMinimalSummarizeMessages) -- see
// server/summarization.js's comment.
test('OpenAI summarize with no history sends a system message plus one user turn', async () => {
  let sentMessages = null;
  const fetchImpl = openaiFetch(({ messages }) => {
    sentMessages = messages;
    return { choices: [{ message: { content: 'A short line.' } }] };
  });

  await summarizeWithSource({
    source: 'openai',
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    visibleLines: [],
    openaiApiKey: 'test-key',
    fetchImpl
  });

  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].role, 'system');
  assert.equal(sentMessages[1].role, 'user');
  assert.equal(sentMessages[1].content, 'The new sentence.');
});

test('OpenAI summarize with two history entries folds both into the system message as context, not as turns', async () => {
  // 2026-08-09 reversal: history used to become real user/assistant turn pairs; a real session
  // showed the model imitating its own prior turn's phrasing (repeating a "Name said" preamble on
  // card after card). Folding history into the system message as plain data, with an explicit
  // "do not imitate the wording" instruction, reproducibly removed that in a direct retest -- see
  // summary-prompt-minimal.js's block comment and its own test for the isolated repro.
  let sentMessages = null;
  const fetchImpl = openaiFetch(({ messages }) => {
    sentMessages = messages;
    return { choices: [{ message: { content: 'A short line.' } }] };
  });

  const history = [
    { spoken: 'First earlier chunk.', shown: 'First card.' },
    { spoken: 'Second earlier chunk.', shown: 'Second card.' }
  ];

  await summarizeWithSource({
    source: 'openai',
    mode: 'information',
    recentTranscript: 'The newest chunk.',
    visibleLines: [],
    history,
    openaiApiKey: 'test-key',
    fetchImpl
  });

  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].role, 'system');
  assert.match(sentMessages[0].content, /First earlier chunk\./);
  assert.match(sentMessages[0].content, /First card\./);
  assert.match(sentMessages[0].content, /Second earlier chunk\./);
  assert.match(sentMessages[0].content, /Second card\./);
  assert.equal(sentMessages[1].role, 'user');
  assert.equal(sentMessages[1].content, 'The newest chunk.');
});

test('server summarization routes claude requests through anthropic', async () => {
  let request = null;

  const result = await summarizeWithSource({
    source: 'claude',
    mode: 'speaker',
    recentTranscript: 'A neighbor was forgiven.',
    visibleLines: ['Forgive one another.'],
    anthropicApiKey: 'test-key',
    anthropicModel: 'claude-sonnet-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Forgiven neighbor' }]
        })
      };
    }
  });

  assert.equal(result.line, 'Forgiven neighbor');
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.options.headers['x-api-key'], 'test-key');
  assert.equal(JSON.parse(request.options.body).model, 'claude-sonnet-test');
});

test('server preserves line order across providers and joins multiple ideas onto one card', async () => {
  const multiLine = 'Closing hymn will be number 301.\nSister Margaret Ellsworth will offer the benediction.';

  // information mode explicitly, which is what this fixture actually is: two separate
  // announcements. It used to rely on the default (speaker), which was harmless until
  // packLinesIntoCards arrived -- packing merged both announcements into one card because they fit
  // the word budget. That merge is correct for a testimony and wrong for a notice board, so the
  // mode is now stated rather than inherited.
  //
  // 2026-08-10: one card per call, everything real joined onto it (not just the first line kept) --
  // both providers must collapse this two-announcement reply to the SAME single, space-joined card.
  const claudeResult = await summarizeWithSource({
    source: 'claude',
    mode: 'information',
    recentTranscript: 'irrelevant transcript text.',
    visibleLines: [],
    anthropicApiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: multiLine }] }) })
  });
  assert.equal(claudeResult.line, 'Closing hymn will be number 301. Sister Margaret Ellsworth will offer the benediction.');

  const openaiResult = await summarizeWithSource({
    source: 'openai',
    mode: 'information',
    recentTranscript: 'irrelevant transcript text.',
    visibleLines: [],
    openaiApiKey: 'test-key',
    fetchImpl: openaiFetch(() => ({ choices: [{ message: { content: multiLine } }] }))
  });
  assert.equal(openaiResult.line, 'Closing hymn will be number 301. Sister Margaret Ellsworth will offer the benediction.');
});

test('a line duplicating one already on screen is dropped, but real distinct lines are joined not discarded', async () => {
  // Was "caps a model reply at three lines": the Claude path capped at 3 and this asserted it. Since
  // #47 it runs the same guard as OpenAI. Updated again 2026-08-10: one card per call everywhere
  // (Steve's reversal), with everything real joined onto it rather than only the first surviving --
  // the duplicate is still skipped (that is the dedup filter doing its job), but the three distinct
  // real items all belong on the one card together.
  const modelReply = 'Hymn 241 selected.\nFirst item.\nSecond item.\nThird item.';
  const result = await summarizeWithSource({
    source: 'claude',
    mode: 'speaker',
    maxWords: 2,
    recentTranscript: 'irrelevant transcript text.',
    visibleLines: ['Hymn 241 selected.'],
    anthropicApiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: modelReply }] }) })
  });
  assert.equal(result.line, 'First item. Second item. Third item.');
});

test('Anthropic max_tokens is raised well past the old 64-token cap to hold three 14-word lines', async () => {
  let request = null;
  await summarizeWithSource({
    source: 'claude',
    recentTranscript: 'irrelevant transcript text.',
    visibleLines: [],
    anthropicApiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '' }] }) };
    }
  });
  const sentMaxTokens = JSON.parse(request.options.body).max_tokens;
  assert.ok(sentMaxTokens >= 200, `expected max_tokens >= 200, got ${sentMaxTokens}`);
});

test('an out-of-range or non-numeric maxWords is bounded before it reaches any prompt', async () => {
  // Rewritten with the clamp's home. It used to assert buildSummarizePrompt's internal clamp, which
  // only ever protected the Claude path; the minimal prompt clamps nothing, so once OpenAI moved to it
  // `maxWords: 100000` produced a prompt reading "no more than 100000 words". Bringing Claude to
  // parity (#47) would have widened that to both providers, so the bound now lives at the request
  // boundary and this test checks the words that actually reach the model.
  async function wordsInPromptFor(maxWords, source) {
    let seen = null;
    const fetchImpl = source === 'openai'
      ? openaiFetch(({ messages }) => { seen = messages[0].content; return { choices: [{ message: { content: 'x' } }] }; })
      : async (url, options) => {
        seen = JSON.parse(options.body).system;
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'x' }] }) };
      };
    await summarizeWithSource({
      source,
      mode: 'speaker',
      // Either level states the number now (SIMPLE_RULES, shared by both since 2026-08-09); brief
      // picked here because it also enforces the budget in code (packLinesIntoCards does the same
      // for condense), so this is testing the prompt text specifically, not the enforcement.
      level: 'brief',
      recentTranscript: 'A neighbor was forgiven.',
      maxWords,
      openaiApiKey: 'test-key',
      anthropicApiKey: 'test-key',
      fetchImpl
    });
    const match = seen.match(/about (\d+) words/);
    return match ? Number(match[1]) : null;
  }

  // Both providers, because the whole point of #47 is that they stopped being different applications.
  for (const source of ['openai', 'claude']) {
    const absurd = await wordsInPromptFor(100000, source);
    assert.ok(absurd < 100000 && absurd > 0, `${source}: an absurd value must be bounded, got ${absurd}`);
    assert.equal(await wordsInPromptFor(-5, source), 14, `${source}: a nonsense value falls back to the default`);
    assert.equal(await wordsInPromptFor('nope', source), 14, `${source}: so does a non-number`);
    assert.equal(await wordsInPromptFor(10, source), 10, `${source}: and a real budget passes through untouched`);

    // The property that matters, not the ceiling's value. A first version of this bound was a flat 40,
    // and Cato showed an 80 wpm reader at a 30s interval already reached it, so the bound was silently
    // reducing a real derived budget -- which makes it a reading-load decision rather than input
    // validation. It must never bind on anything readingBudget can produce for a plausible reader.
    for (const wpm of [30, 60, 90, 120, 200]) {
      const budget = readingBudget(wpm, SUMMARY_INTERVAL_MAX_SECONDS).words;
      assert.equal(await wordsInPromptFor(budget, source), budget,
        `${source}: a ${wpm}wpm reader's budget of ${budget} must reach the model unclamped`);
    }
  }
});

// previousBlock is gone from the route, both drivers and both provider functions (#66).
// buildMinimalSummarizeMessages (the OpenAI path since #43, and Claude too since #47) carries prior
// context in `history`. It is still passed in below on purpose: an ignored extra key must stay
// ignored, and the assertions at the bottom prove none of it reaches the model.
test('prior context reaches Claude the same way it reaches OpenAI: folded into the system field', async () => {
  let request = null;
  await summarizeWithSource({
    source: 'claude',
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    previousBlock: 'The earlier sentence.',
    history: [{ spoken: 'An earlier chunk.', shown: 'An earlier card.' }],
    visibleLines: [],
    anthropicApiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '' }] }) };
    }
  });

  const body = JSON.parse(request.options.body);
  // System prompt as its own field, not as a message -- that is Anthropic's shape. History is
  // folded in here too now (2026-08-09), not as extra message turns.
  assert.match(body.system, /Never ASL gloss/);
  assert.match(body.system, /An earlier chunk\./);
  assert.match(body.system, /An earlier card\./);
  assert.deepEqual(body.messages.map((m) => m.role), ['user']);
  assert.equal(body.messages[0].content, 'The new sentence.');
  // And the superseded mechanism is genuinely gone rather than duplicated alongside it.
  assert.doesNotMatch(body.system, /Previous block/i);
  assert.ok(!body.messages.some((m) => /The earlier sentence/.test(m.content)));
});

// Regression coverage for the fixed-offset clamp bug: `server/summarization.js:70,120` used to
// slice(0, 137) + '...' with no regard for word boundaries. Both providers must now shorten via
// shortenToLimit (public/services/text.js) identically.
async function lineFor(source, modelText) {
  if (source === 'openai') {
    const result = await summarizeWithSource({
      source: 'openai',
      recentTranscript: 'irrelevant transcript text.',
      visibleLines: [],
      openaiApiKey: 'test-key',
      fetchImpl: openaiFetch(() => ({ choices: [{ message: { content: modelText } }] }))
    });
    return result.line;
  }

  const result = await summarizeWithSource({
    source: 'claude',
    recentTranscript: 'irrelevant transcript text.',
    visibleLines: [],
    anthropicApiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: modelText }] }) })
  });
  return result.line;
}

test('an under-140-char line passes through byte-identical on both providers', async () => {
  const short = 'A short line under the limit.';
  assert.equal(await lineFor('openai', short), short);
  assert.equal(await lineFor('claude', short), short);
});

test('a >140-char line shortens at a sentence boundary when one exists, on both providers', async () => {
  const long =
    'Welcome the Hendersons, visiting for the first time today. Working bee Saturday at nine to tidy the garden. ' +
    'This third sentence is what pushes the whole line past the display limit.';
  assert.ok(long.length > 140);

  for (const source of ['openai', 'claude']) {
    const line = await lineFor(source, long);
    assert.ok(line.length <= 140, `${source}: expected <=140 chars, got ${line.length}`);
    assert.match(line, /\.$/, `${source}: expected to end at a sentence boundary`);
    assert.ok(long.startsWith(line), `${source}: expected a verbatim prefix of the original`);
    assert.doesNotMatch(line, /\.\.\.|…/);
  }
});

test('falls back to a clause boundary when no sentence boundary fits under the limit, on both providers', async () => {
  const long =
    'This one single sentence runs on for a very long time without any period in sight, ' +
    'through clause after clause after clause, separated only by commas, and it must still be shortened somehow';
  assert.ok(long.length > 140);

  for (const source of ['openai', 'claude']) {
    const line = await lineFor(source, long);
    assert.ok(line.length <= 140, `${source}: expected <=140 chars, got ${line.length}`);
    assert.ok(long.startsWith(line), `${source}: expected a verbatim prefix of the original`);
    assert.doesNotMatch(line, /\.\.\.|…/);
    assert.notEqual(line.slice(-1), ',');
  }
});

test('falls back to the last whole word when neither a sentence nor a clause boundary fits, on both providers', async () => {
  const long = Array.from({ length: 30 }, (_, i) => `wordnumber${i}`).join(' ');
  assert.ok(long.length > 140);

  for (const source of ['openai', 'claude']) {
    const line = await lineFor(source, long);
    assert.ok(line.length <= 140, `${source}: expected <=140 chars, got ${line.length}`);
    assert.ok(long.startsWith(line), `${source}: expected a verbatim prefix of the original`);
    assert.doesNotMatch(line, /\.\.\.|…/);
    // Never a partial word: the character right after the kept text, if any, must be a boundary.
    const next = long.charAt(line.length);
    assert.ok(next === '' || next === ' ', `${source}: cut mid-word, next char was ${JSON.stringify(next)}`);
  }
});

test('regression: reconstructed real captured overflow (working-bee announcement) shortens cleanly instead of cutting "worki|ng"', async () => {
  // The real 13-run replay against the live API produced this mangled output from the old
  // slice(0,137)+'...' clamp: '...Working bee Saturday at nine to tidy the garden and clear
  // gutters. Youth worki...'. The exact pre-clamp model text was not captured anywhere (only the
  // already-mangled display line was), so this reconstructs an equivalent-shape original: multiple
  // complete sentences whose combined length runs past 140 chars right in the middle of the word
  // "working", the same fragment the old bug produced.
  const long =
    'Welcome the Hendersons, visiting for the first time today. ' +
    'Working bee Saturday at nine to tidy the garden and clear gutters. ' +
    'Youth working bee is planned for next Sunday afternoon, mowing lawns and doing odd jobs.';
  assert.ok(long.length > 140);
  assert.ok(long.slice(0, 137).endsWith('worki'), 'fixture should reproduce the original mid-word cut point');

  for (const source of ['openai', 'claude']) {
    const line = await lineFor(source, long);
    assert.ok(line.length <= 140, `${source}: expected <=140 chars, got ${line.length}`);
    assert.doesNotMatch(line, /\.\.\.|…/);
    assert.doesNotMatch(line, /worki$/, `${source}: reproduced the mid-word cut`);
    const next = long.charAt(line.length);
    assert.ok(next === '' || next === ' ' || long.slice(0, line.length).endsWith('.'), `${source}: cut mid-word`);
  }
});

test('regression: reconstructed real captured overflow (info-mode schedule line) shortens cleanly instead of cutting "Wristband"', async () => {
  // The real replay's second mangled capture: '...Working bee starts at 9:00. Morning tea is at
  // 10:30. Wristband...'. Same caveat as above: reconstructing an equivalent-shape original since
  // the pre-clamp text itself was never captured.
  const long =
    'Working bee starts at 9:00. Morning tea is at 10:30. ' +
    'Wristbands are available at the front desk for anyone who has not collected theirs yet today.';
  assert.ok(long.length > 140);

  for (const source of ['openai', 'claude']) {
    const line = await lineFor(source, long);
    assert.ok(line.length <= 140, `${source}: expected <=140 chars, got ${line.length}`);
    assert.doesNotMatch(line, /\.\.\.|…/);
    const next = long.charAt(line.length);
    assert.ok(next === '' || next === ' ', `${source}: cut mid-word, next char was ${JSON.stringify(next)}`);
  }
});

test('the words-per-card setting bounds the cards actually produced, so the slider is not a dead control', async () => {
  // It WAS dead once already: the minimal prompt hardcoded 15 while maxWords was threaded to a
  // function that no longer read it. The setting persisted, rendered, and did nothing.
  //
  // 2026-08-10 reversal changed HOW the slider matters, not whether it does: packLinesIntoCards (a
  // wider budget merging more thoughts into fewer, fuller cards) is gone -- one card per call now,
  // always, regardless of maxWords. What is left is the prompt's own stated target ("Your target
  // output is about N words"), which is the only mechanism left for maxWords to have any effect. A
  // scripted mock reply can't demonstrate the model actually honouring a different target (that is
  // an empirical, real-API question -- see scripts/battering-run.js); this pins the structural half:
  // a different maxWords produces a different number in the actual prompt sent, and exactly one card
  // survives regardless of which budget was asked for.
  const modelReply = [
    "I'd like to bear my testimony.",
    'I know the Church is true.',
    'Joseph Smith is a prophet.'
  ].join('\n');

  let narrowSystem = null;
  const narrow = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'Some speech.', maxWords: 8, openaiApiKey: 'test-key',
    fetchImpl: openaiFetch(({ messages }) => { narrowSystem = messages[0].content; return { choices: [{ message: { content: modelReply } }] }; })
  });
  let wideSystem = null;
  const wide = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'Some speech.', maxWords: 20, openaiApiKey: 'test-key',
    fetchImpl: openaiFetch(({ messages }) => { wideSystem = messages[0].content; return { choices: [{ message: { content: modelReply } }] }; })
  });

  assert.match(narrowSystem, /about 8 words/);
  assert.match(wideSystem, /about 20 words/);
  // One card either way -- everything real joined onto it, not just the first line kept.
  const joined = 'I\'d like to bear my testimony. I know the Church is true. Joseph Smith is a prophet.';
  assert.equal(narrow.line, joined);
  assert.equal(wide.line, joined);
});

test('brief returns exactly one card, everything joined onto it rather than a second card', async () => {
  // The level IS the reading budget. A second CARD doubles what the reader was promised, and at one
  // word every two seconds that is the difference between finishing and not. 2026-08-10: that no
  // longer means dropping real content to get there -- it means joining it onto the one card.
  const fetchImpl = openaiFetch(() => ({ choices: [{ message: { content: 'First thing.\nSecond thing.\nThird thing.' } }] }));
  const result = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'A long testimony.', maxWords: 10, level: 'brief', openaiApiKey: 'test-key', fetchImpl
  });
  assert.equal(result.line, 'First thing. Second thing. Third thing.');
  assert.ok(!result.line.includes('\n'));
});

test('condense collapses to one card too, the same as every other level (2026-08-10 reversal)', async () => {
  // Was "condense keeps multiple cards, so brief did not replace it" -- Steve's 2026-08-10 reversal:
  // "Multiple cards per call is never correct... should not exist for any mode, anywhere." A real
  // prayer had produced four cards from one chunk via exactly this path. A first fix kept only the
  // model's first accepted line and discarded the rest; Steve caught that too ("if it returned 2
  // sentences then both would be on the same card. no artificial splitting") -- finishReply now
  // joins every accepted line onto the one card instead.
  const fetchImpl = openaiFetch(() => ({ choices: [{ message: { content: 'First thing.\nSecond thing.\nThird thing.' } }] }));
  const result = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'A long testimony.', maxWords: 5, level: 'condense', openaiApiKey: 'test-key', fetchImpl
  });
  assert.equal(result.line.split('\n').length, 1, 'condense is one card too now, not several packed ones');
  assert.equal(result.line, 'First thing. Second thing. Third thing.');
});

test('an unrecognised level falls back to condense rather than silently changing the contract', async () => {
  let seenSystem = null;
  const fetchImpl = openaiFetch(({ messages }) => { seenSystem = messages[0].content; return { choices: [{ message: { content: 'A line.' } }] }; });
  await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'Speech.', maxWords: 17, level: 'nonsense', openaiApiKey: 'test-key', fetchImpl
  });
  assert.match(seenSystem, /8 year old/, 'unknown levels must not reach the prompt builder');
});

test('an information-mode request is forced to condense at the server, even when brief is asked for', async () => {
  // Defence at the point of use: this is where an untrusted request body arrives. Since #105,
  // information mode is ALSO forced to a single card regardless of level (Steve's reversal of the
  // per-announcement-line ruling), so this now asserts the level is still condense server-side (via
  // the prompt) while the reply itself collapses to one card either way.
  let seenSystem = null;
  const fetchImpl = openaiFetch(({ messages }) => {
    seenSystem = messages[0].content;
    return { choices: [{ message: { content: 'Closing hymn is 301.\nSister Ellsworth offers the benediction.' } }] };
  });
  const result = await summarizeWithSource({
    source: 'openai', mode: 'information', recentTranscript: 'Announcements.', maxWords: 10, level: 'brief', openaiApiKey: 'test-key', fetchImpl
  });
  const cards = result.line.split('\n').filter(Boolean);
  assert.equal(cards.length, 1, 'information mode never hands back more than one card');
  assert.match(cards[0], /301/, 'the hymn number is exactly the thing that must not be dropped');
  assert.match(seenSystem, /8 year old/, 'level was forced to condense, not the brief prompt');
});

test('a speaker-mode brief request is still honoured, so the server guard is narrow', async () => {
  // 2026-08-10: one card per call is now unconditional (every mode, every level), so this no longer
  // distinguishes brief's old maxLines: 1 from anything else -- both lines are real content and get
  // joined onto the one card rather than the second being dropped.
  const fetchImpl = openaiFetch(() => ({ choices: [{ message: { content: 'One.\nTwo.' } }] }));
  const result = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'Speech.', maxWords: 10, level: 'brief', openaiApiKey: 'test-key', fetchImpl
  });
  assert.equal(result.line, 'One. Two.');
});

test('several announcements in one tick land on one joined card, none dropped (#105, 2026-08-10)', async () => {
  // Was "the fourth announcement survives" (#49), then "later announcements are dropped, only the
  // first survives" (#105, 2026-08-09). Steve's 2026-08-10 correction: "if it returned 2 sentences
  // then both would be on the same card. no artificial splitting" -- dropping the rest to force one
  // card was just as wrong as splitting into several. finishReply now joins everything the model
  // returns onto the one card; the information-mode PROMPT (pull out the most important
  // information) is what's supposed to stop a well-behaved model from listing five separate
  // announcements in the first place, not a code-level discard of four real ones.
  const reply = [
    'Closing hymn is 301.',
    'Sister Ellsworth offers the benediction.',
    'Working bee Saturday at 9:00.',
    'Youth activity moved to Thursday.',
    'Ward council meets at 6:30.'
  ].join('\n');
  const fetchImpl = openaiFetch(() => ({ choices: [{ message: { content: reply } }] }));

  const result = await summarizeWithSource({
    source: 'openai', mode: 'information', recentTranscript: 'Announcements.', maxWords: 10, openaiApiKey: 'test-key', fetchImpl
  });
  const cards = result.line.split('\n').filter(Boolean);
  assert.equal(cards.length, 1, 'still exactly one card, whatever the model returns');
  assert.match(result.line, /301/);
  assert.match(result.line, /Thursday/, 'nothing real is discarded to force a single line -- it is joined, not dropped');
});

test('the information prompt asks for one line focused on the main topic, not a per-announcement count', async () => {
  // Measured 2026-08-02: asked for "no more than 3 lines" this model returned 8, and three different
  // configurations produced byte-identical output -- which is why a line count was ever named here in
  // the first place. Steve's 2026-08-09 reversal removes the per-announcement framing entirely: one
  // card per output, same shape as brief. The prompt itself no longer names a line count at all
  // (2026-08-09, later same day, Steve's leaner prompt) -- the one-card guarantee is enforced in
  // code now (finishReply's maxLines: 1 for mode === 'information'), covered by its own test.
  let seenSystem = null;
  const fetchImpl = openaiFetch(({ messages }) => { seenSystem = messages[0].content; return { choices: [{ message: { content: 'A line.' } }] }; });
  await summarizeWithSource({
    source: 'openai', mode: 'information', recentTranscript: 'Announcements.', maxWords: 10, openaiApiKey: 'test-key', fetchImpl
  });
  assert.doesNotMatch(seenSystem, /three lines in total/);
  assert.doesNotMatch(seenSystem, /per SEPARATE announcement/, 'the per-announcement rule is gone, not just reworded');
  assert.match(seenSystem, /most important information/i);
  // 2026-08-09, later same day: Steve clarified "focus on the main topic" was meant for speaker
  // mode, not information -- information pulls out the most important information instead.
  assert.match(seenSystem, /most important information/i);
});

test('both providers run the same prompt, levels and line guard (#47), and both collapse information mode to one card', async () => {
  // Steve, 2026-08-04: "Claude is supported for live transcription but untested as I do not have
  // claude api key. In theory it should work the same as the openai one." Before this, they were two
  // applications wearing one setting: Claude got a pasted-context single message, no levels, no
  // third-person brief, no packing, and a line cap of 3 -- so #49's fix never applied to it. #105 then
  // replaced the per-announcement cap with a one-card rule for information mode, on both providers.
  const FOUR = 'Closing hymn is 301.\nSister Ellsworth offers the benediction.\nWorking bee Saturday at 9:00.\nWard council at 6:30.';

  async function announcementsVia(source) {
    return summarizeWithSource({
      source,
      mode: 'information',
      recentTranscript: 'Announcements.',
      maxWords: 10,
      openaiApiKey: 'test-key',
      anthropicApiKey: 'test-key',
      // One fetchImpl serving both providers, branching on URL -- the same shape a real fetch
      // would see, since Claude's adapter posts to Anthropic and OpenAI's SDK client posts to
      // api.openai.com regardless of which `source` this call is testing.
      fetchImpl: async (url) => {
        if (String(url).includes('anthropic')) {
          return { ok: true, json: async () => ({ content: [{ type: 'text', text: FOUR }] }) };
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: FOUR } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    });
  }

  const openai = await announcementsVia('openai');
  const claude = await announcementsVia('claude');
  assert.equal(claude.line, openai.line, 'the same reply must survive identically on both providers');
  assert.equal(claude.line.split('\n').filter(Boolean).length, 1, 'one card only, on both providers');
  assert.match(claude.line, /301/);
  // 2026-08-10: nothing real is dropped to force a single line any more -- it is joined.
  assert.match(claude.line, /6:30/);
});

test('brief keeps everything joined onto one line on Claude too, not just on OpenAI', async () => {
  const reply = 'First thing.\nSecond thing.\nThird thing.';
  const result = await summarizeWithSource({
    source: 'claude',
    mode: 'speaker',
    level: 'brief',
    recentTranscript: 'A testimony.',
    maxWords: 10,
    anthropicApiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: reply }] }) })
  });
  assert.equal(result.line, 'First thing. Second thing. Third thing.');
});

test('the Claude prompt is the third-person brief one, not the old voice-preserving prompt', async () => {
  let system = null;
  await summarizeWithSource({
    source: 'claude',
    mode: 'speaker',
    level: 'brief',
    recentTranscript: 'A testimony.',
    maxWords: 10,
    anthropicApiKey: 'test-key',
    fetchImpl: async (url, options) => {
      system = JSON.parse(options.body).system;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'x' }] }) };
    }
  });
  assert.match(system, /third person/i, 'Ansel ruled brief is reported, not voiced');
  assert.match(system, /main point/i, 'Steve\'s 2026-08-09 wording, consolidated onto SIMPLE_RULES: summarize the main point');
  assert.doesNotMatch(system, /Maximum \d+ words/, 'the old buildSummarizePrompt wording must be gone');
});

// #65. max_tokens was a flat 300 on both paths, with a comment describing "three 14-word lines" -- a
// cap that stopped existing in #59. Twelve lines at a high word budget is roughly 400 tokens, so the
// reply was cut mid-line, and a cut line is displayed as a finished card. The reader gets a fragment
// with the same confidence as a whole thought, and nothing reports it.
test('the token allowance can always hold the text we actually asked for', async () => {
  // Read this for what it is: the line count cancels on both sides, so what survives is a RATE
  // comparison. It asserts that the allowance's per-word rate is at least the dense rate supplied
  // here from outside the code. That is the honest description, and 3 is the bar that matters,
  // because the content which must survive verbatim tokenizes far worse than prose ("John 14:26-27"
  // is about 6 tokens for 2 words, where plain English runs about 1.3).
  //
  // The line count used to be a literal 12, which read as a sufficiency check and had a false
  // failure in it: lowering the guard to 6 failed this test although six lines need half the room
  // (#69). The guard's own value is pinned in test/public/services/summarization/line-guard.test.js,
  // against Ansel's ruling, which is where a change to it should be argued.
  const DENSE_TOKENS_PER_WORD = 3;
  const MODEL_LINES = RUNAWAY_LINE_GUARD;

  async function allowanceFor({ level, maxWords, source }) {
    let seen = null;
    await summarizeWithSource({
      source,
      mode: 'speaker',
      level,
      maxWords,
      recentTranscript: 'Some speech.',
      openaiApiKey: 'test-key',
      anthropicApiKey: 'test-key',
      fetchImpl: async (url, options) => {
        if (String(url).includes('anthropic')) {
          seen = JSON.parse(options.body).max_tokens;
          return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'x' }] }) };
        }
        seen = JSON.parse(options.body).max_tokens;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    });
    return seen;
  }

  for (const source of ['openai', 'claude']) {
    for (const maxWords of [4, 10, 14, 17, 24, 30]) {
      const condense = await allowanceFor({ level: 'condense', maxWords, source });
      const needed = MODEL_LINES * maxWords * DENSE_TOKENS_PER_WORD;
      assert.ok(condense >= needed,
        `${source} at ${maxWords} words: allowance ${condense} cannot hold ${MODEL_LINES} reference-dense lines (~${needed} tokens)`);

      // brief is one line by contract, so it must not reserve room for twelve.
      const brief = await allowanceFor({ level: 'brief', maxWords, source });
      assert.ok(brief < condense, `${source}: brief should ask for less than condense, got ${brief} vs ${condense}`);
      assert.ok(brief >= maxWords * DENSE_TOKENS_PER_WORD, `${source}: brief must still fit its own dense line`);
    }
  }
});

test('the old flat allowance would not have fitted a full reply, which is why this is derived', async () => {
  // Documents the defect rather than just the fix: at the top of the word range the previous hardcoded
  // 300 was below what twelve lines needs, so the reply was cut mid-line rather than arriving whole.
  const OLD_FLAT_ALLOWANCE = 300;
  let seen = null;
  await summarizeWithSource({
    source: 'openai',
    mode: 'speaker',
    level: 'condense',
    maxWords: 24,
    recentTranscript: 'Some speech.',
    openaiApiKey: 'test-key',
    fetchImpl: openaiFetch((body) => { seen = body.max_tokens; return { choices: [{ message: { content: 'x' } }] }; })
  });
  assert.ok(seen > OLD_FLAT_ALLOWANCE,
    `the derived allowance (${seen}) must exceed the old flat ${OLD_FLAT_ALLOWANCE} where the old one was too small`);
});

test('passing the retired openaiClient throws rather than being silently ignored', async () => {
  // The guard added when the OpenAI adapter moved into packages/ai-provider (#9). Without a test,
  // the guard is one refactor from being deleted as dead code, and its absence looks exactly like
  // success: the call returns a summary built with the WRONG key, or none at all.
  await assert.rejects(
    () => summarizeWithSource({
      source: 'openai',
      recentTranscript: 'Some speech.',
      openaiClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'x' } }] }) } } },
      openaiApiKey: 'test-key',
      fetchImpl: openaiFetch(() => ({ choices: [{ message: { content: 'x' } }] }))
    }),
    /openaiClient is no longer accepted/
  );
});

// A 200 carrying no usable text is "the model had nothing to say", not a failure. Both branches
// behaved this way before the provider adapters moved into packages/ai-provider (#9); the package
// classifies it as malformed-response, and mapping that back to an empty reply here is what keeps
// #9 an extraction rather than a behaviour change. Whether silence is the RIGHT answer is issue #103.
test('OpenAI: a 200 with null content returns an empty line rather than raising an error', async () => {
  const result = await summarizeWithSource({
    source: 'openai',
    recentTranscript: 'Some speech.',
    visibleLines: [],
    openaiApiKey: 'test-key',
    fetchImpl: openaiFetch(() => ({ choices: [{ message: { content: null, refusal: 'no' } }] }))
  });

  assert.deepEqual(result.line, '');
});

test('Claude: a 200 with no content array returns an empty line rather than raising an error', async () => {
  const result = await summarizeWithSource({
    source: 'claude',
    recentTranscript: 'Some speech.',
    visibleLines: [],
    anthropicApiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: 'not an array' }) })
  });

  assert.deepEqual(result.line, '');
});
