import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listAvailableSummarizationSources,
  listAvailableTranscriptionSources
} from '../../../public/services/catalog.js';

test('service catalog exposes browser and openai transcription sources', () => {
  assert.deepEqual(
    listAvailableTranscriptionSources().map((source) => source.id),
    ['browser', 'openai']
  );
  assert.deepEqual(
    listAvailableSummarizationSources().map((source) => source.id),
    ['openai']
  );
});

