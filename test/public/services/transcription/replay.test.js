import test from 'node:test';
import assert from 'node:assert/strict';

import { createReplayTranscriptionDriver, normalizeReplaySpeed } from '../../../../public/services/transcription/replay.js';

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
    now() {
      return current;
    }
  };
}

function ndjson(records) {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

const BASE_RECORDS = [
  { t: 'chunk', at: '2026-07-30T10:00:00.000Z', id: '1', mode: 'speaker', text: 'Good morning, everyone.' },
  { t: 'summary', at: '2026-07-30T10:00:01.000Z', mode: 'speaker', consumedIds: ['1'] },
  { t: 'chunk', at: '2026-07-30T10:00:04.000Z', id: '2', mode: 'speaker', text: 'A few notices before we begin.' },
  { t: 'chunk', at: '2026-07-30T10:00:10.000Z', id: '3', mode: 'information', text: 'The service starts at nine.' }
];

function fetchReturning(body, { ok = true } = {}) {
  return async () => ({
    ok,
    status: ok ? 200 : 500,
    text: async () => body
  });
}

test('replay isAvailable reflects whether a recording has been selected', () => {
  assert.equal(createReplayTranscriptionDriver().isAvailable(), false);
  assert.equal(createReplayTranscriptionDriver({ recordingId: 'rec-1' }).isAvailable(), true);
});

test('replay follows each chunk\'s recorded delta from the first chunk at 1x speed', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createReplayTranscriptionDriver({
    onEvent: (event) => events.push({ ...event, at: clock.now() }),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(ndjson(BASE_RECORDS)),
    recordingId: 'rec-1',
    speed: '1'
  });

  await driver.start({ currentMode: 'speaker' });
  while (clock.pendingCount() > 0) clock.flush();

  const finals = events.filter((event) => event.type === 'final');
  assert.equal(finals.length, 3);
  assert.equal(finals[0].at, 0);
  assert.equal(finals[1].at, 4000);
  assert.equal(finals[2].at, 10000);
});

test('speed multiplier scales the recorded deltas', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createReplayTranscriptionDriver({
    onEvent: (event) => events.push({ ...event, at: clock.now() }),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(ndjson(BASE_RECORDS)),
    recordingId: 'rec-1',
    speed: '4'
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  const finals = events.filter((event) => event.type === 'final');
  assert.equal(finals[0].at, 0);
  assert.equal(finals[1].at, 1000);
  assert.equal(finals[2].at, 2500);
});

test('max speed emits every chunk in order with no delay between them', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createReplayTranscriptionDriver({
    onEvent: (event) => events.push(event),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(ndjson(BASE_RECORDS)),
    recordingId: 'rec-1',
    speed: 'max'
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  const finals = events.filter((event) => event.type === 'final');
  assert.deepEqual(finals.map((event) => event.text), [
    'Good morning, everyone.',
    'A few notices before we begin.',
    'The service starts at nine.'
  ]);
});

test('malformed lines are skipped without aborting the replay', async () => {
  const clock = fakeTimers();
  const events = [];
  const raw = [
    JSON.stringify(BASE_RECORDS[0]),
    '{ this is not valid json',
    JSON.stringify(BASE_RECORDS[2])
  ].join('\n');

  const driver = createReplayTranscriptionDriver({
    onEvent: (event) => events.push(event),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(raw),
    recordingId: 'rec-1'
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  const finals = events.filter((event) => event.type === 'final');
  assert.equal(finals.length, 2);
  assert.deepEqual(finals.map((event) => event.text), [
    'Good morning, everyone.',
    'A few notices before we begin.'
  ]);
});

test('summary records are ignored entirely', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createReplayTranscriptionDriver({
    onEvent: (event) => events.push(event),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(ndjson(BASE_RECORDS)),
    recordingId: 'rec-1'
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  assert.ok(events.every((event) => event.type === 'final'), 'no partials should ever be synthesized');
  assert.equal(events.length, 3);
});

test('onModeChange fires before the chunk that changed mode, and only when the mode actually changes', async () => {
  const clock = fakeTimers();
  const calls = [];
  const driver = createReplayTranscriptionDriver({
    onEvent: (event) => calls.push({ kind: 'event', ...event }),
    onStatus: () => {},
    onModeChange: (mode) => calls.push({ kind: 'mode', mode }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(ndjson(BASE_RECORDS)),
    recordingId: 'rec-1'
  });

  await driver.start({ currentMode: 'speaker' });
  while (clock.pendingCount() > 0) clock.flush();

  const modeCalls = calls.filter((call) => call.kind === 'mode');
  assert.deepEqual(modeCalls.map((call) => call.mode), ['information']);

  const modeIndex = calls.findIndex((call) => call.kind === 'mode');
  const finalIndex = calls.findIndex((call) => call.kind === 'event' && call.text === 'The service starts at nine.');
  assert.ok(modeIndex < finalIndex, 'expected the mode change before the final text it applies to');
});

// Issue #40: a replay must reproduce the same speaker labels the operator actually saw, so a
// recorded speaker change is re-applied the same way a recorded mode change already is above.
test('onSpeakerChange fires before the chunk that changed speaker, including a change back to no name', async () => {
  const clock = fakeTimers();
  const calls = [];
  const records = [
    { t: 'chunk', at: '2026-07-30T10:00:00.000Z', id: '1', mode: 'speaker', speaker: 'Alpha', text: 'Alpha speaks first.' },
    { t: 'chunk', at: '2026-07-30T10:00:04.000Z', id: '2', mode: 'speaker', speaker: 'Alpha', text: 'Alpha again.' },
    { t: 'chunk', at: '2026-07-30T10:00:10.000Z', id: '3', mode: 'speaker', speaker: '', text: 'No name typed for this one.' }
  ];
  const driver = createReplayTranscriptionDriver({
    onEvent: (event) => calls.push({ kind: 'event', ...event }),
    onStatus: () => {},
    onSpeakerChange: (speaker) => calls.push({ kind: 'speaker', speaker }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(ndjson(records)),
    recordingId: 'rec-1'
  });

  await driver.start({ currentMode: 'speaker' });
  while (clock.pendingCount() > 0) clock.flush();

  const speakerCalls = calls.filter((call) => call.kind === 'speaker');
  // Only two changes: 'Alpha' once (not re-announced on the repeat), then '' when the recording
  // says the operator had cleared the field.
  assert.deepEqual(speakerCalls.map((call) => call.speaker), ['Alpha', '']);

  const secondSpeakerIndex = calls.findIndex((call) => call.kind === 'speaker' && call.speaker === '');
  const thirdEventIndex = calls.findIndex((call) => call.kind === 'event' && call.text === 'No name typed for this one.');
  assert.ok(secondSpeakerIndex < thirdEventIndex, 'the clear must apply before the card it belongs to');
});

test('stop clears pending timers and nothing further emits', async () => {
  const clock = fakeTimers();
  const events = [];
  const driver = createReplayTranscriptionDriver({
    onEvent: (event) => events.push(event),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(ndjson(BASE_RECORDS)),
    recordingId: 'rec-1'
  });

  await driver.start();
  await driver.stop();

  assert.equal(clock.pendingCount(), 0);
  const countAfterStop = events.length;
  clock.flush();
  assert.equal(events.length, countAfterStop);
});

test('fetch failure surfaces through onStatus at problem level and leaves the driver stopped', async () => {
  const clock = fakeTimers();
  const statuses = [];
  const driver = createReplayTranscriptionDriver({
    onEvent: () => {},
    onStatus: (text, options) => statuses.push({ text, level: options?.level }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: async () => { throw new Error('network down'); },
    recordingId: 'rec-1'
  });

  await driver.start();

  assert.equal(clock.pendingCount(), 0);
  const problemStatus = statuses.find((status) => status.level === 'problem');
  assert.ok(problemStatus, 'expected a problem-level status after a fetch failure');
});

test('an empty recording surfaces through onStatus at problem level', async () => {
  const clock = fakeTimers();
  const statuses = [];
  const driver = createReplayTranscriptionDriver({
    onEvent: () => {},
    onStatus: (text, options) => statuses.push({ text, level: options?.level }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(''),
    recordingId: 'rec-1'
  });

  await driver.start();

  const problemStatus = statuses.find((status) => status.level === 'problem');
  assert.ok(problemStatus, 'expected a problem-level status for an empty recording');
});

test('start declares the manual level explicitly rather than relying on prose classification', async () => {
  const clock = fakeTimers();
  const statuses = [];
  const driver = createReplayTranscriptionDriver({
    onEvent: () => {},
    onStatus: (text, options) => statuses.push({ text, level: options?.level }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: fetchReturning(ndjson(BASE_RECORDS)),
    recordingId: 'rec-1'
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  assert.equal(statuses[0].level, 'manual');
  assert.match(statuses[0].text, /not live/i);
  assert.equal(statuses.at(-1).level, 'manual');
  assert.match(statuses.at(-1).text, /finished/i);
});

test('normalizeReplaySpeed falls back to 1 for anything not 1, 4, or max', () => {
  assert.equal(normalizeReplaySpeed(undefined), '1');
  assert.equal(normalizeReplaySpeed('4'), '4');
  assert.equal(normalizeReplaySpeed('max'), 'max');
  assert.equal(normalizeReplaySpeed('bogus'), '1');
});
