import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMinimalSummarizeMessages, computeSummaryPromptHash } from '../../../public/services/summary-prompt-minimal.js';


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

// Independent reimplementation of the same FNV-1a algorithm, applied directly to
// buildMinimalSummarizePrompt's own output rather than going through computeSummaryPromptHash. This
// is the check that the hash genuinely tracks the real prompt text (issue #4's requirement) rather
// than, say, a hand-maintained version constant: if computeSummaryPromptHash stopped calling
// buildMinimalSummarizePrompt, this would diverge from it.
function independentFnv1aHash(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

test('computeSummaryPromptHash hashes the actual prompt text buildMinimalSummarizePrompt produces', async () => {
  const { buildMinimalSummarizePrompt, CARD_WORDS } = await import('../../../public/services/summary-prompt-minimal.js');
  const cases = [
    { mode: 'speaker', level: 'condense' },
    { mode: 'prayer', level: 'condense' },
    { mode: 'information', level: 'condense' },
    { mode: 'speaker', level: 'brief' },
    { mode: 'prayer', level: 'brief' },
    { mode: 'information', level: 'brief' }
  ];
  const combined = cases
    .map(({ mode, level }) => buildMinimalSummarizePrompt({ recentTranscript: '', mode, level, maxWords: CARD_WORDS }))
    .join(' ');

  assert.equal(computeSummaryPromptHash(), independentFnv1aHash(combined));
});

test('computeSummaryPromptHash is a stable value for the current prompt (fails if the prompt text changes unnoticed)', () => {
  // Literal, computed independently of this code path -- not derived from calling the function under
  // test with different inputs. If this ever legitimately needs updating, that itself is the signal
  // that a recording's header hash will look different, which is the whole point of recording it.
  assert.equal(computeSummaryPromptHash(), '4b55c527');
});

test('computeSummaryPromptHash never contains the prompt wording itself', () => {
  const hash = computeSummaryPromptHash();
  assert.match(hash, /^[0-9a-f]{8}$/);
});

test('every branch of the prompt is inside the hashed corpus, so no real prompt edit can leave the hash unmoved', async () => {
  const { buildMinimalSummarizePrompt, CARD_WORDS, PROMPT_HASH_SAMPLE_CASES } =
    await import('../../../public/services/summary-prompt-minimal.js');

  // One line copied by hand out of each branch buildMinimalSummarizePrompt can take. If a branch is
  // not reachable from the sample cases the hash is built from, an edit to it changes the prompt the
  // model actually receives while the recording header keeps claiming the old one (issue #4). The
  // prayer/brief subject was exactly that hole when this was written.
  const branchMarkers = [
    'This is a prayer being offered.',
    'This is somebody speaking to the congregation.',
    'This is meeting information: announcements, dates, times, assignments, logistics.',
    'It must still read as a prayer being offered, not as a report that someone',
    'It must still read as them talking.',
    'Report it, in the third person.',
    'Shortening is the whole job'
  ];

  const corpus = PROMPT_HASH_SAMPLE_CASES
    .map(({ mode, level }) => buildMinimalSummarizePrompt({ recentTranscript: '', mode, level, maxWords: CARD_WORDS }))
    .join(' ');

  for (const marker of branchMarkers) {
    assert.ok(corpus.includes(marker), `no sample case reaches the prompt branch containing: ${marker}`);
  }
});
