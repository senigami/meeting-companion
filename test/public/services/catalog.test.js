import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listAvailableSummarizationSources,
  listAvailableTranscriptionSources
} from '../../../public/services/catalog.js';

test('service catalog exposes browser transcription and summary sources', () => {
  assert.deepEqual(
    listAvailableTranscriptionSources().map((source) => source.id),
    ['browser', 'openai', 'demo']
  );
  assert.deepEqual(
    listAvailableSummarizationSources().map((source) => source.id),
    ['openai', 'claude', 'demo']
  );
});

test('the demo transcription source needs no key and no microphone, so it is always offerable', () => {
  const demo = listAvailableTranscriptionSources().find((source) => source.id === 'demo');

  assert.ok(demo, 'demo source is missing from the catalog');
  assert.equal(demo.label, 'Demo');
  assert.match(demo.description, /no microphone or api key/i);
});
