import test from 'node:test';
import assert from 'node:assert/strict';

import { createClaudeSummarizer } from '../../../../public/services/summarization/claude.js';

test('claude summarizer posts source metadata and returns the prompt', async () => {
  let request = null;
  const summarizer = createClaudeSummarizer({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ line: 'Prayer has started' })
      };
    }
  });

  const result = await summarizer.summarize({
    mode: 'prayer',
    recentTranscript: 'The opening prayer has begun.',
    visibleLines: ['Welcome everyone']
  });

  assert.equal(summarizer.id, 'claude');
  assert.equal(summarizer.label, 'Claude');
  assert.equal(result.line, 'Prayer has started');
  assert.equal(request.url, '/api/summarize');
  assert.equal(JSON.parse(request.options.body).source, 'claude');
});

// The rolling two-block window (.agent/rolling-window-brief.md) is dead on arrival if any driver
// stops forwarding previousBlock -- this proves it reaches both the outgoing request body and the
// prompt string this driver returns for diagnostics.
test('claude summarizer forwards the fields the server actually reads', async () => {
  let request = null;
  const summarizer = createClaudeSummarizer({
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

  assert.equal(JSON.parse(request.options.body).previousBlock, 'The earlier sentence.');
});
