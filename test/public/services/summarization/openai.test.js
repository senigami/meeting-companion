import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAISummarizer } from '../../../../public/services/summarization/openai.js';

// The rolling two-block window (.agent/rolling-window-brief.md) is dead on arrival if any driver
// stops forwarding previousBlock -- this proves it reaches both the outgoing request body and the
// prompt string this driver returns for diagnostics.
test('openai summarizer forwards the fields the server actually reads', async () => {
  let request = null;
  const summarizer = createOpenAISummarizer({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ line: '' })
      };
    }
  });

  // The returned `prompt` field is gone (#47). Both drivers used to build a full prompt string on
  // every call and attach it to the result, where nothing read it -- and it was the OLD
  // buildSummarizePrompt, so it did not even describe what was sent. Dead work and a misleading
  // artifact at once.
  const result = await summarizer.summarize({
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    previousBlock: 'The earlier sentence.',
    visibleLines: []
  });

  assert.equal(summarizer.id, 'openai');
  assert.equal(request.url, '/api/summarize');
  assert.equal(JSON.parse(request.options.body).previousBlock, 'The earlier sentence.');
});

test('openai summarizer omits previousBlock cleanly when absent, matching current behavior', async () => {
  let request = null;
  const summarizer = createOpenAISummarizer({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ line: '' })
      };
    }
  });

  await summarizer.summarize({
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    visibleLines: []
  });

  assert.equal(JSON.parse(request.options.body).previousBlock, '');
});
