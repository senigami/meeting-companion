import test from 'node:test';
import assert from 'node:assert/strict';

import { providerDetailExplanation, readResponseJson, responseErrorMessage } from '../../../public/services/response.js';

test('response helper reads raw non-json text safely', async () => {
  const data = await readResponseJson({
    text: async () => 'plain text error'
  });

  assert.equal(data.raw, 'plain text error');
  assert.equal(responseErrorMessage(data, 'fallback message'), 'plain text error');
});

// These codes reached the operator as a bare "Summarization failed." while the actual cause sat in the
// server log. A key with no credit is the most likely real failure once someone moves off the demo
// sources, and mid-meeting is the worst possible time to go reading logs to find that out.
test('provider quota, key, rate-limit and model errors become actionable text', () => {
  assert.match(providerDetailExplanation('insufficient_quota'), /no API credit left/i);
  assert.match(providerDetailExplanation('You exceeded your current quota'), /no API credit left/i);
  assert.match(providerDetailExplanation('invalid_api_key'), /key was rejected/i);
  assert.match(providerDetailExplanation('429 Too Many Requests'), /rate limiting/i);
  assert.match(providerDetailExplanation('model_not_found'), /cannot use the configured model/i);
});

// INV-13: demo sources are rehearsal-only. Recommending Demo as a mid-meeting fix would put text on
// the wall that nobody said, to a reader who cannot hear the room and so cannot tell it is wrong. An
// earlier version of these messages said "or switch summaries to Demo" -- this guards the reversal.
test('no provider error ever recommends switching to a demo source', () => {
  const details = [
    'insufficient_quota',
    'invalid_api_key',
    '429 Too Many Requests',
    'model_not_found'
  ];

  for (const detail of details) {
    const explanation = providerDetailExplanation(detail);
    assert.notEqual(explanation, '', `${detail} should still be explained`);
    assert.doesNotMatch(explanation, /demo/i, `${detail} must not offer a demo source as a remedy`);
    assert.match(explanation, /manually/i, `${detail} should point at the manual fallback`);
  }
});

test('an unrecognized or absent detail explains nothing rather than guessing', () => {
  assert.equal(providerDetailExplanation('socket hang up'), '');
  assert.equal(providerDetailExplanation(''), '');
  assert.equal(providerDetailExplanation(undefined), '');
});

test('an actionable explanation replaces the generic error instead of stacking with it', () => {
  const message = responseErrorMessage({ error: 'Summarization failed.', detail: 'insufficient_quota' });

  assert.match(message, /^The account has no API credit left/);
  // The caller supplies its own "Could not summarize:" prefix, so keeping the generic failure here
  // produced three clauses about failure and only one about the cause.
  assert.doesNotMatch(message, /Summarization failed/i);
});

test('a response with no actionable detail keeps its own error text, then the fallback', () => {
  assert.equal(responseErrorMessage({ error: 'Summarization failed.' }), 'Summarization failed.');
  assert.equal(responseErrorMessage({ detail: 'socket hang up' }, 'Request failed.'), 'Request failed.');
  assert.equal(responseErrorMessage({}, 'Request failed.'), 'Request failed.');
});
