import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSummarizePrompt,
  cleanModelLine,
  cleanModelLines,
  MAX_LINES_PER_CALL,
  modeInstruction,
  shouldAcceptModelLine,
  SUMMARY_MAX_WORDS
} from '../../../public/services/summary-prompt.js';
import { buildMinimalSummarizePrompt } from '../../../public/services/summary-prompt-minimal.js';

// Asserted by substance, not by exact prose: pinning the whole sentence made every wording
// improvement look like a regression, which is the opposite of what this test is for.
test('mode instructions stay specific', () => {
  assert.match(
    modeInstruction('information'),
    /exact dates, times, places, hymn numbers, assignments, and announcements/
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

// The reader is an ASL-first, low-vision, slow reader. These clauses are the accessibility contract,
// not stylistic preference, so they are pinned by substance the way the anti-vagueness rules are.
test('prompt states the accessibility contract for an ASL-first, low-vision reader', () => {
  const prompt = buildSummarizePrompt({ mode: 'speaker', recentTranscript: 'Anything at all.' });

  assert.match(prompt, /never ASL gloss or ASL word order/i);
  assert.match(prompt, /Lead with the topic or the person/i);
  assert.match(prompt, /No idioms, figures of speech/i);
  assert.match(prompt, /Name the person rather than writing "he", "she", or "they"/i);
  assert.match(prompt, /One idea per line/i);
  assert.match(prompt, /never paraphrase a number/i);
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

test('prompt honours a passed maxWords and defaults to the shared limit', () => {
  const defaultPrompt = buildSummarizePrompt({ mode: 'speaker', recentTranscript: 'Anything at all.' });
  assert.match(defaultPrompt, new RegExp(`Maximum ${SUMMARY_MAX_WORDS} words`));

  const customPrompt = buildSummarizePrompt({ mode: 'speaker', recentTranscript: 'Anything at all.', maxWords: 8 });
  assert.match(customPrompt, /Maximum 8 words/);
});

test('prompt instructs catch-up behavior without relaxing verbatim details', () => {
  const prompt = buildSummarizePrompt({
    mode: 'speaker',
    recentTranscript: 'A long backlog of speech spanning several cards worth of content.',
    visibleLines: ['Forgive one another.']
  });

  assert.match(prompt, /Do not repeat what a visible line already says/i);
  assert.match(prompt, /write the core message as it stands\s*\nnow, not the opening of it/i);
  assert.match(prompt, /paragraph one of five/i);
  assert.match(prompt, /missing from the visible lines, say that now/i);
  assert.match(prompt, /never dropping or\s*\nsoftening a name, date, time, hymn number, or assignment/i);
  assert.match(prompt, /ceiling to cut toward, not a target to reach by rounding a number off/i);
});

// The rolling two-block window (.agent/rolling-window-brief.md): the previous block must render
// under its own label, marked context-only, distinct from the current transcript's label -- a
// concatenated blob would let the model re-summarize old content in different words and sail past
// shouldAcceptModelLine's exact-key dedupe.
test('previous block renders under its own context-only label, distinct from the current transcript', () => {
  const prompt = buildSummarizePrompt({
    mode: 'speaker',
    recentTranscript: 'The new sentence just spoken.',
    previousBlock: 'The earlier sentence already summarized.',
    visibleLines: []
  });

  assert.match(prompt, /Previous block \(already summarized -- context only\. Do NOT write a line about this block by itself/i);
  assert.match(prompt, /The earlier sentence already summarized\./);
  assert.match(prompt, /New transcript \(summarize this\):\s*\nThe new sentence just spoken\./);

  const previousIndex = prompt.indexOf('The earlier sentence already summarized.');
  const newIndex = prompt.indexOf('The new sentence just spoken.');
  assert.ok(previousIndex > -1 && newIndex > -1 && previousIndex < newIndex);
});

test('an absent or empty previousBlock leaves the prompt byte-identical to today\'s prompt', () => {
  const args = { mode: 'speaker', recentTranscript: 'Anything at all.', visibleLines: ['A visible line.'], maxWords: 10 };

  const withoutField = buildSummarizePrompt(args);
  const withEmptyString = buildSummarizePrompt({ ...args, previousBlock: '' });
  const withWhitespaceOnly = buildSummarizePrompt({ ...args, previousBlock: '   ' });

  assert.equal(withEmptyString, withoutField);
  assert.equal(withWhitespaceOnly, withoutField);
  assert.match(withoutField, /Recent transcript:\nAnything at all\./);
  assert.doesNotMatch(withoutField, /Previous block/i);
});

test('max-words and verbatim-entity contract still hold with a previous block present', () => {
  const prompt = buildSummarizePrompt({
    mode: 'information',
    recentTranscript: 'Hymn 241 will be sung at 10:15 by Sister Jones.',
    previousBlock: 'The meeting opened with a welcome from Brother Smith on July 19.',
    visibleLines: [],
    maxWords: 8
  });

  assert.match(prompt, /Maximum 8 words/);
  assert.match(prompt, /never paraphrase a number/i);
  assert.match(prompt, /Copy every number, name, and date exactly/i);
  assert.match(prompt, /Hymn 241 will be sung at 10:15 by Sister Jones\./);
  assert.match(prompt, /Brother Smith on July 19\./);
});

// INV-13: fabricated content on the wall is the worst failure mode -- a made-up hymn number sends
// the reader to the wrong hymn with no way to catch the error. This governs inventing a detail that
// was never spoken, distinct from the verbatim-entity rule above, which governs one that was.
test('prompt forbids inventing a specific detail that was not spoken', () => {
  const prompt = buildSummarizePrompt({ mode: 'speaker', recentTranscript: 'Anything at all.' });

  assert.match(prompt, /Never invent a number, name, date, time, or other specific detail that was not spoken/i);
  assert.match(prompt, /"our first hymn,"/);
  assert.match(prompt, /do not turn it into "hymn number one"/i);
  assert.match(prompt, /carry the speaker's\s*\nown descriptive wording instead of supplying one/i);
  assert.match(prompt, /A confident specific you made up is worse than a\s*\nfaithful vague line/i);
});

test('anti-fabrication clause survives with and without a previous block', () => {
  const withPrevious = buildSummarizePrompt({
    mode: 'information',
    recentTranscript: 'Let us stand together now and turn to our first hymn.',
    previousBlock: 'The meeting opened with a welcome from Brother Smith on July 19.',
    visibleLines: []
  });
  const withoutPrevious = buildSummarizePrompt({
    mode: 'information',
    recentTranscript: 'Let us stand together now and turn to our first hymn.',
    visibleLines: []
  });

  assert.match(withPrevious, /Never invent a number, name, date, time, or other specific detail that was not spoken/i);
  assert.match(withoutPrevious, /Never invent a number, name, date, time, or other specific detail that was not spoken/i);
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

// The prompt now allows up to three ideas per reply, one per line -- these guard the exact three
// failure modes the coordinator called out: ordering, sibling-suppression on dedupe, and the cap.
test('prompt allows up to three newline-separated ideas, capped, one per line', () => {
  const prompt = buildSummarizePrompt({ mode: 'speaker', recentTranscript: 'Anything at all.' });

  assert.match(prompt, /zero, one, two, or three lines, one idea per line, separated by newlines/i);
  assert.match(prompt, /Never merge two\s*\nideas into one line/i);
  assert.match(prompt, /recovered on a later call/i);
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

test('both summarize prompts ask for digits, and neither loses the rule that a number nobody said stays unsaid', () => {
  // #12. Spelled-out numbers are slower to read, and "exactly as they were said" pushed toward
  // them. The OpenAI path already carried this rule; the path built here did not, which is the
  // whole gap. The two rules sit close together and pull in opposite directions, so this pins them
  // as a pair: a prompt with the digits rule and without the descriptive-reference protection is
  // the failure mode worth guarding against, since it is a prompt that will guess a hymn number.
  const prompts = [
    buildSummarizePrompt({ mode: 'information', recentTranscript: 'Hymn one hundred thirty six at nine o clock.', maxWords: 12 }),
    buildMinimalSummarizePrompt({ mode: 'information', recentTranscript: 'Hymn one hundred thirty six at nine o clock.', cardWords: 12 })
  ];

  for (const prompt of prompts) {
    assert.match(prompt, /digits/i, 'the reader gets digits, not spelled-out numbers');
    assert.match(prompt, /not\s+(?:as\s+)?words|rather than nine o'clock|rather than hymn one hundred/i);
    assert.match(prompt, /not\s+(?:be\s+)?(?:add|said|spoken)|was not spoken|not said/i,
      'a number nobody said must still stay unsaid');
  }

  // The path this issue is actually about must be explicit that the two rules have an order,
  // rather than leaving a reader of the prompt to guess which one gives way.
  assert.match(prompts[0], /never licenses supplying one that was not/i);
  assert.match(prompts[0], /"our first hymn,?"/i);
});
