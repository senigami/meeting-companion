import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMinimalSummarizeMessages } from '../../../public/services/summary-prompt-minimal.js';


test('a whitespace-only history turn is skipped, not sent as an empty message', async () => {
  // OpenAI tolerates an empty content block; Anthropic rejects the whole request with a 400. Once the
  // Claude path started using these messages (#47) that became a failed summarize call rather than a
  // slightly odd turn. The guard checked truthiness and trimmed afterwards, so '   ' passed it and
  // then became ''. Found by Cato before it shipped.
  const messages = buildMinimalSummarizeMessages({
    recentTranscript: 'New words.',
    mode: 'speaker',
    maxWords: 10,
    history: [{ spoken: '   ', shown: '  ' }, { spoken: 'Real chunk.', shown: 'Real card.' }]
  });

  assert.ok(!messages.some((m) => m.content.trim() === ''), 'no message may have empty content');
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(messages[1].content, 'Real chunk.');
  assert.equal(messages.at(-1).content, 'New words.');
});
