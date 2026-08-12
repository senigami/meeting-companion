import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanModelLine,
  cleanModelLines,
  MAX_LINES_PER_CALL,
  shouldAcceptModelLine,
  hasSubstantiveContent
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

// 2026-08-10, Steve, from a real prayer that never printed its closing: a prior version of this
// gate required several real words specifically to hold a bare "Amen." back a tick, and there is
// no way to tell "Amen" (real, complete, meaningful) apart from "Okay" (filler) by word count --
// they are both one word. "Gating bucket and summary should work the same": the gate now only
// rejects text with no letter or digit in it at all, matching what the summarizer's own prompt
// already promises (return nothing only when the text holds no real words at all).
test('a real one-word closing like "Amen." is never held back by the content gate', () => {
  assert.equal(hasSubstantiveContent('Amen.'), true);
  assert.equal(hasSubstantiveContent('Amen'), true);
});

test('the content gate only rejects text with no letter or digit at all, in any script', () => {
  assert.equal(hasSubstantiveContent('.'), false);
  assert.equal(hasSubstantiveContent(''), false);
  assert.equal(hasSubstantiveContent('   '), false);
  // Filler is no longer specially detected -- it can reach the network now; isNonAnswerLine below
  // is what catches the model's occasional literal non-answer to it, not this gate.
  assert.equal(hasSubstantiveContent('Okay.'), true);
  // Non-Latin scripts: Chinese/Japanese do not space-delimit words, so a word-count-based version
  // of this gate held real testimony back forever (confirmed by direct test, 2026-08-09) -- a
  // single Unicode letter of any script is enough now.
  assert.equal(hasSubstantiveContent('我'), true);
  assert.equal(hasSubstantiveContent('오늘'), true);
});

// 2026-08-10: the display-side counterpart to widening the gate above. The model occasionally
// answers a real network call with a literal "Nothing was said." instead of returning empty text
// as the prompt asks for -- observed directly in a real session. Caught here the same way a
// refusal already is, not re-added as a stricter pre-send gate.
test('a literal "nothing was said" reply is rejected as a non-answer, not displayed as a card', () => {
  assert.equal(shouldAcceptModelLine('Nothing was said.'), false);
  assert.equal(shouldAcceptModelLine('Nothing significant was said.'), false);
  assert.equal(shouldAcceptModelLine('Nothing important was said'), false);
  // A real card that happens to start with the word "nothing" must still get through.
  assert.equal(shouldAcceptModelLine('Nothing was decided at the meeting, so plans continue.'), true);
  assert.equal(shouldAcceptModelLine('Amen.'), true);
});

// Both rejected strings are the exact refusals observed in the 2026-08-09 real session, and both
// reached the wall as if they were summaries. The accepted strings matter more: this filter drops
// silently, the way a vague or duplicate line does, so a false positive costs a real card with
// nothing on the display to say one went missing. PRAYER mode is deliberately first person
// (summary-prompt-minimal.js), which is why first-person "I cannot ..." content is a live case here
// rather than a hypothetical one.
test('a model refusal is rejected, and first-person content that merely starts like one is not', () => {
  assert.equal(shouldAcceptModelLine("I'm sorry, but I can only respond in English."), false);
  assert.equal(shouldAcceptModelLine("I'm sorry, but I can't assist with that."), false);
  assert.equal(shouldAcceptModelLine('I cannot assist with that.'), false);
  assert.equal(shouldAcceptModelLine("I can't help."), false);

  assert.equal(shouldAcceptModelLine("I'm sorry the meeting ran long, the leader said."), true);
  assert.equal(shouldAcceptModelLine("I'm sorry for the confusion, the bishop explained."), true);
  assert.equal(shouldAcceptModelLine('As an AI hobbyist, the speaker builds robots.'), true);
  assert.equal(shouldAcceptModelLine('I cannot help but feel grateful for this ward.'), true);
  assert.equal(shouldAcceptModelLine('I cannot help my brother without Thy strength.'), true);
  assert.equal(shouldAcceptModelLine('I cannot thank Thee enough for this day.'), true);
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
