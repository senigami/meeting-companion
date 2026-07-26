import test from 'node:test';
import assert from 'node:assert/strict';

import { createDemoTranscriptionDriver } from '../../../../public/services/transcription/demo.js';

function fakeTimers() {
  let nextId = 1;
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
      for (const [id, { fn }] of pending) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        fn();
      }
    },
    pendingCount() {
      return timers.size;
    }
  };
}

const SHORT_SCRIPT = [
  { text: 'Good morning, everyone.', delayMs: 100 },
  { text: 'Welcome to the service today, we are glad you could join us.', delayMs: 100 }
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
