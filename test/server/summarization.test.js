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
