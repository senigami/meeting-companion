import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseSummaryLevel, isSummaryLevel, BRIEF_MAX_CARD_WORDS } from '../../../public/services/summary-level.js';
import { buildMinimalSummarizePrompt } from '../../../public/services/summary-prompt-minimal.js';

// Closes a coverage gap found in adversarial review 2026-08-08: the 12 tests that checked the prompt
// TEXT for anti-fabrication/verbatim-entity language were deleted alongside the dead buildSummarizePrompt
// they tested, and nothing replaced them for the prompt actually in use. Every mode must carry both.
test('every mode\'s live prompt carries the anti-fabrication and verbatim-entity contract', () => {
  for (const mode of ['speaker', 'prayer', 'information']) {
    for (const level of ['condense', 'brief']) {
      const prompt = buildMinimalSummarizePrompt({ recentTranscript: 'Anything at all.', mode, level });
      assert.match(prompt, /Never invent a name, number, date, or detail that was not said/, `${mode}/${level}`);
      assert.match(prompt, /never paraphrased and never rounded/, `${mode}/${level}`);
      assert.match(prompt, /Never ASL gloss/, `${mode}/${level}`);
    }
  }
});

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
  assert.match(prompt, /target 10 words/);
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

test('the condense prompt is third person too now, but still a distinct prompt from brief', () => {
  // Steve, 2026-08-08, tested against a real recording: condense speaker mode drops the
  // speaker's-voice framing and goes third person, same as brief. That is a deliberate reversal of
  // this test's old name, not a regression -- what still matters is that condense and brief remain
  // two distinct prompts rather than one silently collapsing into the other.
  const prompt = buildMinimalSummarizePrompt({ recentTranscript: 'Some speech.', mode: 'speaker', maxWords: 17, level: 'condense' });
  assert.match(prompt, /Third person only/);
  assert.doesNotMatch(prompt, /must still read as them talking/);
  assert.match(prompt, /8 year old/);
  assert.doesNotMatch(prompt, /single most important/i);
});

test('brief prayer mode is still reported, not voiced', () => {
  const prompt = buildMinimalSummarizePrompt({ recentTranscript: 'A prayer.', mode: 'prayer', maxWords: 10, level: 'brief' });
  assert.match(prompt, /prayer being offered/);
  assert.match(prompt, /third person/i);
  // Neither level ever asks the model to add an address or amen (2026-08-08: that instruction
  // fabricated both on every mid-prayer card). This just guards brief specifically never regains it.
  assert.doesNotMatch(prompt, /Keep the address/);
});

test('brief never invites the model to drop speech it judges unimportant (#32)', () => {
  // #32: the old prompt said "if the moment is vague or repetitive, return an empty string", and the
  // filter systematically preferred garbage to speech -- real conversational speech reads as vague,
  // while a hallucinated foreign fragment reads as new. Recording 2026-07-31T18-30-52-855Z has
  // "I am now going to stop talking for a bit" dropped and "Uchaf." shown.
  //
  // brief reintroduced the same filter for a day, because a ten-word budget makes "only if it's
  // worth it" sound like thrift. It is not thrift; it is the summarizer deciding whether somebody's
  // words counted.
  const prompt = buildMinimalSummarizePrompt({ recentTranscript: 'Some speech.', mode: 'speaker', maxWords: 10, level: 'brief' });
  assert.match(prompt, /Never return nothing because what was said seems unimportant/);
  assert.doesNotMatch(prompt, /worth a card/, 'no worthiness test may reach the prompt');
});

test('information mode never takes brief, whatever the reading budget', () => {
  // Found by Cato before this branch shipped. brief keeps ONE line, so a round of announcements had
  // every line after the first hard-dropped: "Closing hymn 301" and "Sister Ellsworth will offer the
  // benediction" arrive as two lines and one simply never reached the wall, with no error and no
  // telemetry. Merging two announcements was already guarded against; discarding one is worse.
  for (const cardWords of [8, 10, 11, 14, 17]) {
    assert.equal(chooseSummaryLevel({ cardWords, mode: 'information' }), 'condense', `budget ${cardWords}`);
  }
  // And an absent/nonsense budget must not sneak information mode back onto brief either.
  assert.equal(chooseSummaryLevel({ mode: 'information' }), 'condense');
  assert.equal(chooseSummaryLevel({ cardWords: 'lots', mode: 'information' }), 'condense');
  // Speaker at the same budgets is unaffected.
  assert.equal(chooseSummaryLevel({ cardWords: 10, mode: 'speaker' }), 'brief');
});
