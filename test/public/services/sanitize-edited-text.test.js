import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeEditedText } from '../../../public/services/sanitize-edited-text.js';

test('plain text passes through unchanged apart from trimming', () => {
  assert.equal(sanitizeEditedText('  hello there  '), 'hello there');
});

test('a <div> line-break artifact from a browser-inserted paragraph collapses to a single space', () => {
  // contenteditable in some browsers wraps a pasted/typed newline in its own <div>; the text the
  // node hands back can carry that as a literal newline between what were two separate blocks.
  assert.equal(sanitizeEditedText('first line\nsecond line'), 'first line second line');
});

test('a <br>-style artifact (also surfaces as a bare newline) collapses the same way', () => {
  assert.equal(sanitizeEditedText('one\n\ntwo'), 'one two');
});

test('zero-width characters are stripped entirely, not just trimmed from the ends', () => {
  assert.equal(sanitizeEditedText('one​two﻿three'), 'onetwothree');
});

test('runs of whitespace collapse to one space, mirroring normalizeText', () => {
  assert.equal(sanitizeEditedText('one   two\t\tthree'), 'one two three');
});

test('empty or whitespace-only input sanitizes to the empty string', () => {
  assert.equal(sanitizeEditedText('   \n  '), '');
  assert.equal(sanitizeEditedText(null), '');
  assert.equal(sanitizeEditedText(undefined), '');
});
