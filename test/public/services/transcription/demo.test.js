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

const VALID_MODES = ['speaker', 'information', 'song', 'prayer'];

// The full matrix from .agent/demo-scenario-matrix-brief.md. Asserted against a literal list so
// deleting a scenario fails a test rather than passing quietly.
const REQUIRED_PROVES_TAGS = [
  'speaker-narrative',
  'speaker-pronoun-heavy',
  'speaker-embedded-number',
  'speaker-invitation',
  'info-date-time-place',
  'info-assignments',
  'info-hymn-number',
  'info-scripture-reference',
  'info-multi-fact',
  'info-courtesy-padding',
  'song-status-with-number',
  'song-lyrics-must-not-appear',
  'song-commentary-must-not-appear',
  'prayer-multiple-requests',
  'prayer-long-rambling',
  'prayer-short',
  'edge-unpunctuated-tail',
  'edge-disfluency',
  'edge-duplicate-line',
  'edge-run-on',
  'edge-silence-gap',
  'edge-minimal-utterance'
];

function findByProves(tag) {
  return DEMO_SCRIPT.find((entry) => entry.proves === tag);
}

test('every entry has a valid mode', () => {
  for (const entry of DEMO_SCRIPT) {
    assert.ok(VALID_MODES.includes(entry.mode), `unexpected mode "${entry.mode}" on "${entry.text}"`);
  }
});

test('every proves tag in the scenario matrix brief exists in the script', () => {
  const presentTags = new Set(DEMO_SCRIPT.map((entry) => entry.proves).filter(Boolean));
  for (const tag of REQUIRED_PROVES_TAGS) {
    assert.ok(presentTags.has(tag), `missing scenario coverage for "${tag}"`);
  }
});

test('info-* rows really contain digits, not just a claim of them', () => {
  const infoTags = REQUIRED_PROVES_TAGS.filter((tag) => tag.startsWith('info-'));
  for (const tag of infoTags) {
    const entry = findByProves(tag);
    assert.ok(entry, `missing entry for "${tag}"`);
    assert.equal(entry.mode, 'information');
    assert.match(entry.text, /\d/, `"${tag}" entry has no digits: "${entry.text}"`);
  }
});

test('edge-unpunctuated-tail really lacks terminal punctuation', () => {
  const entry = findByProves('edge-unpunctuated-tail');
  assert.ok(entry);
  assert.ok(!/[.!?]$/.test(entry.text.trim()), `expected no terminal punctuation, got "${entry.text}"`);
});

test('edge-run-on really exceeds 240 characters', () => {
  const entry = findByProves('edge-run-on');
  assert.ok(entry);
  assert.ok(entry.text.length > 240, `expected over 240 chars, got ${entry.text.length}`);
});

test('edge-duplicate-line is really duplicated as two consecutive identical entries', () => {
  const index = DEMO_SCRIPT.findIndex((entry) => entry.proves === 'edge-duplicate-line');
  assert.ok(index >= 0 && index + 1 < DEMO_SCRIPT.length);
  assert.equal(DEMO_SCRIPT[index].text, DEMO_SCRIPT[index + 1].text);
});

test('edge-silence-gap carries a pauseBeforeMs long enough to trip a silence watchdog', () => {
  const entry = findByProves('edge-silence-gap');
  assert.ok(entry);
  assert.ok(entry.pauseBeforeMs > 15000, `expected a long pause, got ${entry.pauseBeforeMs}`);
});

test('edge-minimal-utterance is a near-empty line', () => {
  const entry = findByProves('edge-minimal-utterance');
  assert.ok(entry);
  assert.ok(entry.text.trim().split(/\s+/).length <= 2, `expected a minimal utterance, got "${entry.text}"`);
});

test('song-lyrics-must-not-appear does not contain real hymn/song lyrics (only invented lyric-shaped text)', () => {
  const entry = findByProves('song-lyrics-must-not-appear');
  assert.ok(entry);
  assert.equal(entry.mode, 'song');
  // Guard against reintroducing a recognisable line from a well-known hymn.
  const bannedPhrases = ['amazing grace', 'how sweet the sound', 'holy holy holy', 'be thou my vision'];
  const lower = entry.text.toLowerCase();
  for (const phrase of bannedPhrases) {
    assert.ok(!lower.includes(phrase), `entry appears to contain a real lyric fragment: "${phrase}"`);
  }
});

test('the demo driver applies each entry\'s mode via the injected onModeChange callback before its text is emitted', async () => {
  const clock = fakeTimers();
  const calls = [];
  const script = [
    { text: 'Good morning, everyone.', mode: 'speaker' },
    { text: 'Hymn 42, ready to sing.', mode: 'song' },
    { text: 'Heavenly Father, thank you. Amen.', mode: 'prayer' }
  ];

  const driver = createDemoTranscriptionDriver({
    onEvent: (event) => calls.push({ kind: 'event', ...event }),
    onStatus: () => {},
    onModeChange: (mode) => calls.push({ kind: 'mode', mode }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  const modeCalls = calls.filter((call) => call.kind === 'mode');
  assert.deepEqual(modeCalls.map((call) => call.mode), ['speaker', 'song', 'prayer']);

  // Each mode call happens strictly before the final text for its own entry.
  for (let i = 0; i < script.length; i += 1) {
    const modeIndex = calls.findIndex((call) => call.kind === 'mode' && call.mode === script[i].mode);
    const finalIndex = calls.findIndex((call) => call.kind === 'event' && call.type === 'final' && call.text === script[i].text);
    assert.ok(modeIndex < finalIndex, `expected mode change before final text for "${script[i].text}"`);
  }
});

test('pauseBeforeMs adds an extra deterministic gap without disturbing the default cadence', async () => {
  const clock = fakeTimers();
  const events = [];
  const script = [
    { text: 'Good morning.', mode: 'speaker' },
    { text: 'Let us pause.', mode: 'speaker', pauseBeforeMs: 10000 }
  ];

  const driver = createDemoTranscriptionDriver({
    onEvent: (event) => events.push({ ...event, at: clock.now() }),
    onStatus: () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    script
  });

  await driver.start();
  while (clock.pendingCount() > 0) clock.flush();

  const finals = events.filter((event) => event.type === 'final');
  const gap = finals[1].at - finals[0].at;
  assert.ok(gap > 10000, `expected the extra pause to be reflected in the gap, got ${gap}`);
});

test('two runs of the same script with the same injected clock produce identical timings (deterministic cadence)', async () => {
  function run() {
    const clock = fakeTimers();
    const events = [];
    const driver = createDemoTranscriptionDriver({
      onEvent: (event) => events.push({ type: event.type, text: event.text, at: clock.now() }),
      onStatus: () => {},
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      script: DEMO_SCRIPT
    });
    return driver.start().then(() => {
      while (clock.pendingCount() > 0) clock.flush();
      return events;
    });
  }

  const first = await run();
  const second = await run();
  assert.deepEqual(first, second);
});
