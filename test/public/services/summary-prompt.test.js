import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSummarizePrompt, cleanModelLine, modeInstruction, shouldAcceptModelLine } from '../../../public/services/summary-prompt.js';

test('mode instructions stay specific', () => {
  assert.equal(
    modeInstruction('information'),
    'Prioritize exact dates, times, places, hymn numbers, assignments, and announcements.'
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

test('model line cleanup trims bullets and quotes', () => {
  assert.equal(cleanModelLine('  - "Hymn 241 selected"  '), 'Hymn 241 selected');
  assert.equal(cleanModelLine('Song starting now'), 'Song starting now');
});

test('vague model lines are rejected', () => {
  assert.equal(shouldAcceptModelLine('He is talking about faith.'), false);
  assert.equal(shouldAcceptModelLine('Hymn 241 selected', ['Hymn 241 selected']), false);
  assert.equal(shouldAcceptModelLine('Prayer has started'), true);
});
