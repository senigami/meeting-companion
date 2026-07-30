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

function withFakeNavigatorAndRecorder(run) {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const originalMediaRecorder = global.MediaRecorder;
  const originalBtoa = global.btoa;

  const stream = { getTracks: () => [{ stop() {} }] };
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
    writable: true
  });
  global.btoa = originalBtoa || ((value) => Buffer.from(value, 'binary').toString('base64'));

  let recorderInstance = null;
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

  return run(() => recorderInstance).finally(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
    } else {
      delete global.navigator;
    }
    global.MediaRecorder = originalMediaRecorder;
    global.btoa = originalBtoa;
  });
}

function chunkEvent(byte = 1) {
  return {
    data: {
      size: 1,
      type: 'audio/webm',
      async arrayBuffer() {
        return Uint8Array.from([byte]).buffer;
      }
    }
  };
}

test('openai transcription enters backoff after repeated failures and stops sending during it, then recovers', async () => {
  await withFakeNavigatorAndRecorder(async (getRecorder) => {
    const statusMessages = [];
    let nextId = 1;
    const pendingFns = new Map();
    const setTimeoutFn = (fn, delay) => {
      const id = nextId++;
      pendingFns.set(id, { fn, delay });
      return id;
    };
    const clearTimeoutFn = (id) => pendingFns.delete(id);
    const runNextTimer = () => {
      const [id, { fn }] = [...pendingFns.entries()][0];
      pendingFns.delete(id);
      fn();
    };

    let shouldFail = true;
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      setTimeoutFn,
      clearTimeoutFn,
      fetchImpl: async () => {
        if (shouldFail) throw new Error('network down');
        return { ok: true, status: 200, json: async () => ({ text: 'hello' }) };
      },
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start({ currentMode: 'speaker' });
    const recorder = getRecorder();

    // Three consecutive failing chunks reach FAILURE_THRESHOLD and trigger backoff.
    for (let i = 0; i < 3; i += 1) {
      recorder.ondataavailable(chunkEvent(i));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.match(
      statusMessages.at(-1),
      /Pausing sends for \d+s.*captured audio is not being sent/
    );
    assert.equal(pendingFns.size, 1, 'one backoff cooldown timer scheduled');

    // While in backoff, further chunks are dropped without attempting a send.
    const messagesBeforeDrop = statusMessages.length;
    recorder.ondataavailable(chunkEvent(99));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(statusMessages.length, messagesBeforeDrop, 'no new status spam per dropped chunk while backing off');

    // Cooldown elapses; next chunk is attempted again, and this one succeeds.
    shouldFail = false;
    runNextTimer();
    recorder.ondataavailable(chunkEvent(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(pendingFns.size, 0, 'backoff timer not left dangling after recovery');
  });
});

test('openai transcription bounds the send queue and reports skipped audio honestly', async () => {
  await withFakeNavigatorAndRecorder(async (getRecorder) => {
    const statusMessages = [];
    let resolveFns = [];
    let nextId = 1;
    const pendingFns = new Map();
    const setTimeoutFn = (fn, delay) => {
      const id = nextId++;
      pendingFns.set(id, fn);
      return id;
    };
    const clearTimeoutFn = (id) => pendingFns.delete(id);

    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      setTimeoutFn,
      clearTimeoutFn,
      fetchImpl: () =>
        new Promise((resolve) => {
          resolveFns.push(resolve);
        }),
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start({ currentMode: 'speaker' });
    const recorder = getRecorder();

    // MAX_PENDING_CHUNKS (3) chunks queue up behind a hung request.
    for (let i = 0; i < 3; i += 1) {
      recorder.ondataavailable(chunkEvent(i));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(statusMessages.some((msg) => /Falling behind live speech/.test(msg)), false);

    // A 4th chunk arrives while 3 are still pending: it must be dropped and
    // the operator told, never silently discarded.
    recorder.ondataavailable(chunkEvent(4));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(statusMessages.at(-1), /Falling behind live speech — skipping audio to catch back up/);

    await driver.stop();
    for (const resolve of resolveFns) {
      resolve({ ok: true, status: 200, json: async () => ({}) });
    }
  });
});

function makeFakeAudioParam(initial = 1) {
  return { value: initial, setTargetAtTime(target) { this.value = target; } };
}

function makeFakeConditionedContext(conditionedStream) {
  return {
    currentTime: 0,
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createBiquadFilter: () => ({ type: '', frequency: makeFakeAudioParam(80), connect() {}, disconnect() {} }),
    createGain: () => ({ gain: makeFakeAudioParam(1), connect() {}, disconnect() {} }),
    createAnalyser: () => ({
      fftSize: 2048,
      connect() {},
      disconnect() {},
      getFloatTimeDomainData(buffer) { buffer.fill(0); }
    }),
    createDynamicsCompressor: () => ({
      threshold: makeFakeAudioParam(-24),
      knee: makeFakeAudioParam(30),
      ratio: makeFakeAudioParam(12),
      attack: makeFakeAudioParam(0.003),
      release: makeFakeAudioParam(0.25),
      connect() {},
      disconnect() {}
    }),
    createMediaStreamDestination: () => ({ stream: conditionedStream, connect() {}, disconnect() {} }),
    close() {}
  };
}

test('openai transcription requests the three browser constraints instead of a bare audio:true', async () => {
  await withFakeNavigatorAndRecorder(async () => {
    let capturedConstraints = null;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      capturedConstraints = constraints;
      return originalGetUserMedia(constraints);
    };

    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: { audioBrowserAgc: true, audioBrowserNoiseSuppression: true, audioBrowserEchoCancel: false },
      audioContextFactory: undefined // no Web Audio available -- must still work
    });
    await driver.start({ currentMode: 'speaker' });
    await driver.stop();

    assert.deepEqual(capturedConstraints, {
      audio: {
        autoGainControl: true,
        noiseSuppression: true,
        echoCancellation: false
      }
    });
  });
});

test('openai transcription merges a chosen deviceId into the getUserMedia constraint', async () => {
  await withFakeNavigatorAndRecorder(async () => {
    let capturedConstraints = null;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      capturedConstraints = constraints;
      return originalGetUserMedia(constraints);
    };

    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: { audioDeviceId: 'mic-42' },
      audioContextFactory: undefined
    });
    await driver.start({ currentMode: 'speaker' });
    await driver.stop();

    assert.deepEqual(capturedConstraints.audio.deviceId, { exact: 'mic-42' });
  });
});

test('a saved microphone that has been unplugged (OverconstrainedError) retries once against the system default instead of failing start()', async () => {
  await withFakeNavigatorAndRecorder(async () => {
    const seenConstraints = [];
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      seenConstraints.push(constraints);
      if (constraints.audio?.deviceId) {
        const error = new Error('Requested device not found');
        error.name = 'OverconstrainedError';
        throw error;
      }
      return originalGetUserMedia(constraints);
    };

    const diagnostics = [];
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: { audioDeviceId: 'unplugged-mic' },
      audioContextFactory: undefined,
      onAudioDiagnostics: ({ message }) => diagnostics.push(message)
    });

    await driver.start({ currentMode: 'speaker' }); // must not throw
    await driver.stop();

    assert.equal(seenConstraints.length, 2, 'expected an initial attempt plus one retry without the deviceId');
    assert.equal(seenConstraints[0].audio.deviceId.exact, 'unplugged-mic');
    assert.equal(seenConstraints[1].audio.deviceId, undefined);
    assert.ok(diagnostics.some((message) => /unavailable/i.test(message)));
  });
});

test('MediaRecorder receives the conditioned stream when a real AudioContext-like graph is available', async () => {
  await withFakeNavigatorAndRecorder(async (getRecorder) => {
    const conditionedStream = { id: 'conditioned', getTracks: () => [] };
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: { audioConditioningEnabled: true, audioProcessingPreset: 'gentle' },
      audioContextFactory: () => makeFakeConditionedContext(conditionedStream)
    });
    await driver.start({ currentMode: 'speaker' });
    const recorder = getRecorder();
    assert.equal(recorder.stream, conditionedStream, 'MediaRecorder must receive the conditioned stream, not the raw one');
    await driver.stop();
  });
});

test('MediaRecorder receives the raw stream, a genuine passthrough, when audioConditioningEnabled is false', async () => {
  await withFakeNavigatorAndRecorder(async (getRecorder) => {
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: { audioConditioningEnabled: false },
      audioContextFactory: () => makeFakeConditionedContext({ id: 'conditioned-should-not-be-used' })
    });
    await driver.start({ currentMode: 'speaker' });
    const recorder = getRecorder();
    assert.notEqual(recorder.stream?.id, 'conditioned-should-not-be-used');
    await driver.stop();
  });
});

test('MediaRecorder receives the raw stream by default -- audioConditioningEnabled unset is the shipped bypass default', async () => {
  await withFakeNavigatorAndRecorder(async (getRecorder) => {
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: {},
      audioContextFactory: () => makeFakeConditionedContext({ id: 'conditioned-should-not-be-used' })
    });
    await driver.start({ currentMode: 'speaker' });
    const recorder = getRecorder();
    assert.notEqual(recorder.stream?.id, 'conditioned-should-not-be-used');
    await driver.stop();
  });
});

test('MediaRecorder still receives a working raw stream when no AudioContext is available at all', async () => {
  await withFakeNavigatorAndRecorder(async (getRecorder) => {
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: {},
      audioContextFactory: undefined
    });
    await driver.start({ currentMode: 'speaker' });
    const recorder = getRecorder();
    assert.ok(recorder.stream, 'transcription keeps working on the raw stream when conditioning is unavailable');
    await driver.stop();
  });
});

test('readLevels() exposes conditioner levels when connected, and null when there is no conditioner', async () => {
  await withFakeNavigatorAndRecorder(async () => {
    const conditionedStream = { id: 'conditioned', getTracks: () => [] };
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioContextFactory: () => makeFakeConditionedContext(conditionedStream)
    });
    assert.equal(driver.readLevels(), null, 'no levels before start()');
    await driver.start({ currentMode: 'speaker' });
    assert.ok(driver.readLevels(), 'levels available once connected');
    await driver.stop();
  });
});
