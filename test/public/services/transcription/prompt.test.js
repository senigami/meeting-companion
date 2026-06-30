import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTranscriptionPrompt } from '../../../../public/services/transcription/prompt.js';

test('transcription prompt stays short and mode aware', () => {
  assert.match(buildTranscriptionPrompt('speaker'), /Church meeting audio transcription/i);
  assert.match(buildTranscriptionPrompt('information'), /Preserve exact dates, times, places, hymn numbers/i);
  assert.match(buildTranscriptionPrompt('song'), /hymn or song status/i);
});

