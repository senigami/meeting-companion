import test from 'node:test';
import assert from 'node:assert/strict';

import { createDemoSummarizer } from '../../../../public/services/summarization/demo.js';
import { SUMMARY_MAX_WORDS } from '../../../../public/services/summary-prompt.js';

test('demo summarizer exposes the same shape as the other drivers', async () => {
  const summarizer = createDemoSummarizer();
  assert.equal(summarizer.id, 'demo');
  assert.equal(summarizer.label, 'Demo');

  const result = await summarizer.summarize({
    mode: 'speaker',
    recentTranscript: 'Brother Smith shared a story about his grandfather.',
    visibleLines: []
  });
  assert.equal(result.line, 'Brother Smith shared a story about his grandfather.');
});

test('returns the EARLIEST unshown sentence, one per tick, not the most recent and not several joined', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'We began with a hymn. Um, so the bishop announced the youth conference dates.',
    visibleLines: []
  });
  // One sentence only: a joined line was re-split by the display's own 120-char wrap, so two cards
  // appeared in the same instant and the first summary looked like it had been skipped.
  assert.equal(result.line, 'We began with a hymn.');
});

test('drops a hesitation sound but keeps an ordinary opening word, re-capitalising after the cut', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'Um, so the bishop announced the youth conference dates.',
    visibleLines: []
  });
  assert.equal(result.line, 'So the bishop announced the youth conference dates.');
});

test('keeps a sentence-opening word like "So" instead of beheading the sentence', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'So good to see so many familiar faces, and a few new ones too.',
    visibleLines: []
  });
  assert.equal(result.line, 'So good to see so many familiar faces, and a few new ones too.');
});

test('holds the shared 14-word display limit, shortening a long sentence at a clause boundary', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'There is a working bee at the hall on Saturday morning from nine, to tidy the garden beds and clear the gutters before winter.',
    visibleLines: []
  });

  assert.equal(result.line, 'There is a working bee at the hall on Saturday morning from nine');
  assert.ok(result.line.split(/\s+/).length <= SUMMARY_MAX_WORDS);
  // No ellipsis, ever: an earlier version truncated with "..." and it read as mangled rather than
  // shortened. A clause-boundary cut still reads as a phrase someone actually said.
  assert.ok(!result.line.includes('...'));
  assert.ok(!result.line.includes('\u2026'));
});

test('falls back to a word-boundary cut when even the first clause is too long, trimming a dangling function word off the end', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'The speaker described a very long and detailed story about a mission trip to a small village where the community gathered to help.',
    visibleLines: []
  });

  // The raw 14-word slice would end on the preposition "to" ("...a mission trip to"); trimming the
  // dangling function word off the end leaves 13 words ending on a noun instead.
  assert.equal(result.line, 'The speaker described a very long and detailed story about a mission trip');
  assert.ok(result.line.split(/\s+/).length < SUMMARY_MAX_WORDS);
  assert.ok(!result.line.includes('...'));
  assert.ok('The speaker described a very long and detailed story about a mission trip to a small village where the community gathered to help.'.startsWith(result.line));
});

test('prefers a fuller word-boundary cut over a short early clause, so an opening clause does not swallow the whole card', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'So this week, we want to remember our friends and family serving away from home and keep them in our thoughts and prayers.',
    visibleLines: []
  });

  // The first clause ("So this week") is only 3 words -- accepting it outright would waste most of
  // the card, which is the bug this replaced. Never ends on a dangling function word either.
  assert.notEqual(result.line, 'So this week');
  assert.ok(result.line.split(/\s+/).length >= 10);
  assert.ok(!/\b(a|an|the|and|but|or|so|because|if|to|of|with|from|over|under|about)$/i.test(result.line));
});

test('respects a passed maxWords rather than always using the shared default', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'There is a working bee at the hall on Saturday morning from nine, to tidy the garden beds and clear the gutters before winter.',
    visibleLines: [],
    maxWords: 8
  });

  assert.ok(result.line.split(/\s+/).length <= 8);
  assert.equal(result.line, 'There is a working bee at the hall');
});

test('a sentence inside the word limit is passed through untouched', async () => {
  const summarizer = createDemoSummarizer();
  const sentence = 'Brother Lee shared a scripture about hope.';
  const result = await summarizer.summarize({ recentTranscript: sentence, visibleLines: [] });
  assert.equal(result.line, sentence);
});

test('does not emit a fragment when no sentence is complete yet', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'the bishop is still in the middle of a sentence',
    visibleLines: []
  });
  assert.equal(result.line, '');
});

test('returns the nothing-useful result when the candidate is already visible', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'The bishop announced the youth conference dates.',
    visibleLines: ['The bishop announced the youth conference dates.']
  });
  assert.equal(result.line, '');
});

test('skips a sentence already shown but still returns the next unshown one', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'We began with a hymn. Sister Jones bore her testimony about faith and family.',
    visibleLines: ['We began with a hymn.']
  });
  assert.equal(result.line, 'Sister Jones bore her testimony about faith and family.');
});

test('returns the nothing-useful result on empty transcript', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: '',
    visibleLines: []
  });
  assert.equal(result.line, '');
});

test('never returns text that was not present in the input', async () => {
  const summarizer = createDemoSummarizer();
  const transcript = 'Sister Jones bore her testimony about faith and family.';
  const result = await summarizer.summarize({
    recentTranscript: transcript,
    visibleLines: []
  });
  if (result.line) {
    assert.ok(transcript.includes(result.line));
  }
});
