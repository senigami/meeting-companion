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
