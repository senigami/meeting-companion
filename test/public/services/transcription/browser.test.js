import test from 'node:test';
import assert from 'node:assert/strict';

import { createBrowserTranscriptionDriver } from '../../../../public/services/transcription/browser.js';

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
    // Runs the single soonest-scheduled timer, if any. Restart scheduling is
    // strictly sequential (one pending restart at a time), so this is enough
    // to drive the driver forward one retry at a time deterministically.
    advance() {
      const pending = [...timers.entries()].sort((a, b) => a[1].delay - b[1].delay);
      if (pending.length === 0) return false;
      const [id, { fn }] = pending[0];
      timers.delete(id);
      fn();
      return true;
    },
    pendingCount() {
      return timers.size;
    }
  };
}

test('browser transcription stops after fatal recognition errors', async () => {
  const originalWindow = global.window;

  const statusMessages = [];
  let startCount = 0;
  let stopCount = 0;
  let recognitionInstance = null;

  class FakeSpeechRecognition {
    constructor() {
      recognitionInstance = this;
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
    }

    start() {
      startCount += 1;
    }

    stop() {
      stopCount += 1;
      this.onend?.();
    }
  }

  global.window = { SpeechRecognition: FakeSpeechRecognition };

  try {
    const driver = createBrowserTranscriptionDriver({
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start();
    recognitionInstance.onerror?.({ error: 'not-allowed' });
    recognitionInstance.onend?.();

    assert.equal(startCount, 1);
    assert.equal(stopCount, 0);
    assert.match(statusMessages.at(-1), /Browser transcription stopped after speech recognition error/i);
  } finally {
    global.window = originalWindow;
  }
});

test('browser transcription backs off but never gives up after repeated restart failures', async () => {
  const originalWindow = global.window;

  const statusMessages = [];
  let startCount = 0;
  let recognitionInstance = null;
  let failStart = false;
  const clock = fakeTimers();

  class FakeSpeechRecognition {
    constructor() {
      recognitionInstance = this;
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
    }

    start() {
      startCount += 1;
      if (failStart) throw new Error('restart failed');
    }

    stop() {
      this.onend?.();
    }
  }

  global.window = { SpeechRecognition: FakeSpeechRecognition };

  try {
    const driver = createBrowserTranscriptionDriver({
      onStatus: (text) => statusMessages.push(text),
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    await driver.start();
    failStart = true;

    // First restart attempt (synchronous, from onend) fails: a retry is
    // scheduled rather than the driver giving up.
    recognitionInstance.onend?.();
    assert.equal(startCount, 2);
    assert.equal(clock.pendingCount(), 1);
    assert.match(statusMessages.at(-1), /Speech recognition error: retrying microphone connection \(attempt 1\)/);
    // Never uses the old fatal-sounding wording, and stays classified
    // non-fatal by runtime.js's transcriptionStatusLevel (^Speech recognition error:).
    assert.equal(statusMessages.some((msg) => /Microphone stopped/i.test(msg)), false);

    // Drive many consecutive backoff retries — the driver must keep trying
    // indefinitely rather than surrendering after some fixed count.
    for (let i = 0; i < 8; i += 1) {
      const ran = clock.advance();
      assert.equal(ran, true, `expected a scheduled retry at iteration ${i}`);
    }
    assert.ok(startCount > 8, 'driver kept retrying well past the old two-restart give-up threshold');
    assert.equal(statusMessages.some((msg) => /Microphone stopped/i.test(msg)), false);

    // Recovery: the next retry succeeds.
    failStart = false;
    clock.advance();
    assert.match(statusMessages.at(-1), /Browser transcription is listening again\./);
  } finally {
    global.window = originalWindow;
  }
});

test('browser transcription restart backoff delay grows and is capped at 30s', async () => {
  const originalWindow = global.window;

  let recognitionInstance = null;
  let failStart = false;
  const recordedDelays = [];
  let nextId = 1;
  const pendingFns = new Map();
  const spySetTimeoutFn = (fn, delay) => {
    recordedDelays.push(delay);
    const id = nextId++;
    pendingFns.set(id, fn);
    return id;
  };
  const spyClearTimeoutFn = (id) => pendingFns.delete(id);
  const runNext = () => {
    const [id, fn] = [...pendingFns.entries()][0];
    pendingFns.delete(id);
    fn();
  };

  class FakeSpeechRecognition {
    constructor() {
      recognitionInstance = this;
    }

    start() {
      if (failStart) throw new Error('restart failed');
    }

    stop() {
      this.onend?.();
    }
  }

  global.window = { SpeechRecognition: FakeSpeechRecognition };

  try {
    const driver = createBrowserTranscriptionDriver({
      onStatus: () => {},
      setTimeoutFn: spySetTimeoutFn,
      clearTimeoutFn: spyClearTimeoutFn
    });

    await driver.start();
    failStart = true;

    recognitionInstance.onend?.();
    for (let i = 0; i < 9; i += 1) runNext();

    assert.deepEqual(recordedDelays, [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  } finally {
    global.window = originalWindow;
  }
});

test('browser transcription resets the restart-failure counter after a success', async () => {
  const originalWindow = global.window;

  const statusMessages = [];
  let recognitionInstance = null;
  let failStart = false;
  const clock = fakeTimers();

  class FakeSpeechRecognition {
    constructor() {
      recognitionInstance = this;
    }

    start() {
      if (failStart) throw new Error('restart failed');
    }

    stop() {
      this.onend?.();
    }
  }

  global.window = { SpeechRecognition: FakeSpeechRecognition };

  try {
    const driver = createBrowserTranscriptionDriver({
      onStatus: (text) => statusMessages.push(text),
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    await driver.start();
    failStart = true;

    // One failed restart schedules a retry.
    recognitionInstance.onend?.();
    assert.match(statusMessages.at(-1), /attempt 1/);

    // That retry succeeds, resetting the counter.
    failStart = false;
    clock.advance();
    assert.match(statusMessages.at(-1), /Browser transcription is listening again\./);

    // A fresh failure after the reset starts back at attempt 1, not attempt 2.
    failStart = true;
    recognitionInstance.onend?.();
    assert.match(statusMessages.at(-1), /attempt 1/);
  } finally {
    global.window = originalWindow;
  }
});

test('browser transcription stop cancels a pending restart and does not resume it', async () => {
  const originalWindow = global.window;

  let recognitionInstance = null;
  let failStart = false;
  const clock = fakeTimers();

  class FakeSpeechRecognition {
    constructor() {
      recognitionInstance = this;
    }

    start() {
      if (failStart) throw new Error('restart failed');
    }

    stop() {
      this.onend?.();
    }
  }

  global.window = { SpeechRecognition: FakeSpeechRecognition };

  try {
    const driver = createBrowserTranscriptionDriver({
      onStatus: () => {},
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn
    });

    await driver.start();
    failStart = true;
    recognitionInstance.onend?.();
    assert.equal(clock.pendingCount(), 1);

    await driver.stop();
    assert.equal(clock.pendingCount(), 0);
  } finally {
    global.window = originalWindow;
  }
});
