import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeWithSource } from '../../server/summarization.js';
import { buildSummarizePrompt, RUNAWAY_LINE_GUARD } from '../../public/services/summary-prompt.js';
import { readingBudget } from '../../public/services/reading-pace.js';
import { SUMMARY_INTERVAL_MAX_SECONDS } from '../../public/services/view-settings.js';

// OpenAI now sends a real message array (buildMinimalSummarizeMessages), not the single
// buildSummarizePrompt user message the Claude path below still uses -- see
// server/summarization.js's comment for why the two providers deliberately differ for now.
test('OpenAI summarize with no history sends a system message plus one user turn', async () => {
  let sentMessages = null;
  const openaiClient = {
    chat: {
      completions: {
        create: async ({ messages }) => {
          sentMessages = messages;
          return { choices: [{ message: { content: 'A short line.' } }] };
        }
      }
    }
  };

  await summarizeWithSource({
    source: 'openai',
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    visibleLines: [],
    openaiClient
  });

  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].role, 'system');
  assert.equal(sentMessages[1].role, 'user');
  assert.equal(sentMessages[1].content, 'The new sentence.');
});

test('OpenAI summarize with two history entries sends system, user/assistant pairs, then the new turn', async () => {
  let sentMessages = null;
  const openaiClient = {
    chat: {
      completions: {
        create: async ({ messages }) => {
          sentMessages = messages;
          return { choices: [{ message: { content: 'A short line.' } }] };
        }
      }
    }
  };

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
    openaiClient
  });

  assert.equal(sentMessages.length, 6);
  assert.equal(sentMessages[0].role, 'system');
  assert.equal(sentMessages[1].role, 'user');
  assert.equal(sentMessages[1].content, 'First earlier chunk.');
  assert.equal(sentMessages[2].role, 'assistant');
  assert.equal(sentMessages[2].content, 'First card.');
  assert.equal(sentMessages[3].role, 'user');
  assert.equal(sentMessages[3].content, 'Second earlier chunk.');
  assert.equal(sentMessages[4].role, 'assistant');
  assert.equal(sentMessages[4].content, 'Second card.');
  assert.equal(sentMessages[5].role, 'user');
  assert.equal(sentMessages[5].content, 'The newest chunk.');
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

test('server preserves line order across providers and rejoins multiple ideas with newlines', async () => {
  const multiLine = 'Closing hymn will be number 301.\nSister Margaret Ellsworth will offer the benediction.';

  // information mode explicitly, which is what this fixture actually is: two separate
  // announcements. It used to rely on the default (speaker), which was harmless until
  // packLinesIntoCards arrived -- packing merged both announcements into one card because they fit
  // the word budget. That merge is correct for a testimony and wrong for a notice board, so the
  // mode is now stated rather than inherited.
  const claudeResult = await summarizeWithSource({
    source: 'claude',
    mode: 'information',
    recentTranscript: 'irrelevant transcript text.',
    visibleLines: [],
    anthropicApiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: multiLine }] }) })
  });
  assert.equal(claudeResult.line, multiLine);

  const openaiClient = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: multiLine } }] }) } }
  };
  const openaiResult = await summarizeWithSource({
    source: 'openai',
    mode: 'information',
    recentTranscript: 'irrelevant transcript text.',
    visibleLines: [],
    openaiClient
  });
  assert.equal(openaiResult.line, multiLine);
});

test('a line duplicating one already on screen is dropped, and only that line', async () => {
  // Was "caps a model reply at three lines": the Claude path capped at 3 and this asserted it. Since
  // #47 it runs the same guard as OpenAI, so four items now survive four items. The behaviour this
  // test actually protects -- one sibling dropped for matching a visible line, the rest kept -- is
  // unchanged and is the part worth pinning.
  const modelReply = 'Hymn 241 selected.\nFirst item.\nSecond item.\nThird item.';
  const result = await summarizeWithSource({
    source: 'claude',
    mode: 'information',
    recentTranscript: 'irrelevant transcript text.',
    visibleLines: ['Hymn 241 selected.'],
    anthropicApiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: modelReply }] }) })
  });
  assert.equal(result.line, 'First item.\nSecond item.\nThird item.');
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
    const openaiClient = {
      chat: { completions: { create: async ({ messages }) => { seen = messages[0].content; return { choices: [{ message: { content: 'x' } }] }; } } }
    };
    await summarizeWithSource({
      source,
      mode: 'speaker',
      // brief, because the CONDENSE prompt deliberately names no word count any more (the model
      // ignored it, so packLinesIntoCards enforces the budget in code instead). brief is the branch
      // that still states a number, so it is where an unbounded value would actually surface.
      level: 'brief',
      recentTranscript: 'A neighbor was forgiven.',
      maxWords,
      openaiClient,
      anthropicApiKey: 'test-key',
      fetchImpl: async (url, options) => {
        seen = JSON.parse(options.body).system;
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'x' }] }) };
      }
    });
    const match = seen.match(/no more than (\d+) words/);
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

// previousBlock reaches NO prompt any more, and these two tests used to be the only thing asserting
// otherwise. They covered the Claude path only, which was its last consumer: buildMinimalSummarizeMessages
// (the OpenAI path since #43, and now Claude too since #47) carries prior context as real
// user/assistant turns in `history` instead of pasting a described block into one message.
//
// So the parameter is now accepted, threaded through two functions, and used nowhere. Filed rather
// than deleted here, because removing it touches the route, both client drivers and the runtime, and
// that is not a provider-parity change.
test('prior context reaches Claude as conversation turns, the same way it reaches OpenAI', async () => {
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
  // System prompt as its own field, not as a message -- that is Anthropic's shape.
  assert.match(body.system, /large display read by one person who is Deaf/);
  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(body.messages[0].content, 'An earlier chunk.');
  assert.equal(body.messages[1].content, 'An earlier card.');
  assert.equal(body.messages[2].content, 'The new sentence.');
  // And the superseded mechanism is genuinely gone rather than duplicated alongside it.
  assert.doesNotMatch(body.system, /Previous block/i);
  assert.ok(!body.messages.some((m) => /The earlier sentence/.test(m.content)));
});

// Regression coverage for the fixed-offset clamp bug: `server/summarization.js:70,120` used to
// slice(0, 137) + '...' with no regard for word boundaries. Both providers must now shorten via
// shortenToLimit (public/services/text.js) identically.
async function lineFor(source, modelText) {
  if (source === 'openai') {
    const client = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: modelText } }] })
        }
      }
    };
    const result = await summarizeWithSource({
      source: 'openai',
      recentTranscript: 'irrelevant transcript text.',
      visibleLines: [],
      openaiClient: client
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
  // It WAS dead: the minimal prompt hardcoded 15 while maxWords was threaded to a function that no
  // longer read it. The setting persisted, rendered, and did nothing.
  //
  // This asserts the CONSEQUENCE (card widths), not the presence of "8" in the prompt text. The
  // earlier version asserted the prompt string, and when the speaker prompt stopped naming a word
  // count at all -- because the model demonstrably ignored it and packLinesIntoCards took the job
  // over -- that assertion failed while the slider was working perfectly. A check pinned to how a
  // rule is phrased goes green or red on the phrasing, not on whether the rule holds.
  const modelReply = [
    "I'd like to bear my testimony.",
    'I know the Church is true.',
    'Joseph Smith is a prophet.',
    'I enjoy going to the temple.',
    "I'm grateful to be at church today."
  ].join('\n');
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: modelReply } }] }) } }
  };

  const narrow = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'Some speech.', maxWords: 8, openaiClient: client
  });
  const wide = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'Some speech.', maxWords: 20, openaiClient: client
  });

  const cards = (result) => result.line.split('\n').filter(Boolean);
  const widest = (result) => Math.max(...cards(result).map((c) => c.split(/\s+/).length));

  assert.ok(widest(narrow) <= 8, `every card must fit the 8-word budget, widest was ${widest(narrow)}`);
  assert.ok(widest(wide) <= 20, `every card must fit the 20-word budget, widest was ${widest(wide)}`);
  assert.ok(cards(wide).length < cards(narrow).length,
    'a bigger budget must produce fewer, fuller cards -- otherwise the setting changes nothing');
  // Nothing the speaker said may be dropped on the way through packing, at either setting.
  assert.equal(cards(narrow).join(' ').replace(/\s+/g, ' '), modelReply.split('\n').join(' '));
});

test('brief returns exactly one card, never packed and never a second line', async () => {
  // The level IS the reading budget. A second card doubles what the reader was promised, and at one
  // word every two seconds that is the difference between finishing and not.
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: 'First thing.\nSecond thing.\nThird thing.' } }] }) } }
  };
  const result = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'A long testimony.', maxWords: 10, level: 'brief', openaiClient: client
  });
  assert.equal(result.line, 'First thing.', 'only the first line survives brief');
  assert.ok(!result.line.includes('\n'));
});

test('condense still produces several packed cards, so brief did not replace it', async () => {
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: 'First thing.\nSecond thing.\nThird thing.' } }] }) } }
  };
  const result = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'A long testimony.', maxWords: 5, level: 'condense', openaiClient: client
  });
  assert.ok(result.line.split('\n').length > 1, 'condense keeps multiple cards');
});

test('an unrecognised level falls back to condense rather than silently changing the contract', async () => {
  let seenSystem = null;
  const client = {
    chat: { completions: { create: async ({ messages }) => { seenSystem = messages[0].content; return { choices: [{ message: { content: 'A line.' } }] }; } } }
  };
  await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'Speech.', maxWords: 17, level: 'nonsense', openaiClient: client
  });
  assert.match(seenSystem, /must still read as them talking/, 'unknown levels must not reach the prompt builder');
});

test('an information-mode request is forced to condense at the server, even when brief is asked for', async () => {
  // Defence at the point of use: this is where an untrusted request body arrives, and a brief
  // announcement round loses facts silently instead of failing.
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: 'Closing hymn is 301.\nSister Ellsworth offers the benediction.' } }] }) } }
  };
  const result = await summarizeWithSource({
    source: 'openai', mode: 'information', recentTranscript: 'Announcements.', maxWords: 10, level: 'brief', openaiClient: client
  });
  const cards = result.line.split('\n').filter(Boolean);
  assert.equal(cards.length, 2, 'both announcements must survive');
  assert.match(cards[0], /301/, 'the hymn number is exactly the thing that must not be dropped');
  assert.match(cards[1], /benediction/);
});

test('a speaker-mode brief request is still honoured, so the server guard is narrow', async () => {
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: 'One.\nTwo.' } }] }) } }
  };
  const result = await summarizeWithSource({
    source: 'openai', mode: 'speaker', recentTranscript: 'Speech.', maxWords: 10, level: 'brief', openaiClient: client
  });
  assert.equal(result.line, 'One.');
});

test('a fourth announcement in one tick survives, instead of being dropped without a word (#49)', async () => {
  // cleanModelLines capped information mode at MAX_LINES_PER_CALL (3) and the prompt asked for "no
  // more than three lines in total", so the two agreed and nothing looked wrong. A fourth
  // announcement was discarded with no error, no telemetry and wasShortened false. A cap that matches
  // the prompt rather than the speech is the whole shape of that bug.
  const reply = [
    'Closing hymn is 301.',
    'Sister Ellsworth offers the benediction.',
    'Working bee Saturday at 9:00.',
    'Youth activity moved to Thursday.',
    'Ward council meets at 6:30.'
  ].join('\n');
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } } };

  const result = await summarizeWithSource({
    source: 'openai', mode: 'information', recentTranscript: 'Announcements.', maxWords: 10, openaiClient: client
  });
  const cards = result.line.split('\n').filter(Boolean);
  assert.equal(cards.length, 5, 'every announcement must survive; the release queue paces them, not a cap');
  // The specific things a cap silently ate: a hymn number, a time, an assignment.
  assert.match(result.line, /301/);
  assert.match(result.line, /9:00/);
  assert.match(result.line, /6:30/);
  assert.match(result.line, /benediction/);
  assert.match(result.line, /Thursday/);
});

test('the information prompt no longer names a line count, since the model ignored it anyway', async () => {
  // Measured 2026-08-02: asked for "no more than 3 lines" this model returned 8, and three different
  // configurations produced byte-identical output. A runaway guard belongs in code, not in prose the
  // model does not follow -- and stating it in both places is what made the cap look agreed.
  let seenSystem = null;
  const client = {
    chat: { completions: { create: async ({ messages }) => { seenSystem = messages[0].content; return { choices: [{ message: { content: 'A line.' } }] }; } } }
  };
  await summarizeWithSource({
    source: 'openai', mode: 'information', recentTranscript: 'Announcements.', maxWords: 10, openaiClient: client
  });
  assert.doesNotMatch(seenSystem, /three lines in total/);
  assert.match(seenSystem, /per SEPARATE announcement/, 'the per-announcement rule must survive');
});

test('both providers run the same prompt, levels and line guard (#47)', async () => {
  // Steve, 2026-08-04: "Claude is supported for live transcription but untested as I do not have
  // claude api key. In theory it should work the same as the openai one." Before this, they were two
  // applications wearing one setting: Claude got a pasted-context single message, no levels, no
  // third-person brief, no packing, and a line cap of 3 -- so #49's fix never applied to it.
  const FOUR = 'Closing hymn is 301.\nSister Ellsworth offers the benediction.\nWorking bee Saturday at 9:00.\nWard council at 6:30.';

  async function announcementsVia(source) {
    return summarizeWithSource({
      source,
      mode: 'information',
      recentTranscript: 'Announcements.',
      maxWords: 10,
      openaiClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: FOUR } }] }) } } },
      anthropicApiKey: 'test-key',
      fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: FOUR }] }) })
    });
  }

  const openai = await announcementsVia('openai');
  const claude = await announcementsVia('claude');
  assert.equal(claude.line, openai.line, 'the same reply must survive identically on both providers');
  assert.equal(claude.line.split('\n').filter(Boolean).length, 4, 'including the fourth announcement');
  assert.match(claude.line, /6:30/);
});

test('brief keeps one line on Claude too, not just on OpenAI', async () => {
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
  assert.equal(result.line, 'First thing.');
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
  assert.match(system, /most important/i);
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
  // #69. The line count now comes FROM the guard, and the literal 12 moved to its own test below.
  // A literal here had a false-failure direction Cato proved by probe: lowering the guard to 6 failed
  // this test for no real reason, since six lines need half the room. Splitting the two questions
  // keeps the rate honest (3 is supplied from outside, and the allowance must beat it) while a guard
  // RISE, the dangerous silent direction, is caught by the pin rather than by arithmetic here.
  const MODEL_LINES = RUNAWAY_LINE_GUARD;

  async function allowanceFor({ level, maxWords, source }) {
    let seen = null;
    await summarizeWithSource({
      source,
      mode: 'speaker',
      level,
      maxWords,
      recentTranscript: 'Some speech.',
      openaiClient: { chat: { completions: { create: async (params) => { seen = params.max_tokens; return { choices: [{ message: { content: 'x' } }] }; } } } },
      anthropicApiKey: 'test-key',
      fetchImpl: async (url, options) => {
        seen = JSON.parse(options.body).max_tokens;
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'x' }] }) };
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
    openaiClient: { chat: { completions: { create: async (params) => { seen = params.max_tokens; return { choices: [{ message: { content: 'x' } }] }; } } } }
  });
  assert.ok(seen > OLD_FLAT_ALLOWANCE,
    `the derived allowance (${seen}) must exceed the old flat ${OLD_FLAT_ALLOWANCE} where the old one was too small`);
});
