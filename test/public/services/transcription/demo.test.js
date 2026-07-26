import test from 'node:test';
import assert from 'node:assert/strict';

import { createDemoTranscriptionDriver, DEMO_SCRIPT } from '../../../../public/services/transcription/demo.js';

function fakeTimers() {
  let nextId = 1;
  let current = 0;
  const timers = new Map();

  return {
    setTimeoutFn(fn, delay) {
      const id = nextId++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    // Runs every currently-scheduled timer in delay order, one pass. Timers
    // scheduled by a running timer's callback are not included in this pass.
    flush() {
      const pending = [...timers.entries()].sort((a, b) => a[1].delay - b[1].delay);
      for (const [id, { fn, delay }] of pending) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        current = delay;
        fn();
      }
    },
    pendingCount() {
      return timers.size;
    },
    // The absolute virtual time (ms since start) of the timer most recently
    // fired. Every timer's `delay` here is really an absolute cursor value
    // set synchronously up front, so this doubles as "now".
    now() {
      return current;
    }
  };
}

const SHORT_SCRIPT = [
  { text: 'Good morning, everyone.' },
  { text: 'Welcome to the service today, we are glad you could join us.' }
];

test('demo transcription isAvailable is always true with no globals', () => {
  const driver = createDemoTranscriptionDriver();
  assert.equal(driver.isAvailable(), true);
});

test('demo transcription replays partials then a single final per utterance', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createDemoTranscriptionDriver({
    onEvent: (event) => events.push(event),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script: SHORT_SCRIPT
  });

  await driver.start({ currentMode: 'speaker' });
  while (clock.pendingCount() > 0) clock.flush();

  assert.ok(events.every((event) => event.source === 'demo'));

  for (const utterance of SHORT_SCRIPT) {
    const matching = events.filter((event) => event.text === utterance.text);
    const finals = matching.filter((event) => event.type === 'final');
    assert.equal(finals.length, 1, `expected exactly one final for "${utterance.text}"`);
  }

  const partialCount = events.filter((event) => event.type === 'partial').length;
  assert.ok(partialCount > 0, 'expected at least one partial event');
});

test('demo transcription never emits an empty or whitespace-only final', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createDemoTranscriptionDriver({
    onEvent: (event) => events.push(event),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script: SHORT_SCRIPT
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  const finals = events.filter((event) => event.type === 'final');
  assert.ok(finals.length > 0);
  assert.ok(finals.every((event) => event.text.trim().length > 0));
});

test('demo transcription stop clears pending timers and stops emitting', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createDemoTranscriptionDriver({
    onEvent: (event) => events.push(event),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script: SHORT_SCRIPT
  });

  await driver.start();
  await driver.stop();

  assert.equal(clock.pendingCount(), 0);
  const countAfterStop = events.length;
  clock.flush();
  assert.equal(events.length, countAfterStop);
});

test('demo transcription start while running restarts cleanly without double-emitting', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createDemoTranscriptionDriver({
    onEvent: (event) => events.push(event),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script: SHORT_SCRIPT
  });

  await driver.start();
  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  for (const utterance of SHORT_SCRIPT) {
    const finals = events.filter((event) => event.type === 'final' && event.text === utterance.text);
    assert.equal(finals.length, 1, `expected exactly one final for "${utterance.text}" after restart`);
  }
});

test('demo transcription reports a finished status after the last utterance', async () => {
  const clock = fakeTimers();
  const statusMessages = [];
  const driver = createDemoTranscriptionDriver({
    onEvent: () => {},
    onStatus: (text) => statusMessages.push(text),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script: SHORT_SCRIPT
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  assert.match(statusMessages[0], /Demo source running/);
  assert.match(statusMessages.at(-1), /Demo source finished\. Press Stop, then Start to replay\./);
});

test('demo transcription streams one partial per word, growing the sentence so far', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createDemoTranscriptionDriver({
    onEvent: (event) => events.push({ ...event, at: clock.now() }),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script: SHORT_SCRIPT
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  const allPartials = events.filter((event) => event.type === 'partial');
  const expectedWordCount = SHORT_SCRIPT[0].text.split(/\s+/).length;
  const firstSentencePartials = allPartials.slice(0, expectedWordCount);
  assert.equal(firstSentencePartials.length, expectedWordCount);
  assert.equal(firstSentencePartials.at(-1).text, SHORT_SCRIPT[0].text);
  for (let i = 1; i < firstSentencePartials.length; i += 1) {
    assert.ok(
      firstSentencePartials[i].text.split(/\s+/).length > firstSentencePartials[i - 1].text.split(/\s+/).length
    );
  }

  const totalExpectedWords = SHORT_SCRIPT.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
  assert.equal(allPartials.length, totalExpectedWords);
});

test('demo transcription paces partials at a natural speaking rate with no multi-second dead gaps mid-sentence', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createDemoTranscriptionDriver({
    onEvent: (event) => events.push({ ...event, at: clock.now() }),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script: SHORT_SCRIPT
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  const firstSentenceWordCount = SHORT_SCRIPT[0].text.split(/\s+/).length;
  const partials = events.filter((event) => event.type === 'partial').slice(0, firstSentenceWordCount);
  for (let i = 1; i < partials.length; i += 1) {
    const gap = partials[i].at - partials[i - 1].at;
    assert.ok(gap > 0 && gap < 1000, `expected a sub-second word gap, got ${gap}ms`);
  }
});

test('demo transcription pauses briefly and variably between sentences, not a fixed multi-second gap', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createDemoTranscriptionDriver({
    onEvent: (event) => events.push({ ...event, at: clock.now() }),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script: [
      { text: 'Good morning, everyone.' },
      { text: 'Welcome to the service today, we are glad you could join us.' },
      { text: 'Let us begin with a hymn.' }
    ]
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  const finals = events.filter((event) => event.type === 'final');
  const pauses = [];
  for (let i = 1; i < finals.length; i += 1) {
    pauses.push(finals[i].at - finals[i - 1].at - MS_PER_WORD_APPROX(finals[i].text));
  }
  assert.ok(pauses.every((pause) => pause > 0 && pause < 1500), `expected short pauses, got ${pauses}`);
  assert.ok(new Set(pauses).size > 1, 'expected varied (non-metronomic) pauses between sentences');
});

function MS_PER_WORD_APPROX(text) {
  const words = text.trim().split(/\s+/).length;
  return words * (60000 / 145);
}

test('DEMO_SCRIPT entries are per-sentence and no longer carry an inter-utterance delayMs', () => {
  for (const entry of DEMO_SCRIPT) {
    assert.equal(typeof entry.text, 'string');
    assert.ok(entry.text.length > 0);
    assert.equal(entry.delayMs, undefined);
  }
});
