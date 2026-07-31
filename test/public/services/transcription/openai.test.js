import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOpenAITranscriptionDriver,
  downsampleTo16kMono,
  floatTo16BitPCM,
  buildWavBytes,
  TARGET_SAMPLE_RATE
} from '../../../../public/services/transcription/openai.js';

// --- Shared fakes -----------------------------------------------------------------------------
//
// The capture path is: getUserMedia -> conditioner.connect (bypassed by default, returns the raw
// stream) -> a dedicated capture AudioContext whose audioWorklet.addModule loads
// pcm-worklet-processor.js -> an AudioWorkletNode fed by createMediaStreamSource. Node has no real
// Web Audio, so these fakes stand in for exactly that surface: a context with audioWorklet +
// createMediaStreamSource, and a controllable `AudioWorkletNode` global whose `.port.onmessage`
// the test drives directly with synthetic Float32Array frames.

function makeFakeCaptureContext({ sampleRate = TARGET_SAMPLE_RATE } = {}) {
  return {
    sampleRate,
    audioWorklet: { addModule: async () => {} },
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    close: async () => {}
  };
}

function installFakeAudioWorkletNode() {
  const original = global.AudioWorkletNode;
  const instances = [];
  global.AudioWorkletNode = class {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
      instances.push(this);
    }

    connect() {}

    disconnect() {}
  };
  return {
    getNode: () => instances.at(-1),
    restore: () => {
      global.AudioWorkletNode = original;
    }
  };
}

function withFakeNavigatorAndWorklet(run) {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const originalBtoa = global.btoa;
  const fakeWorklet = installFakeAudioWorkletNode();

  const stream = { getTracks: () => [{ stop() {} }] };
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
    writable: true
  });
  global.btoa = originalBtoa || ((value) => Buffer.from(value, 'binary').toString('base64'));

  return run(fakeWorklet.getNode).finally(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
    } else {
      delete global.navigator;
    }
    global.btoa = originalBtoa;
    fakeWorklet.restore();
  });
}

// Builds a mono Float32Array of `count` samples, each a distinct small value so a downsample /
// reassembly bug shows up as a value mismatch rather than silently passing on all-zero data.
function fakeFrame(count, offset = 0) {
  const frame = new Float32Array(count);
  for (let i = 0; i < count; i += 1) frame[i] = ((offset + i) % 100) / 1000;
  return frame;
}

function wavHeaderFields(bytes) {
  const buf = Buffer.from(bytes);
  return {
    riff: buf.toString('ascii', 0, 4),
    wave: buf.toString('ascii', 8, 12),
    audioFormat: buf.readUInt16LE(20),
    numChannels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    bitsPerSample: buf.readUInt16LE(34),
    dataSize: buf.readUInt32LE(40),
    declaredRiffSize: buf.readUInt32LE(4)
  };
}

// --- Pure helper unit tests --------------------------------------------------------------------

test('buildWavBytes writes a valid 44-byte RIFF/WAVE header at 16kHz mono 16-bit', () => {
  const int16 = new Int16Array([0, 100, -100, 32767, -32768]);
  const wav = buildWavBytes(int16, TARGET_SAMPLE_RATE);
  const fields = wavHeaderFields(wav);

  assert.equal(fields.riff, 'RIFF');
  assert.equal(fields.wave, 'WAVE');
  assert.equal(fields.audioFormat, 1);
  assert.equal(fields.numChannels, 1);
  assert.equal(fields.sampleRate, 16000);
  assert.equal(fields.bitsPerSample, 16);
  assert.equal(fields.dataSize, int16.length * 2, 'declared data length matches the payload');
  assert.equal(wav.length, 44 + int16.length * 2);
  assert.equal(fields.declaredRiffSize, 36 + int16.length * 2);
});

test('downsampleTo16kMono passes samples through unchanged at 16kHz native rate', () => {
  const samples = fakeFrame(50);
  const out = downsampleTo16kMono(samples, TARGET_SAMPLE_RATE);
  assert.deepEqual([...out], [...samples]);
});

test('downsampleTo16kMono reduces sample count proportionally at 48kHz native rate', () => {
  const samples = fakeFrame(4800); // 100ms @ 48kHz
  const out = downsampleTo16kMono(samples, 48000);
  assert.equal(out.length, 1600); // 100ms @ 16kHz
});

test('floatTo16BitPCM clamps and scales into the int16 range', () => {
  const out = floatTo16BitPCM(new Float32Array([0, 1, -1, 2, -2, 0.5]));
  assert.equal(out[0], 0);
  assert.equal(out[1], 0x7fff);
  assert.equal(out[2], -0x8000);
  assert.equal(out[3], 0x7fff, 'above-range values clamp rather than wrap');
  assert.equal(out[4], -0x8000);
});

// --- Driver integration tests --------------------------------------------------------------------

test('openai transcription emits a valid standalone WAV for chunk 1 AND chunk 2 (the regression this replaced)', async () => {
  await withFakeNavigatorAndWorklet(async (getNode) => {
    const capturedBodies = [];
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioContextFactory: () => makeFakeCaptureContext({ sampleRate: TARGET_SAMPLE_RATE }),
      fetchImpl: async (url, options) => {
        capturedBodies.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    assert.ok(node, 'AudioWorkletNode was constructed');

    const samplesPerChunk = TARGET_SAMPLE_RATE * (3500 / 1000); // 56000 samples

    // Chunk 1.
    node.port.onmessage({ data: fakeFrame(samplesPerChunk, 0) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Chunk 2 -- this is the exact regression the WebM splice fix was papering over: chunk 2 must
    // be independently valid, not dependent on chunk 1's header.
    node.port.onmessage({ data: fakeFrame(samplesPerChunk, 7) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(capturedBodies.length, 2);

    // The driver must not offer meeting context to the transcription stage at all. Asserting the
    // ABSENCE of both, because a driver that merely stops using its mode still advertises that it
    // takes one, and that shape is what invited the prompt in issue #27.
    assert.equal(typeof driver.setMode, 'undefined', 'the OpenAI driver must not expose setMode');

    for (const [index, body] of capturedBodies.entries()) {
      assert.equal('mode' in body, false, `chunk ${index + 1} must not send a mode`);
      assert.equal(body.mimeType, 'audio/wav');
      assert.match(body.filename, /\.wav$/);
      const bytes = Buffer.from(body.audioBase64, 'base64');
      const fields = wavHeaderFields(bytes);
      assert.equal(fields.riff, 'RIFF', `chunk ${index + 1} begins with RIFF`);
      assert.equal(fields.wave, 'WAVE', `chunk ${index + 1} has WAVE at offset 8`);
      assert.equal(fields.sampleRate, 16000, `chunk ${index + 1} declares 16000 Hz`);
      assert.equal(fields.numChannels, 1, `chunk ${index + 1} declares 1 channel`);
      assert.equal(fields.bitsPerSample, 16, `chunk ${index + 1} declares 16 bits`);
      assert.equal(fields.dataSize, bytes.length - 44, `chunk ${index + 1} declared data length matches payload`);
    }

    await driver.stop();
  });
});

test('openai transcription downsamples 48kHz native audio to 16kHz before sending', async () => {
  await withFakeNavigatorAndWorklet(async (getNode) => {
    const capturedBodies = [];
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 1000,
      audioContextFactory: () => makeFakeCaptureContext({ sampleRate: 48000 }),
      fetchImpl: async (url, options) => {
        capturedBodies.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();

    node.port.onmessage({ data: fakeFrame(48000, 0) }); // 1000ms @ 48kHz native
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(capturedBodies.length, 1);
    const bytes = Buffer.from(capturedBodies[0].audioBase64, 'base64');
    const fields = wavHeaderFields(bytes);
    assert.equal(fields.sampleRate, 16000);
    assert.equal(fields.dataSize, 16000 * 2, '1000ms of native audio downsamples to 16000 int16 samples');

    await driver.stop();
  });
});

test('openai transcription silence gate: a session that only hears silence sends nothing (issue #23)', async () => {
  await withFakeNavigatorAndWorklet(async (getNode) => {
    let fetchCalled = false;
    const diagnostics = [];
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioContextFactory: () => makeFakeCaptureContext({ sampleRate: TARGET_SAMPLE_RATE }),
      onAudioDiagnostics: (event) => diagnostics.push(event.message),
      fetchImpl: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();

    const samplesPerChunk = TARGET_SAMPLE_RATE * (3500 / 1000);
    node.port.onmessage({ data: new Float32Array(samplesPerChunk) }); // pure silence
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(fetchCalled, false, 'a silent chunk must never be encoded and sent');
    assert.ok(
      diagnostics.some((msg) => /silent audio chunk/i.test(msg)),
      'the skip is reported via onAudioDiagnostics'
    );

    await driver.stop();
  });
});

test('openai transcription silence gate: a chunk with audible samples is still sent', async () => {
  await withFakeNavigatorAndWorklet(async (getNode) => {
    const capturedBodies = [];
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioContextFactory: () => makeFakeCaptureContext({ sampleRate: TARGET_SAMPLE_RATE }),
      fetchImpl: async (url, options) => {
        capturedBodies.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();

    const samplesPerChunk = TARGET_SAMPLE_RATE * (3500 / 1000);
    node.port.onmessage({ data: fakeFrame(samplesPerChunk, 0) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(capturedBodies.length, 1, 'a chunk with real speech-level audio is still sent');

    await driver.stop();
  });
});

test('openai transcription fails visibly, without falling back silently, when AudioWorklet is unavailable', async () => {
  await withFakeNavigatorAndWorklet(async () => {
    const statusMessages = [];
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioContextFactory: () => makeFakeCaptureContext(),
      onStatus: (text) => statusMessages.push(text)
    });

    const originalAudioWorkletNode = global.AudioWorkletNode;
    delete global.AudioWorkletNode;
    try {
      await assert.rejects(() => driver.start({ currentMode: 'speaker' }), /AudioWorklet capture is not available/);
      assert.ok(statusMessages.some((msg) => /cannot start/i.test(msg)), 'a clear status message was reported');
    } finally {
      global.AudioWorkletNode = originalAudioWorkletNode;
    }
  });
});

test('openai transcription cancels in-flight chunk uploads on stop', async () => {
  await withFakeNavigatorAndWorklet(async (getNode) => {
    const statusMessages = [];
    let fetchStarted = false;
    let fetchAborted = false;
    let fetchSignal = null;

    const driver = createOpenAITranscriptionDriver({
      chunkMs: 50,
      audioContextFactory: () => makeFakeCaptureContext(),
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

    let trackStopped = false;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop: () => { trackStopped = true; } }]
    });

    try {
      await driver.start({ currentMode: 'speaker' });
      const node = getNode();
      node.port.onmessage({ data: fakeFrame(TARGET_SAMPLE_RATE * (50 / 1000)) });

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
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
  });
});

test('openai transcription enters backoff after repeated failures and stops sending during it, then recovers', async () => {
  await withFakeNavigatorAndWorklet(async (getNode) => {
    const statusMessages = [];
    let nextId = 1;
    const pendingFns = new Map();
    const setTimeoutFn = (fn) => {
      const id = nextId++;
      pendingFns.set(id, fn);
      return id;
    };
    const clearTimeoutFn = (id) => pendingFns.delete(id);
    const runNextTimer = () => {
      const [id, fn] = [...pendingFns.entries()][0];
      pendingFns.delete(id);
      fn();
    };

    let shouldFail = true;
    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      setTimeoutFn,
      clearTimeoutFn,
      audioContextFactory: () => makeFakeCaptureContext(),
      fetchImpl: async () => {
        if (shouldFail) throw new Error('network down');
        return { ok: true, status: 200, json: async () => ({ text: 'hello' }) };
      },
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    const samplesPerChunk = TARGET_SAMPLE_RATE * (3500 / 1000);

    for (let i = 0; i < 3; i += 1) {
      node.port.onmessage({ data: fakeFrame(samplesPerChunk, i) });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.match(
      statusMessages.at(-1),
      /Pausing sends for \d+s.*captured audio is not being sent/
    );
    assert.equal(pendingFns.size, 1, 'one backoff cooldown timer scheduled');

    const messagesBeforeDrop = statusMessages.length;
    node.port.onmessage({ data: fakeFrame(samplesPerChunk, 99) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(statusMessages.length, messagesBeforeDrop, 'no new status spam per dropped chunk while backing off');

    shouldFail = false;
    runNextTimer();
    node.port.onmessage({ data: fakeFrame(samplesPerChunk, 2) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(pendingFns.size, 0, 'backoff timer not left dangling after recovery');
    await driver.stop();
  });
});

test('openai transcription bounds the send queue and reports skipped audio honestly', async () => {
  await withFakeNavigatorAndWorklet(async (getNode) => {
    const statusMessages = [];
    let resolveFns = [];
    let nextId = 1;
    const pendingFns = new Map();
    const setTimeoutFn = (fn) => {
      const id = nextId++;
      pendingFns.set(id, fn);
      return id;
    };
    const clearTimeoutFn = (id) => pendingFns.delete(id);

    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      setTimeoutFn,
      clearTimeoutFn,
      audioContextFactory: () => makeFakeCaptureContext(),
      fetchImpl: () =>
        new Promise((resolve) => {
          resolveFns.push(resolve);
        }),
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    const samplesPerChunk = TARGET_SAMPLE_RATE * (3500 / 1000);

    for (let i = 0; i < 3; i += 1) {
      node.port.onmessage({ data: fakeFrame(samplesPerChunk, i) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(statusMessages.some((msg) => /Falling behind live speech/.test(msg)), false);

    node.port.onmessage({ data: fakeFrame(samplesPerChunk, 4) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(statusMessages.at(-1), /Falling behind live speech — skipping audio to catch back up/);

    await driver.stop();
    for (const resolve of resolveFns) {
      resolve({ ok: true, status: 200, json: async () => ({}) });
    }
  });
});

test('openai transcription requests the three browser constraints instead of a bare audio:true', async () => {
  await withFakeNavigatorAndWorklet(async () => {
    let capturedConstraints = null;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      capturedConstraints = constraints;
      return originalGetUserMedia(constraints);
    };

    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: { audioBrowserAgc: true, audioBrowserNoiseSuppression: true, audioBrowserEchoCancel: false },
      audioContextFactory: () => makeFakeCaptureContext()
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
  await withFakeNavigatorAndWorklet(async () => {
    let capturedConstraints = null;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      capturedConstraints = constraints;
      return originalGetUserMedia(constraints);
    };

    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: { audioDeviceId: 'mic-42' },
      audioContextFactory: () => makeFakeCaptureContext()
    });
    await driver.start({ currentMode: 'speaker' });
    await driver.stop();

    assert.deepEqual(capturedConstraints.audio.deviceId, { exact: 'mic-42' });
  });
});

test('a saved microphone that has been unplugged (OverconstrainedError) retries once against the system default instead of failing start()', async () => {
  await withFakeNavigatorAndWorklet(async () => {
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
      audioContextFactory: () => makeFakeCaptureContext(),
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

test('readLevels() exposes conditioner levels when connected, and null when there is no conditioner', async () => {
  await withFakeNavigatorAndWorklet(async () => {
    function makeFakeAudioParam(initial = 1) {
      return { value: initial, setTargetAtTime(target) { this.value = target; } };
    }
    function makeFakeConditionedContext() {
      return {
        sampleRate: TARGET_SAMPLE_RATE,
        currentTime: 0,
        audioWorklet: { addModule: async () => {} },
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
        createMediaStreamDestination: () => ({ stream: { id: 'conditioned', getTracks: () => [] }, connect() {}, disconnect() {} }),
        close: async () => {}
      };
    }

    const driver = createOpenAITranscriptionDriver({
      chunkMs: 3500,
      audioSettings: { audioConditioningEnabled: true },
      audioContextFactory: makeFakeConditionedContext
    });
    assert.equal(driver.readLevels(), null, 'no levels before start()');
    await driver.start({ currentMode: 'speaker' });
    assert.ok(driver.readLevels(), 'levels available once connected');
    await driver.stop();
  });
});
