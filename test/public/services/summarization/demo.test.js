import test from 'node:test';
import assert from 'node:assert/strict';

import { createDemoSummarizer } from '../../../../public/services/summarization/demo.js';

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

test('picks the most recent complete sentence, skipping filler openers', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'We began with a hymn. Um, so the bishop then announced the youth conference dates.',
    visibleLines: []
  });
  assert.equal(result.line, 'the bishop then announced the youth conference dates.');
});

test('truncates long lines on a word boundary with an ellipsis', async () => {
  const summarizer = createDemoSummarizer();
  const longSentence = 'The speaker described a very long and detailed story about a mission trip to a small village where the community gathered together for a meal.';
  const result = await summarizer.summarize({
    recentTranscript: longSentence,
    visibleLines: []
  });
  assert.ok(result.line.length <= 72);
  assert.ok(result.line.endsWith('...'));
  assert.ok(!longSentence.includes(result.line));
  const withoutEllipsis = result.line.slice(0, -3).trim();
  assert.ok(longSentence.startsWith(withoutEllipsis));
});

test('returns the nothing-useful result when the candidate is already visible', async () => {
  const summarizer = createDemoSummarizer();
  const result = await summarizer.summarize({
    recentTranscript: 'The bishop announced the youth conference dates.',
    visibleLines: ['The bishop announced the youth conference dates.']
  });
  assert.equal(result.line, '');
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
    assert.ok(transcript.includes(result.line.replace(/\.\.\.$/, '').trim()));
  }
});
