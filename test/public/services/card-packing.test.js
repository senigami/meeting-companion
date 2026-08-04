import test from 'node:test';
import assert from 'node:assert/strict';

import { packLinesIntoCards } from '../../../public/services/card-packing.js';

const words = (text) => text.split(/\s+/).filter(Boolean).length;

// The real model reply, captured 2026-08-02 from recordings/2026-08-02T14-49-33-546Z.ndjson's
// testimony run back through gpt-4o-mini. Eight lines, none longer than 11 words -- which is the
// whole reason this module exists: without packing the display gets eight thin cards.
const TESTIMONY_LINES = [
  "I'd like to bear my testimony.",
  'I know the Church is true.',
  'Joseph Smith is a prophet.',
  'I enjoy going to the temple.',
  'I love the feeling I get there.',
  "I'm grateful to be at church today.",
  'I appreciate everyone who supports me.',
  'I say these things in the name of Jesus Christ, amen.'
];

test('packs short model lines up to the word budget instead of one card each', () => {
  const cards = packLinesIntoCards(TESTIMONY_LINES, { cardWords: 15 });
  assert.ok(cards.length < TESTIMONY_LINES.length, 'packing must produce fewer cards than lines');
  for (const card of cards) {
    assert.ok(words(card) <= 15, `card over budget (${words(card)}w): ${card}`);
  }
});

test('a bigger budget produces fewer, fuller cards', () => {
  const narrow = packLinesIntoCards(TESTIMONY_LINES, { cardWords: 12 });
  const wide = packLinesIntoCards(TESTIMONY_LINES, { cardWords: 20 });
  assert.ok(wide.length < narrow.length, `expected fewer cards at 20w (${wide.length}) than 12w (${narrow.length})`);
});

test('every word survives packing, in the order it was said', () => {
  // The failure this guards is the quiet one: a packer that drops the tail looks fine on screen.
  for (const budget of [8, 12, 15, 17, 20, 40]) {
    const cards = packLinesIntoCards(TESTIMONY_LINES, { cardWords: budget });
    assert.equal(cards.join(' '), TESTIMONY_LINES.join(' '), `content changed at budget ${budget}`);
  }
});

test('a single thought longer than the budget gets its own card rather than being cut', () => {
  const long = 'I want to thank every single person who came and helped us move house last Saturday morning.';
  const cards = packLinesIntoCards(['Short one.', long, 'Another short one.'], { cardWords: 6 });
  assert.ok(cards.includes(long), 'the over-budget thought must survive whole');
  assert.equal(cards.join(' '), `Short one. ${long} Another short one.`);
});

test('blank and whitespace-only lines are dropped without leaving an empty card', () => {
  const cards = packLinesIntoCards(['', '   ', 'Real line.', '', '\t'], { cardWords: 15 });
  assert.deepEqual(cards, ['Real line.']);
});

test('no lines at all produces no cards, not one empty string', () => {
  assert.deepEqual(packLinesIntoCards([], { cardWords: 15 }), []);
  assert.deepEqual(packLinesIntoCards(['', '  '], { cardWords: 15 }), []);
});

test('an invalid budget falls back to the default rather than producing one card per word', () => {
  for (const bad of [0, -5, NaN, undefined, 'lots']) {
    const cards = packLinesIntoCards(TESTIMONY_LINES, { cardWords: bad });
    assert.ok(cards.length > 0 && cards.length < TESTIMONY_LINES.length,
      `budget ${String(bad)} produced ${cards.length} cards`);
  }
});
