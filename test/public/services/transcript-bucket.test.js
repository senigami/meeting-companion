import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketText,
  partitionBucket,
  removeConsumed,
  splitAtLastTerminator,
  takeOldestModeRun,
  trimBucket
} from '../../../public/services/transcript-bucket.js';

const NOW = 1_000_000;

test('splitAtLastTerminator keeps the dangling tail', () => {
  assert.deepEqual(
    splitAtLastTerminator('We sang hymn 152. And then the bishop'),
    { complete: 'We sang hymn 152.', tail: 'And then the bishop' }
  );
  assert.deepEqual(splitAtLastTerminator('no punctuation here'), { complete: '', tail: 'no punctuation here' });
  assert.deepEqual(splitAtLastTerminator(''), { complete: '', tail: '' });
});

test('older finals are consumable even without punctuation', () => {
  const chunks = [
    { text: 'welcome everyone to the meeting', at: NOW - 5000 },
    { text: 'we will start with a hymn', at: NOW - 1000 }
  ];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW });
  assert.equal(consumable.length, 1);
  assert.equal(consumable[0].text, 'welcome everyone to the meeting');
  assert.equal(remainder.length, 1);
  assert.equal(remainder[0].text, 'we will start with a hymn');
});

test('the newest punctuated final is fully consumable', () => {
  const chunks = [{ text: 'The closing hymn is number 152.', at: NOW - 1000 }];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW });
  assert.equal(consumable.length, 1);
  assert.equal(remainder.length, 0);
});

test('a fresh unpunctuated newest final stays in the bucket', () => {
  const chunks = [{ text: 'and then we will hear from', at: NOW - 1000 }];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW });
  assert.equal(consumable.length, 0);
  assert.equal(remainder.length, 1);
});

test('a settled unpunctuated final eventually drains', () => {
  const chunks = [{ text: 'and then we will hear from the choir', at: NOW - 25000 }];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW, settleMs: 20000 });
  assert.equal(consumable.length, 1);
  assert.equal(remainder.length, 0);
});

test('only the complete leading sentences of the newest chunk are consumable', () => {
  const chunks = [{ text: 'We sang hymn 152. And then the bishop', at: NOW - 1000 }];
  const { consumable, remainder } = partitionBucket(chunks, { now: NOW });
  assert.equal(consumable[0].text, 'We sang hymn 152.');
  assert.equal(remainder[0].text, 'And then the bishop');
});

test('removeConsumed drops fully consumed chunks and keeps split tails', () => {
  const chunks = [
    { text: 'welcome everyone', at: NOW - 5000 },
    { text: 'We sang hymn 152. And then the bishop', at: NOW - 1000 }
  ];
  const consumed = [
    { text: 'welcome everyone', at: NOW - 5000 },
    { text: 'We sang hymn 152.', at: NOW - 1000 }
  ];
  const remaining = removeConsumed(chunks, consumed);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].text, 'And then the bishop');
});

test('removeConsumed leaves chunks that arrived after partition untouched', () => {
  const chunks = [
    { text: 'old line', at: NOW - 5000 },
    { text: 'brand new line', at: NOW }
  ];
  const remaining = removeConsumed(chunks, [{ text: 'old line', at: NOW - 5000 }]);
  assert.deepEqual(remaining.map((chunk) => chunk.text), ['brand new line']);
});

test('bucketText joins chunks with the interim preview and caps length from the end', () => {
  const chunks = [{ text: 'first part', at: NOW }];
  assert.equal(bucketText(chunks, 'still speaking'), 'first part still speaking');
  const long = bucketText([{ text: 'x'.repeat(50), at: NOW }], '', { maxChars: 10 });
  assert.equal(long.length, 10);
});

test('trimBucket drops the oldest whole chunks beyond the cap but never the newest', () => {
  const chunks = [
    { text: 'a'.repeat(30), at: 1 },
    { text: 'b'.repeat(30), at: 2 },
    { text: 'c'.repeat(30), at: 3 }
  ];
  const trimmed = trimBucket(chunks, { maxChars: 65 });
  assert.deepEqual(trimmed.map((chunk) => chunk.text[0]), ['b', 'c']);
  const single = trimBucket([{ text: 'z'.repeat(500), at: 1 }], { maxChars: 100 });
  assert.equal(single.length, 1);
});

test('takeOldestModeRun sends and would-consume the exact same set on a backlog well over 1000 characters', () => {
  // Three chunks, each 400 chars, well past the old 1000-char send cap -- this is the scenario the
  // head-slicing bug destroyed: a large backlog handed to a slicer that keeps only the tail.
  const chunks = [
    { at: NOW, text: 'A'.repeat(400), mode: 'speaker' },
    { at: NOW + 1, text: 'B'.repeat(400), mode: 'speaker' },
    { at: NOW + 2, text: 'C'.repeat(400), mode: 'speaker' }
  ];

  const run = takeOldestModeRun(chunks, { defaultMode: 'speaker' });

  // Sent-set equals consumed-set, asserted on the actual strings -- not lengths or counts.
  assert.deepEqual(run.chunks, chunks);
  assert.equal(run.text, `${'A'.repeat(400)} ${'B'.repeat(400)} ${'C'.repeat(400)}`);
  assert.equal(run.text.length, 1202);
  assert.equal(run.mode, 'speaker');
});

test('takeOldestModeRun stops at the first mode change, leaving the later mode for its own call', () => {
  const chunks = [
    { at: NOW, text: 'welcome everyone', mode: 'speaker' },
    { at: NOW + 1, text: 'we will now sing', mode: 'speaker' },
    { at: NOW + 2, text: 'a brief announcement', mode: 'information' }
  ];

  const run = takeOldestModeRun(chunks, { defaultMode: 'speaker' });

  assert.deepEqual(run.chunks.map((chunk) => chunk.text), ['welcome everyone', 'we will now sing']);
  assert.equal(run.mode, 'speaker');
  assert.equal(run.text, 'welcome everyone we will now sing');
});

test('takeOldestModeRun starts a run from the current mode when the leading chunk was never tagged', () => {
  const chunks = [{ at: NOW, text: 'untagged legacy chunk' }];
  const run = takeOldestModeRun(chunks, { defaultMode: 'information' });
  assert.equal(run.mode, 'information');
  assert.deepEqual(run.chunks, chunks);
});

test('takeOldestModeRun throws rather than silently sending a slice of a run larger than the cap', () => {
  const chunks = [
    { at: NOW, text: 'X'.repeat(2000), mode: 'speaker' }
  ];
  assert.throws(() => takeOldestModeRun(chunks, { defaultMode: 'speaker', maxChars: 1600 }));
});

// Issue #40: the run reports the speaker its own leading chunk was captured under, the same
// precedent already established for mode -- a card must read under the speaker who actually said
// it, not whoever the operator has since typed into the name field.
test('takeOldestModeRun carries the run\'s own leading speaker, not the current one', () => {
  const chunks = [
    { at: NOW, text: 'first sentence', mode: 'speaker', speaker: 'Alpha' },
    { at: NOW + 1, text: 'second sentence', mode: 'speaker', speaker: 'Alpha' }
  ];

  // defaultSpeaker stands in for "whoever is typed in right now" -- deliberately different from
  // the chunks' own recorded speaker, to prove the run reports the CHUNK's speaker, not the default.
  const run = takeOldestModeRun(chunks, { defaultMode: 'speaker', defaultSpeaker: 'Someone Else Entirely' });
  assert.equal(run.speaker, 'Alpha');
});

test('takeOldestModeRun falls back to defaultSpeaker for a chunk that was never speaker-tagged', () => {
  const chunks = [{ at: NOW, text: 'untagged legacy chunk', mode: 'speaker' }];
  const run = takeOldestModeRun(chunks, { defaultMode: 'speaker', defaultSpeaker: 'Fallback Name' });
  assert.equal(run.speaker, 'Fallback Name');
});

test('takeOldestModeRun returns nothing for an empty or all-blank bucket', () => {
  assert.deepEqual(
    takeOldestModeRun([], { defaultMode: 'speaker' }),
    { chunks: [], mode: 'speaker', speaker: null, text: '' }
  );
});

// Issue #51. Reproduced from the real shape before the fix: one run spanning two speakers was
// labelled with the leading speaker, so a card asserted Brother Ashcroft said "I lost my job last
// year" when Sister Ellsworth said it. A reader who cannot hear the room cannot detect that, which
// makes a wrong label worse than no label.
test('a run breaks on a speaker change, so a card never carries one person name over another person words', () => {
  const chunks = [
    { text: 'I know the Church is true.', at: 1, mode: 'speaker', speaker: 'Brother Ashcroft' },
    { text: 'Thank you Brother Ashcroft. I lost my job last year.', at: 2, mode: 'speaker', speaker: 'Sister Ellsworth' }
  ];

  const first = takeOldestModeRun(chunks, { defaultMode: 'speaker', defaultSpeaker: '' });
  assert.equal(first.speaker, 'Brother Ashcroft');
  assert.equal(first.text, 'I know the Church is true.');
  assert.ok(!first.text.includes('lost my job'), 'the second speaker words must not be in the first card');

  const second = takeOldestModeRun(chunks.slice(first.chunks.length), { defaultMode: 'speaker', defaultSpeaker: '' });
  assert.equal(second.speaker, 'Sister Ellsworth');
  assert.match(second.text, /lost my job/);
});

test('a chunk carrying no speaker inherits the run rather than breaking it or starting a false one', () => {
  // Untagged chunks are real: anything buffered before #40 shipped, or a null round-tripped through
  // a replayed recording. Treating absent as a change would split a single person mid-sentence and
  // attach whatever the operator has typed right now to the remainder.
  const chunks = [
    { text: 'First part of one thought.', at: 1, mode: 'speaker', speaker: 'Brother Ashcroft' },
    { text: 'Second part of the same thought.', at: 2, mode: 'speaker' },
    { text: 'Now somebody else.', at: 3, mode: 'speaker', speaker: 'Sister Ellsworth' }
  ];

  const run = takeOldestModeRun(chunks, { defaultMode: 'speaker', defaultSpeaker: 'Someone Typed Later' });
  assert.equal(run.chunks.length, 2, 'the untagged chunk stays with the speaker it followed');
  assert.equal(run.speaker, 'Brother Ashcroft');
  assert.ok(!run.text.includes('somebody else'), 'and the real speaker change still ends the run');
});

test('mode still breaks a run even when the speaker has not changed', () => {
  // The speaker boundary is additional, not a replacement.
  const chunks = [
    { text: 'Talking about the meeting.', at: 1, mode: 'speaker', speaker: 'Brother Ashcroft' },
    { text: 'Closing hymn is 301.', at: 2, mode: 'information', speaker: 'Brother Ashcroft' }
  ];
  const run = takeOldestModeRun(chunks, { defaultMode: 'speaker', defaultSpeaker: '' });
  assert.equal(run.chunks.length, 1);
  assert.equal(run.mode, 'speaker');
});
