import test from 'node:test';
import assert from 'node:assert/strict';

import { createBrowserTranscriptionDriver } from '../../../../public/services/transcription/browser.js';

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

test('browser transcription surfaces a status after repeated restart failures and stops retrying', async () => {
  const originalWindow = global.window;

  const statusMessages = [];
  let startCount = 0;
  let recognitionInstance = null;
  let failStart = false;

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
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start();
    failStart = true;

    // First restart failure: still retries.
    recognitionInstance.onend?.();
    assert.equal(startCount, 2);
    assert.equal(statusMessages.some((msg) => /Microphone stopped/i.test(msg)), false);

    // Second consecutive restart failure: surfaces status and stops retrying.
    recognitionInstance.onend?.();
    assert.equal(startCount, 3);
    assert.equal(statusMessages.at(-1), 'Microphone stopped. Click Start to try again.');

    // Further onend calls do not retry anymore.
    recognitionInstance.onend?.();
    assert.equal(startCount, 3);
  } finally {
    global.window = originalWindow;
  }
});

test('browser transcription resets the restart-failure counter after a success', async () => {
  const originalWindow = global.window;

  const statusMessages = [];
  let startCount = 0;
  let recognitionInstance = null;
  let failStart = false;

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
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start();
    failStart = true;

    // One failed restart, then a successful one, resets the counter.
    recognitionInstance.onend?.();
    failStart = false;
    recognitionInstance.onend?.();
    failStart = true;

    // Two more consecutive failures are needed again before the status fires.
    recognitionInstance.onend?.();
    assert.equal(statusMessages.some((msg) => /Microphone stopped/i.test(msg)), false);
    recognitionInstance.onend?.();
    assert.equal(statusMessages.at(-1), 'Microphone stopped. Click Start to try again.');
  } finally {
    global.window = originalWindow;
  }
});
