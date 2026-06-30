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
    'Do not summarize the prayer line by line. Only show a short status if the prayer has started, ended, or a request was announced.'
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

test('model line cleanup trims bullets and quotes', () => {
  assert.equal(cleanModelLine('  - "Hymn 241 selected"  '), 'Hymn 241 selected');
  assert.equal(cleanModelLine('Song starting now'), 'Song starting now');
});

test('vague model lines are rejected', () => {
  assert.equal(shouldAcceptModelLine('He is talking about faith.'), false);
  assert.equal(shouldAcceptModelLine('Hymn 241 selected', ['Hymn 241 selected']), false);
  assert.equal(shouldAcceptModelLine('Prayer has started'), true);
});

