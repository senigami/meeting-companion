import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAISummarizer } from '../../../../public/services/summarization/openai.js';

// The rolling two-block window (.agent/rolling-window-brief.md) is dead on arrival if any driver
// stops forwarding previousBlock -- this proves it reaches both the outgoing request body and the
// prompt string this driver returns for diagnostics.
test('openai summarizer forwards previousBlock in the request body and the returned prompt', async () => {
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

  const result = await summarizer.summarize({
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    previousBlock: 'The earlier sentence.',
    visibleLines: []
  });

  assert.equal(summarizer.id, 'openai');
  assert.equal(request.url, '/api/summarize');
  assert.equal(JSON.parse(request.options.body).previousBlock, 'The earlier sentence.');
  assert.match(result.prompt, /The earlier sentence\./);
  assert.match(result.prompt, /Previous block \(already summarized/i);
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
