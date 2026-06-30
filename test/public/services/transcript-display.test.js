import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTranscriptItems,
  segmentTranscriptText
} from '../../../public/services/transcript-display.js';

test('segments transcript text into digestible cards', () => {
  assert.deepEqual(
    segmentTranscriptText('First idea. Second idea. Third idea.'),
    ['First idea.', 'Second idea.', 'Third idea.']
  );

  const longSegments = segmentTranscriptText(
    'This is a long passage without punctuation but with enough words to require a break because the display should stay readable from a distance and not become a wall of text.'
  );

  assert.ok(longSegments.length > 1);
  assert.ok(longSegments.every((segment) => segment.length <= 120));
});

test('creates transcript items with mode and source metadata', () => {
  const items = createTranscriptItems({
    text: 'Welcome everyone. Please sit down.',
    mode: 'information',
    source: 'manual',
    createdAt: 123
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].mode, 'information');
  assert.equal(items[0].source, 'manual');
  assert.equal(items[0].createdAt, 123);
  assert.match(items[0].id, /^transcript-/);
  assert.equal(items[1].text, 'Please sit down.');
});
