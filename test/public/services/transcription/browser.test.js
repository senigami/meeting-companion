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
