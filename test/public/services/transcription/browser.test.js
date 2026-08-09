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

// #37. Chrome handed the page a microphone Steve had not chosen, that device measured -Infinity
// dBFS, and recognition timed out with no-speech, restarted and repeated for hours while the rail
// said "Listening". The picker cannot reach the Web Speech API, so the only honest signal left is
// the driver noticing it has never heard anything at all.
function silentDeviceHarness() {
  const statuses = [];
  let recognitionInstance = null;
  let clock = 0;

  class FakeSpeechRecognition {
    constructor() {
      recognitionInstance = this;
    }

    start() {}
    stop() { this.onend?.(); }
  }

  const originalWindow = global.window;
  global.window = { SpeechRecognition: FakeSpeechRecognition };

  const driver = createBrowserTranscriptionDriver({
    onStatus: (text, options) => statuses.push({ text, level: options?.level }),
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
    nowFn: () => clock
  });

  return {
    driver,
    statuses,
    get recognition() { return recognitionInstance; },
    // #94: the silent-device claim carries a 45s floor matching runtime.js's SILENCE_WATCHDOG_MS,
    // so a test exercising the real trigger has to cross it explicitly rather than getting it for
    // free from two synchronous calls.
    passSilenceFloor() { clock += 45000; },
    restore() { global.window = originalWindow; }
  };
}

// #94: two no-speech timeouts land back to back at roughly 10-16s, well inside the ordinary quiet
// seconds before a meeting starts. Without a floor matching runtime.js's 45s SILENCE_WATCHDOG_MS,
// the rail would accuse the browser of ignoring the picker over a pause that is not a dead device.
test('#94: two fast no-speech timeouts do not trigger the claim before the 45s floor', async () => {
  const harness = silentDeviceHarness();
  try {
    await harness.driver.start();
    harness.recognition.onerror({ error: 'no-speech' });
    harness.recognition.onerror({ error: 'no-speech' });

    assert.equal(harness.statuses.filter((entry) => entry.level === 'silence').length, 0,
      'the streak alone must not be enough before the watchdog\'s own deliberated wait');
  } finally {
    harness.restore();
  }
});

test('#37: a microphone that never delivers audio stops being reported as listening', async () => {
  const harness = silentDeviceHarness();
  try {
    await harness.driver.start();

    harness.recognition.onerror({ error: 'no-speech' });
    assert.equal(harness.statuses.filter((entry) => entry.level === 'silence').length, 0,
      'one timeout is a quiet room before anyone speaks, not a dead device');

    harness.passSilenceFloor();
    harness.recognition.onerror({ error: 'no-speech' });
    const claim = harness.statuses.at(-1);
    assert.equal(claim.level, 'silence', 'the rail must stop claiming Listening');
    assert.match(claim.text, /picker/i, 'and must point at the thing that actually causes it');
  } finally {
    harness.restore();
  }
});

test('#37: a quiet stretch after real audio is not a dead device', async () => {
  const harness = silentDeviceHarness();
  try {
    await harness.driver.start();
    harness.recognition.onsoundstart();

    harness.recognition.onerror({ error: 'no-speech' });
    harness.recognition.onerror({ error: 'no-speech' });
    harness.recognition.onerror({ error: 'no-speech' });

    assert.equal(harness.statuses.filter((entry) => entry.level === 'silence').length, 0,
      'a device that has been heard from is a silent room, and a silent room is normal here');
  } finally {
    harness.restore();
  }
});

test('#37: the claim is withdrawn as soon as audio actually arrives', async () => {
  const harness = silentDeviceHarness();
  try {
    await harness.driver.start();
    harness.recognition.onerror({ error: 'no-speech' });
    harness.passSilenceFloor();
    harness.recognition.onerror({ error: 'no-speech' });
    assert.equal(harness.statuses.at(-1).level, 'silence');

    harness.recognition.onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'Brother Reed will speak.' }], { isFinal: true })]
    });

    // The recovery must NOT assert a level. A non-persistent level clears the rail's persistent
    // note whatever caused it, so a driver claiming 'listening' here wipes a live 'problem' raised
    // somewhere else, and the driver has no way to know whether one is showing.
    assert.equal(harness.statuses.at(-1).level, undefined);
    assert.match(harness.statuses.at(-1).text, /hearing audio/i);
  } finally {
    harness.restore();
  }
});

test('#37: restarting asks the device question again rather than trusting the last session', async () => {
  const harness = silentDeviceHarness();
  try {
    await harness.driver.start();
    harness.recognition.onsoundstart();
    await harness.driver.stop();

    // A different device may be behind the next session, so what the last one heard proves nothing.
    await harness.driver.start();
    harness.recognition.onerror({ error: 'no-speech' });
    harness.passSilenceFloor();
    harness.recognition.onerror({ error: 'no-speech' });

    assert.equal(harness.statuses.at(-1).level, 'silence');
  } finally {
    harness.restore();
  }
});
