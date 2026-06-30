import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAITranscriptionDriver } from '../../../../public/services/transcription/openai.js';

test('openai transcription cancels in-flight chunk uploads on stop', async () => {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const originalMediaRecorder = global.MediaRecorder;
  const originalBtoa = global.btoa;

  const statusMessages = [];
  let fetchStarted = false;
  let fetchAborted = false;
  let fetchSignal = null;
  let trackStopped = false;
  let recorderInstance = null;

  const stream = {
    getTracks() {
      return [{ stop: () => { trackStopped = true; } }];
    }
  };

  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => stream
      }
    },
    writable: true
  });
  global.btoa = originalBtoa || ((value) => Buffer.from(value, 'binary').toString('base64'));
  global.MediaRecorder = class {
    constructor(inputStream) {
      this.stream = inputStream;
      this.state = 'inactive';
      this.mimeType = 'audio/webm';
      recorderInstance = this;
    }

    start() {
      this.state = 'recording';
    }

    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
  };

  const driver = createOpenAITranscriptionDriver({
    chunkMs: 50,
    fetchImpl: async (url, options) => {
      fetchStarted = true;
      fetchSignal = options.signal;

      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          fetchAborted = true;
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
    onStatus: (text) => statusMessages.push(text)
  });

  try {
    await driver.start({ currentMode: 'speaker' });
    recorderInstance.ondataavailable?.({
      data: {
        size: 3,
        type: 'audio/webm',
        async arrayBuffer() {
          return Uint8Array.from([1, 2, 3]).buffer;
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await driver.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(fetchStarted, true);
    assert.equal(Boolean(fetchSignal), true);
    assert.equal(fetchAborted, true);
    assert.equal(trackStopped, true);
    assert.match(statusMessages.at(-1), /OpenAI transcription stopped\./);
    assert.equal(statusMessages.some((message) => /error/i.test(message)), false);
  } finally {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
    } else {
      delete global.navigator;
    }
    global.MediaRecorder = originalMediaRecorder;
    global.btoa = originalBtoa;
  }
});
