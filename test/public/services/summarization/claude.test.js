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
test('claude summarizer forwards previousBlock in the request body and the returned prompt', async () => {
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

  const result = await summarizer.summarize({
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    previousBlock: 'The earlier sentence.',
    visibleLines: []
  });

  assert.equal(JSON.parse(request.options.body).previousBlock, 'The earlier sentence.');
  assert.match(result.prompt, /The earlier sentence\./);
  assert.match(result.prompt, /Previous block \(already summarized/i);
});
