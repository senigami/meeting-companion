import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseSummaryLevel, isSummaryLevel, BRIEF_MAX_CARD_WORDS } from '../../../public/services/summary-level.js';
import { buildMinimalSummarizePrompt } from '../../../public/services/summary-prompt-minimal.js';

test('a reading budget too small for anyone\'s voice selects brief', () => {
  // Measured 2026-08-02: about one word every two seconds. A 20s window is ten words.
  assert.equal(chooseSummaryLevel({ cardWords: 10 }), 'brief');
  assert.equal(chooseSummaryLevel({ cardWords: 8 }), 'brief');
  assert.equal(chooseSummaryLevel({ cardWords: BRIEF_MAX_CARD_WORDS }), 'brief');
});

test('a budget with room to spare keeps the condense level, which is not being thrown away', () => {
  assert.equal(chooseSummaryLevel({ cardWords: BRIEF_MAX_CARD_WORDS + 1 }), 'condense');
  assert.equal(chooseSummaryLevel({ cardWords: 17 }), 'condense');
  assert.equal(chooseSummaryLevel({ cardWords: 40 }), 'condense');
});

test('a missing or nonsense budget falls to brief, the safer of the two', () => {
  // Erring toward brief means erring toward "the reader can finish it", which is the failure we can
  // afford. Erring the other way puts text on the wall nobody gets to the end of.
  for (const bad of [undefined, null, 0, -3, NaN, 'lots']) {
    assert.equal(chooseSummaryLevel({ cardWords: bad }), 'brief', `budget ${String(bad)}`);
  }
  assert.equal(chooseSummaryLevel(), 'brief');
});

test('only the two known levels are accepted', () => {
  assert.ok(isSummaryLevel('brief'));
  assert.ok(isSummaryLevel('condense'));
  assert.ok(!isSummaryLevel('summary'));
  assert.ok(!isSummaryLevel(''));
  assert.ok(!isSummaryLevel(undefined));
});

test('the brief prompt asks for one line, third person, and the single most important thing', () => {
  const prompt = buildMinimalSummarizePrompt({ recentTranscript: 'Some speech.', mode: 'speaker', maxWords: 10, level: 'brief' });
  assert.match(prompt, /no more than 10 words/);
  assert.match(prompt, /ONE line/);
  assert.match(prompt, /third person/i);
  assert.match(prompt, /most important/i);
  // The reversal that matters: brief must NOT ask for the speaker's voice. Keeping first person at
  // ten words is what put words in people's mouths.
  assert.doesNotMatch(prompt, /must still read as them talking/);
  // "The speaker knows the Church is true" was the first live brief output: two of ten words spent
  // on a label the reader can already see. Third person must not become a per-card tax.
  assert.match(prompt, /Do not spend words on who is talking/);
});

test('the condense prompt still keeps the speaker\'s voice, so the level is a choice and not a migration', () => {
  const prompt = buildMinimalSummarizePrompt({ recentTranscript: 'Some speech.', mode: 'speaker', maxWords: 17, level: 'condense' });
  assert.match(prompt, /must still read as them talking/);
  assert.doesNotMatch(prompt, /third person/i);
});

test('brief prayer mode is still reported, not voiced', () => {
  const prompt = buildMinimalSummarizePrompt({ recentTranscript: 'A prayer.', mode: 'prayer', maxWords: 10, level: 'brief' });
  assert.match(prompt, /prayer being offered/);
  assert.match(prompt, /third person/i);
  // condense keeps the address and the amen; brief has no room for either and must not claim to.
  assert.doesNotMatch(prompt, /Keep the address/);
});
