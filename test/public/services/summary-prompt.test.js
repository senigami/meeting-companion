import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanModelLine,
  cleanModelLines,
  MAX_LINES_PER_CALL,
  shouldAcceptModelLine
} from '../../../public/services/summary-prompt.js';

test('model line cleanup trims bullets and quotes', () => {
  assert.equal(cleanModelLine('  - "Hymn 241 selected"  '), 'Hymn 241 selected');
  assert.equal(cleanModelLine('Song starting now'), 'Song starting now');
});

test('vague model lines are rejected', () => {
  assert.equal(shouldAcceptModelLine('He is talking about faith.'), false);
  assert.equal(shouldAcceptModelLine('Hymn 241 selected', ['Hymn 241 selected']), false);
  assert.equal(shouldAcceptModelLine('Prayer has started'), true);
});

test('cleanModelLines preserves the order the ideas were spoken in', () => {
  const modelReply = 'Closing hymn will be number 301.\nSister Margaret Ellsworth will offer the benediction.';
  const lines = cleanModelLines(modelReply, []);

  assert.deepEqual(lines, [
    'Closing hymn will be number 301.',
    'Sister Margaret Ellsworth will offer the benediction.'
  ]);
});

test('cleanModelLines drops only the offending line, not its siblings, when one duplicates a visible line', () => {
  const modelReply = 'Hymn 241 selected.\nSister Karen Nielsen is the new primary music leader.\nBrother Smith will speak.';
  const lines = cleanModelLines(modelReply, ['Hymn 241 selected.']);

  assert.deepEqual(lines, [
    'Sister Karen Nielsen is the new primary music leader.',
    'Brother Smith will speak.'
  ]);
});

test('cleanModelLines drops only the offending line, not its siblings, when one is vague filler', () => {
  const modelReply = 'He is talking about faith.\nHymn 142 will open the meeting.';
  const lines = cleanModelLines(modelReply, []);

  assert.deepEqual(lines, ['Hymn 142 will open the meeting.']);
});

test('cleanModelLines caps at MAX_LINES_PER_CALL even when the model returns more', () => {
  assert.equal(MAX_LINES_PER_CALL, 3);
  const modelReply = [
    'First item announced.',
    'Second item announced.',
    'Third item announced.',
    'Fourth item announced.'
  ].join('\n');

  const lines = cleanModelLines(modelReply, []);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines, ['First item announced.', 'Second item announced.', 'Third item announced.']);
});

test('cleanModelLines de-duplicates a repeated line within the same reply without dropping later distinct ideas', () => {
  const modelReply = 'Hymn 142 will open the meeting.\nHymn 142 will open the meeting.\nInvocation by Brother Whitfield.';
  const lines = cleanModelLines(modelReply, []);

  assert.deepEqual(lines, ['Hymn 142 will open the meeting.', 'Invocation by Brother Whitfield.']);
});

test('cleanModelLines returns an empty array for blank or whitespace-only replies', () => {
  assert.deepEqual(cleanModelLines('', []), []);
  assert.deepEqual(cleanModelLines('   \n  \n', []), []);
});
