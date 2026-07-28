import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSummarizePrompt, cleanModelLine, modeInstruction, shouldAcceptModelLine, SUMMARY_MAX_WORDS } from '../../../public/services/summary-prompt.js';

// Asserted by substance, not by exact prose: pinning the whole sentence made every wording
// improvement look like a regression, which is the opposite of what this test is for.
test('mode instructions stay specific', () => {
  assert.match(
    modeInstruction('information'),
    /exact dates, times, places, hymn numbers, assignments, and announcements/
  );
  assert.equal(
    modeInstruction('prayer'),
    'Write a short prayer-shaped line that keeps the main requests and tone. Start with a simple opening like "Heavenly Father" and end with "Amen". Do not summarize line by line.'
  );
});

test('prompt requires useful, specific output and rejects vague filler', () => {
  const prompt = buildSummarizePrompt({
    mode: 'speaker',
    recentTranscript: 'The speaker gave an example about forgiving a neighbor.',
    visibleLines: ['Forgive one another.']
  });

  assert.match(prompt, /Only add a line when the transcript contains something useful that is new or more specific/i);
  assert.match(prompt, /Avoid lines like "He is talking about faith\."/i);
  assert.match(prompt, /Visible lines already shown:/i);
  assert.match(prompt, /Forgive one another\./i);
});

// The reader is an ASL-first, low-vision, slow reader. These clauses are the accessibility contract,
// not stylistic preference, so they are pinned by substance the way the anti-vagueness rules are.
test('prompt states the accessibility contract for an ASL-first, low-vision reader', () => {
  const prompt = buildSummarizePrompt({ mode: 'speaker', recentTranscript: 'Anything at all.' });

  assert.match(prompt, /never ASL gloss or ASL word order/i);
  assert.match(prompt, /Lead with the topic or the person/i);
  assert.match(prompt, /No idioms, figures of speech/i);
  assert.match(prompt, /Name the person rather than writing "he", "she", or "they"/i);
  assert.match(prompt, /One idea per line/i);
  assert.match(prompt, /never paraphrase a number/i);
});

test('prayer mode prompt keeps the output prayer-shaped and brief', () => {
  const prompt = buildSummarizePrompt({
    mode: 'prayer',
    recentTranscript: 'Heavenly Father, please help the family and give them peace.',
    visibleLines: []
  });

  assert.match(prompt, /Write a short prayer-shaped line/i);
  assert.match(prompt, /Start with a simple opening like "Heavenly Father"/i);
  assert.match(prompt, /end with "Amen"/i);
  assert.match(prompt, /Do not summarize line by line\./i);
});

test('prompt honours a passed maxWords and defaults to the shared limit', () => {
  const defaultPrompt = buildSummarizePrompt({ mode: 'speaker', recentTranscript: 'Anything at all.' });
  assert.match(defaultPrompt, new RegExp(`Maximum ${SUMMARY_MAX_WORDS} words`));

  const customPrompt = buildSummarizePrompt({ mode: 'speaker', recentTranscript: 'Anything at all.', maxWords: 8 });
  assert.match(customPrompt, /Maximum 8 words/);
});

test('model line cleanup trims bullets and quotes', () => {
  assert.equal(cleanModelLine('  - "Hymn 241 selected"  '), 'Hymn 241 selected');
  assert.equal(cleanModelLine('Song starting now'), 'Song starting now');
});

test('vague model lines are rejected', () => {
  assert.equal(shouldAcceptModelLine('He is talking about faith.'), false);
  assert.equal(shouldAcceptModelLine('Hymn 241 selected', ['Hymn 241 selected']), false);
  assert.equal(shouldAcceptModelLine('Prayer has started'), true);
});
