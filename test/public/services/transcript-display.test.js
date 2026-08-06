import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeFlipDeltas,
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

// Issue #40: speaker is a plain display field on the item, attached once per card at creation and
// otherwise inert to segmentation -- multiple cards split from one source text all carry the same
// speaker, since they are all still one person's speech.
test('createTranscriptItems attaches a trimmed speaker to every card split from the same text', () => {
  const items = createTranscriptItems({
    text: 'Welcome everyone. Please sit down.',
    mode: 'speaker',
    source: 'manual',
    speaker: '  Bro. Ashcroft  '
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].speaker, 'Bro. Ashcroft');
  assert.equal(items[1].speaker, 'Bro. Ashcroft');
});

test('createTranscriptItems defaults speaker to empty, never inventing a placeholder', () => {
  const items = createTranscriptItems({
    text: 'A line with no speaker set.',
    mode: 'speaker',
    source: 'manual'
  });

  assert.equal(items[0].speaker, '');
});

test('a title or initial does not end a sentence, so no card ever reads just "Bro."', () => {
  assert.deepEqual(
    segmentTranscriptText('Bro. Smith will speak on service this morning at eleven.'),
    ['Bro. Smith will speak on service this morning at eleven.']
  );
  assert.deepEqual(
    segmentTranscriptText('Sis. Jones and Pres. Lee will conduct.'),
    ['Sis. Jones and Pres. Lee will conduct.']
  );
  assert.deepEqual(
    segmentTranscriptText('J. Reuben Clark said it plainly.'),
    ['J. Reuben Clark said it plainly.']
  );
  // A real sentence break still splits.
  assert.deepEqual(
    segmentTranscriptText('We began with a hymn. Then the bishop spoke.'),
    ['We began with a hymn.', 'Then the bishop spoke.']
  );
});

test('a dotted time-of-day abbreviation does not sever the clause that follows it', () => {
  // The exact bug seen live on the wall: "a.m." was splitting into "a." + "m.", and even after
  // those merged back into one token, the following lowercase clause ("in the chapel.") was left
  // as its own stranded card, severing the funeral's location from the funeral.
  assert.deepEqual(
    segmentTranscriptText('The funeral service for Tom is Thursday at 11:00 a.m. in the chapel.'),
    ['The funeral service for Tom is Thursday at 11:00 a.m. in the chapel.']
  );
});

test('p.m. keeps its lowercase continuation on the same card', () => {
  assert.deepEqual(
    segmentTranscriptText('The meeting starts at 3 p.m. in the main hall.'),
    ['The meeting starts at 3 p.m. in the main hall.']
  );
});

test('e.g. and i.e. keep their lowercase continuation on the same card', () => {
  assert.deepEqual(
    segmentTranscriptText('See the bulletin, e.g. the calendar on page two.'),
    ['See the bulletin, e.g. the calendar on page two.']
  );
  assert.deepEqual(
    segmentTranscriptText('Please review, i.e. read the whole memo, before Friday.'),
    ['Please review, i.e. read the whole memo, before Friday.']
  );
});

test('a genuinely new sentence after a.m./p.m. still splits, because it starts with a capital', () => {
  // "Bring" is a new, capitalized sentence -- the lowercase-continuation guard must not eat it.
  assert.deepEqual(
    segmentTranscriptText('The potluck starts at 6 p.m. Bring a dish to share.'),
    ['The potluck starts at 6 p.m.', 'Bring a dish to share.']
  );
});

test('no split-off fragment ever begins a card in lowercase', () => {
  // A raw, punctuation-light run where a period lands mid-clause (no known abbreviation involved)
  // must still keep the lowercase tail attached to its sentence rather than starting its own card.
  assert.deepEqual(
    segmentTranscriptText('The item was marked ready. even though the paperwork was still open.'),
    ['The item was marked ready. even though the paperwork was still open.']
  );
});

test('one AI response is one card, even the funeral line that used to orphan its location', () => {
  const items = createTranscriptItems({
    text: 'The funeral service for Tom is Thursday at 11:00 a.m. in the chapel.',
    mode: 'information',
    source: 'ai',
    createdAt: 1
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'The funeral service for Tom is Thursday at 11:00 a.m. in the chapel.');
});

test('a two-sentence AI response is one card, not two -- one model response, one card', () => {
  const items = createTranscriptItems({
    text: 'Welcome everyone. Please sit down.',
    mode: 'information',
    source: 'ai',
    createdAt: 1
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'Welcome everyone. Please sit down.');
});

test('multi-sentence RAW/manual input still splits into one card per sentence (regression)', () => {
  const items = createTranscriptItems({
    text: 'Welcome everyone. Please sit down.',
    mode: 'information',
    source: 'manual',
    createdAt: 123
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'Welcome everyone.');
  assert.equal(items[1].text, 'Please sit down.');
});

test('lowercase-continuation guard still holds for raw/manual text', () => {
  const items = createTranscriptItems({
    text: 'The item was marked ready. even though the paperwork was still open.',
    mode: 'information',
    source: 'manual',
    createdAt: 1
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'The item was marked ready. even though the paperwork was still open.');
});

test('an over-length AI response still gets width-wrapped by the runaway-length safety bound', () => {
  const runawayLine =
    'This is a runaway model response that ignored its own word limit and kept going on and on ' +
    'well past what any obedient fourteen-word line would ever produce, so it must still be ' +
    'wrapped for legibility even though it is a single sentence with no internal punctuation break.';

  const items = createTranscriptItems({
    text: runawayLine,
    mode: 'information',
    source: 'ai',
    createdAt: 1
  });

  assert.ok(items.length > 1, 'a runaway AI line must still be width-wrapped');
  assert.ok(items.every((item) => item.text.length <= 240));
});

// Issue #13: a card pushed in (or scrolled off the top) reflows every surviving card instantly --
// that reflow, not the entrance animation, is the jump. computeFlipDeltas is the pure math behind
// the fix: given where a card was before the DOM update and where it landed after, it says how
// far to park it back so the caller can animate the move instead of snapping to it. Every expected
// number here is a literal computed by hand from the input rects, never derived from re-running
// the subtraction the implementation performs.
test('computeFlipDeltas reports the distance a surviving card must be parked back to animate a push-in', () => {
  // A new card was pushed in below both of these, shoving them both up by 96px.
  const oldRects = new Map([
    ['card-a', 400],
    ['card-b', 496]
  ]);
  const newRects = new Map([
    ['card-a', 304],
    ['card-b', 400]
  ]);

  const deltas = computeFlipDeltas(oldRects, newRects);
  assert.equal(deltas.get('card-a'), 96);
  assert.equal(deltas.get('card-b'), 96);
});

test('computeFlipDeltas reports a negative distance when a card scrolled off the top pulls survivors up', () => {
  // card-old was evicted off the top; card-b and card-c each moved up by 60px to fill the gap.
  const oldRects = new Map([
    ['card-b', 200],
    ['card-c', 320]
  ]);
  const newRects = new Map([
    ['card-b', 140],
    ['card-c', 260]
  ]);

  const deltas = computeFlipDeltas(oldRects, newRects);
  assert.equal(deltas.get('card-b'), 60);
  assert.equal(deltas.get('card-c'), 60);
});

test('computeFlipDeltas omits a card that did not move, and a card present on only one side', () => {
  const oldRects = new Map([
    ['unchanged', 200],
    ['only-old', 500]
  ]);
  const newRects = new Map([
    ['unchanged', 200],
    ['only-new', 700]
  ]);

  const deltas = computeFlipDeltas(oldRects, newRects);
  assert.equal(deltas.size, 0);
});

test('computeFlipDeltas returns an empty map when given nothing to compare', () => {
  assert.equal(computeFlipDeltas(null, new Map()).size, 0);
  assert.equal(computeFlipDeltas(new Map(), null).size, 0);
});
