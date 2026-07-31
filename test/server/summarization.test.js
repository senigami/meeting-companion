import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeWithSource } from '../../server/summarization.js';
import { buildSummarizePrompt } from '../../public/services/summary-prompt.js';

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

  const claudeResult = await summarizeWithSource({
    source: 'claude',
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
    recentTranscript: 'irrelevant transcript text.',
    visibleLines: [],
    openaiClient
  });
  assert.equal(openaiResult.line, multiLine);
});

test('server caps a model reply at three lines and drops only a sibling line matching a visible line, not the whole reply', async () => {
  const modelReply = 'Hymn 241 selected.\nFirst item.\nSecond item.\nThird item.';
  const result = await summarizeWithSource({
    source: 'claude',
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

test('server clamps an out-of-range or non-numeric maxWords to the shared default before it reaches the prompt', async () => {
  async function promptSentFor(maxWords) {
    let request = null;
    await summarizeWithSource({
      source: 'claude',
      mode: 'speaker',
      recentTranscript: 'A neighbor was forgiven.',
      visibleLines: [],
      maxWords,
      anthropicApiKey: 'test-key',
      anthropicModel: 'claude-sonnet-test',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Forgiven neighbor' }] }) };
      }
    });
    return JSON.parse(request.options.body).messages[0].content;
  }

  const defaultPrompt = buildSummarizePrompt({ mode: 'speaker', recentTranscript: 'A neighbor was forgiven.' });
  assert.match(defaultPrompt, /Maximum 14 words/);

  assert.match(await promptSentFor(4), /Maximum 14 words/);
  assert.match(await promptSentFor(100), /Maximum 14 words/);
  assert.match(await promptSentFor('nope'), /Maximum 14 words/);
  assert.match(await promptSentFor(8), /Maximum 8 words/);
});

// The rolling two-block window (.agent/rolling-window-brief.md) reaches the model only if the
// server layer forwards previousBlock into the prompt it hands to the outgoing Anthropic request.
test('server threads previousBlock into the prompt sent to the provider', async () => {
  let request = null;
  const result = await summarizeWithSource({
    source: 'claude',
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    previousBlock: 'The earlier sentence.',
    visibleLines: [],
    anthropicApiKey: 'test-key',
    anthropicModel: 'claude-sonnet-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '' }] }) };
    }
  });

  const sentPrompt = JSON.parse(request.options.body).messages[0].content;
  assert.match(sentPrompt, /Previous block \(already summarized/i);
  assert.match(sentPrompt, /The earlier sentence\./);
  assert.match(sentPrompt, /New transcript \(summarize this\):\s*\nThe new sentence\./);
  assert.equal(result.line, '');
});

test('server omits previousBlock cleanly when absent, matching current prompt behavior', async () => {
  let request = null;
  await summarizeWithSource({
    source: 'claude',
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    visibleLines: [],
    anthropicApiKey: 'test-key',
    anthropicModel: 'claude-sonnet-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '' }] }) };
    }
  });

  const sentPrompt = JSON.parse(request.options.body).messages[0].content;
  assert.doesNotMatch(sentPrompt, /Previous block/i);
  assert.match(sentPrompt, /Recent transcript:\s*\nThe new sentence\./);
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
