import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAISummarizer } from '../../../../public/services/summarization/openai.js';

// previousBlock reaches no prompt any more (#66): history carries prior context as real
// user/assistant turns instead. This driver must not forward it even if a caller still passes it.
test('openai summarizer never forwards previousBlock, even if a caller still passes it', async () => {
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
  await summarizer.summarize({
    mode: 'speaker',
    recentTranscript: 'The new sentence.',
    previousBlock: 'The earlier sentence.',
    visibleLines: []
  });

  assert.equal(summarizer.id, 'openai');
  assert.equal(request.url, '/api/summarize');
  assert.ok(!('previousBlock' in JSON.parse(request.options.body)));
});
