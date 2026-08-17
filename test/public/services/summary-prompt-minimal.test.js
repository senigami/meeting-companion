import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMinimalSummarizeMessages, computeSummaryPromptHash } from '../../../public/services/summary-prompt-minimal.js';


test('a whitespace-only history entry is skipped, not folded in as blank context', async () => {
  const messages = buildMinimalSummarizeMessages({
    recentTranscript: 'New words.',
    mode: 'speaker',
    maxWords: 10,
    history: [{ spoken: '   ', shown: '  ' }, { spoken: 'Real chunk.', shown: 'Real card.' }]
  });

  assert.ok(!messages.some((m) => m.content.trim() === ''), 'no message may have empty content');
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user']);
  assert.match(messages[0].content, /Real chunk\./);
  assert.match(messages[0].content, /Real card\./);
  assert.doesNotMatch(messages[0].content, /"\s*"\s*\/\s*Shown/, 'the whitespace-only entry must not appear as blank context');
  assert.equal(messages.at(-1).content, 'New words.');
});

// 2026-08-09: real evidence prior history sat as user/assistant TURNS (a chat model imitates the
// style of its own preceding turn) rather than as inert context data. Isolated by reproducing a
// real session's "Sandy White said..." repetition streak directly: identical rules, identical ten
// chunks, real turns produced the "Name said" preamble on 7 of 10 cards; the same history folded
// into the system message as plain "Said/Shown" data produced it on none. This is the structural
// guarantee that regression tested against, so it must survive any future edit to this function.
test('prior context is folded into the system message as data, never as user/assistant turns', async () => {
  const messages = buildMinimalSummarizeMessages({
    recentTranscript: 'New words.',
    mode: 'speaker',
    maxWords: 10,
    history: [{ spoken: 'Earlier chunk.', shown: 'Earlier card.' }]
  });

  assert.deepEqual(messages.map((m) => m.role), ['system', 'user'],
    'no assistant turn -- a prior card must never sit where a chat model expects to continue its own style');
  assert.match(messages[0].content, /for context only/i);
  assert.match(messages[0].content, /do not repeat or imitate the wording/i);
  assert.match(messages[0].content, /Earlier chunk\./);
  assert.match(messages[0].content, /Earlier card\./);
  assert.equal(messages.at(-1).content, 'New words.');
});

// Real bug, 2026-08-16 recording: a history block established "Dr. Alexander Gilson"; a later block
// that only said "Gilson will be our speaker" came back as "Dr. Gilson will speak" -- the model
// pulled the title from history context rather than the current block's own text. The history clause
// only forbade repeating WORDING, not pulling FACTS across, so this asserts the new, separate
// constraint is present whenever history exists.
test('the system prompt forbids pulling facts from history into the current summary', async () => {
  const messages = buildMinimalSummarizeMessages({
    recentTranscript: 'Gilson will be our speaker.',
    mode: 'speaker',
    maxWords: 10,
    history: [{ spoken: 'We welcome Dr. Alexander Gilson.', shown: 'Dr. Alexander Gilson.' }]
  });

  assert.match(messages[0].content, /summarize only the Text below/i);
  assert.match(messages[0].content, /if the Text does not say it, leave it out/i);
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
  // Updated 2026-08-10 (third time same day): WORD_SELECTIVITY reworded to Steve's own phrasing
  // ("be frugal with your words -- include only the ones that meaningfully contribute to the
  // meaning being conveyed"), replacing the first draft's "be picky... add real information."
  // Updated 2026-08-17: TRANSLATE made an unconditional, standalone rule and the anti-duplication
  // clause reworded as a hard constraint, after two real transcription bugs (untranslated Thai
  // segment; looping on prior phrasing with no named speaker).
  assert.equal(computeSummaryPromptHash(), 'c64c32b6');
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
    'Summarize the main point of this text using simple words, as',
    'Write in the third person. Do not write as the speaker or use "I".',
    'Pull out the most important information.'
  ];

  const corpus = PROMPT_HASH_SAMPLE_CASES
    .map(({ mode, level }) => buildMinimalSummarizePrompt({ recentTranscript: '', mode, level, maxWords: CARD_WORDS }))
    .join(' ');

  for (const marker of branchMarkers) {
    assert.ok(corpus.includes(marker), `no sample case reaches the prompt branch containing: ${marker}`);
  }
});
