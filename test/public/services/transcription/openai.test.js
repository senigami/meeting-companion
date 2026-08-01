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
// The capture path is now: getUserMedia -> conditioner.connect (bypassed by default, returns the
// raw stream) -> a MicVAD instance (created via the injected `vadFactory`) fed that same stream
// through `getStream`. Node has no real Web Audio and no ONNX runtime, so `vadFactory` is a fake
// that captures the options MicVAD.new() was called with and hands the test a way to invoke
// onSpeechStart/onSpeechEnd/onVADMisfire directly, exactly as the real library would from its
// worker thread.

function makeFakeVadFactory({ getUserMediaCalls } = {}) {
  const instances = [];
  const factory = async (options) => {
    // Exercise getStream the same way MicVAD.new really would, so a regression that opens a
    // second microphone (rather than reusing the driver's stream) shows up here.
    const streamFromGetStream = await options.getStream();
    if (getUserMediaCalls) getUserMediaCalls.viaGetStream = streamFromGetStream;
    const instance = {
      options,
      started: false,
      destroyed: false,
      paused: false,
      start() { instance.started = true; },
      pause() { instance.paused = true; options.pauseStream?.(); },
      destroy() { instance.destroyed = true; },
      emitSpeechStart() { options.onSpeechStart?.(); },
      emitSpeechEnd(audio) { options.onSpeechEnd?.(audio); },
      emitMisfire() { options.onVADMisfire?.(); },
      emitFrameProcessed(frame, probabilities = { isSpeech: 1 }) { options.onFrameProcessed?.(probabilities, frame); }
    };
    instances.push(instance);
    return instance;
  };
  return { factory, getNode: () => instances.at(-1) };
}

function withFakeNavigator(run) {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const originalBtoa = global.btoa;

  let getUserMediaCallCount = 0;
  const stream = { getTracks: () => [{ stop() {} }] };
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          getUserMediaCallCount += 1;
          return stream;
        }
      }
    },
    writable: true
  });
  global.btoa = originalBtoa || ((value) => Buffer.from(value, 'binary').toString('base64'));

  return run({ stream, getGetUserMediaCallCount: () => getUserMediaCallCount }).finally(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
    } else {
      delete global.navigator;
    }
    global.btoa = originalBtoa;
  });
}

// Builds a fake speech-segment Float32Array (already at 16kHz, as onSpeechEnd delivers in reality)
// of `count` samples, each a distinct small value so a reassembly bug shows up as a value mismatch
// rather than silently passing on all-zero data.
function fakeSegment(count, offset = 0) {
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
  const samples = fakeSegment(50);
  const out = downsampleTo16kMono(samples, TARGET_SAMPLE_RATE);
  assert.deepEqual([...out], [...samples]);
});

test('downsampleTo16kMono reduces sample count proportionally at 48kHz native rate', () => {
  const samples = fakeSegment(4800); // 100ms @ 48kHz
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

test('openai transcription: a session where onSpeechEnd never fires sends nothing', async () => {
  await withFakeNavigator(async () => {
    let fetchCalled = false;
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      fetchImpl: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    assert.ok(getNode(), 'a MicVAD instance was created');
    assert.equal(getNode().started, true, 'MicVAD was started');

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fetchCalled, false, 'no speech segment means nothing is ever sent');

    await driver.stop();
  });
});

test('openai transcription: one onSpeechEnd call produces exactly one POST of a valid 16kHz mono WAV', async () => {
  await withFakeNavigator(async () => {
    const capturedBodies = [];
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      fetchImpl: async (url, options) => {
        capturedBodies.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    node.emitSpeechStart();
    node.emitSpeechEnd(fakeSegment(16000, 0)); // 1s of "speech" already at 16kHz
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(capturedBodies.length, 1);
    const body = capturedBodies[0];
    assert.equal(body.mimeType, 'audio/wav');
    assert.match(body.filename, /\.wav$/);
    assert.equal('mode' in body, false, 'must not send a mode -- see issue #27');
    const bytes = Buffer.from(body.audioBase64, 'base64');
    const fields = wavHeaderFields(bytes);
    assert.equal(fields.riff, 'RIFF');
    assert.equal(fields.wave, 'WAVE');
    assert.equal(fields.sampleRate, 16000, 'declares 16000 Hz');
    assert.equal(fields.numChannels, 1, 'declares 1 channel');
    assert.equal(fields.bitsPerSample, 16);
    assert.equal(fields.dataSize, bytes.length - 44);

    await driver.stop();
  });
});

test('openai transcription: MicVAD is given the driver\'s existing stream and never opens the mic a second time', async () => {
  await withFakeNavigator(async ({ stream, getGetUserMediaCallCount }) => {
    const getUserMediaCalls = {};
    const { factory } = makeFakeVadFactory({ getUserMediaCalls });
    const driver = createOpenAITranscriptionDriver({ vadFactory: factory });

    await driver.start({ currentMode: 'speaker' });

    assert.equal(getGetUserMediaCallCount(), 1, 'getUserMedia must be called exactly once');
    assert.equal(getUserMediaCalls.viaGetStream, stream, 'MicVAD.getStream() returns the driver\'s own stream');

    await driver.stop();
  });
});

test('openai transcription: stop() tears the VAD down and a late onSpeechEnd after stop sends nothing', async () => {
  await withFakeNavigator(async () => {
    let fetchCalled = false;
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      fetchImpl: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    await driver.stop();

    assert.equal(node.paused, true, 'VAD was paused on stop');
    assert.equal(node.destroyed, true, 'VAD was destroyed on stop');

    // A late callback firing after stop (e.g. a queued worker message) must be a no-op thanks to
    // the session guard, exactly as the old worklet path guarded on currentSession !== sessionId.
    node.emitSpeechEnd(fakeSegment(16000, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fetchCalled, false, 'a late speech segment after stop must never be sent');
  });
});

test('openai transcription: onVADMisfire is reported via onAudioDiagnostics, not the status rail', async () => {
  await withFakeNavigator(async () => {
    const diagnostics = [];
    const statusMessages = [];
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      onAudioDiagnostics: (event) => diagnostics.push(event),
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start({ currentMode: 'speaker' });
    getNode().emitMisfire();

    assert.ok(diagnostics.some((event) => /too short/i.test(event.message)));
    assert.equal(statusMessages.some((message) => /too short/i.test(message)), false, 'a misfire is not a status/rail message');
    assert.equal(diagnostics.some((event) => event.notable), false, 'a misfire is not notable');

    await driver.stop();
  });
});

test('openai transcription: a VAD that fails to load makes start() reject and sends nothing', async () => {
  await withFakeNavigator(async () => {
    let fetchCalled = false;
    const statusMessages = [];
    const driver = createOpenAITranscriptionDriver({
      vadFactory: async () => {
        throw new Error('failed to load onnxruntime-web');
      },
      fetchImpl: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      },
      onStatus: (text) => statusMessages.push(text)
    });

    await assert.rejects(() => driver.start({ currentMode: 'speaker' }), /failed to load onnxruntime-web/);
    assert.ok(statusMessages.some((msg) => /cannot start/i.test(msg)), 'a clear status message was reported');
    assert.equal(fetchCalled, false, 'nothing is ever sent when the VAD never started');
  });
});

test('openai transcription cancels in-flight chunk uploads on stop', async () => {
  await withFakeNavigator(async () => {
    const statusMessages = [];
    let fetchStarted = false;
    let fetchAborted = false;
    let fetchSignal = null;

    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
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
      node.emitSpeechEnd(fakeSegment(16000));

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
  await withFakeNavigator(async () => {
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
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      setTimeoutFn,
      clearTimeoutFn,
      fetchImpl: async () => {
        if (shouldFail) throw new Error('network down');
        return { ok: true, status: 200, json: async () => ({ text: 'hello' }) };
      },
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();

    for (let i = 0; i < 3; i += 1) {
      node.emitSpeechEnd(fakeSegment(16000, i));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.match(
      statusMessages.at(-1),
      /Pausing sends for \d+s.*captured audio is not being sent/
    );
    assert.equal(pendingFns.size, 1, 'one backoff cooldown timer scheduled');

    const messagesBeforeDrop = statusMessages.length;
    node.emitSpeechEnd(fakeSegment(16000, 99));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(statusMessages.length, messagesBeforeDrop, 'no new status spam per dropped chunk while backing off');

    shouldFail = false;
    runNextTimer();
    node.emitSpeechEnd(fakeSegment(16000, 2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(pendingFns.size, 0, 'backoff timer not left dangling after recovery');
    await driver.stop();
  });
});

test('openai transcription bounds the send queue and reports skipped audio honestly', async () => {
  await withFakeNavigator(async () => {
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

    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      setTimeoutFn,
      clearTimeoutFn,
      fetchImpl: () =>
        new Promise((resolve) => {
          resolveFns.push(resolve);
        }),
      onStatus: (text) => statusMessages.push(text)
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();

    for (let i = 0; i < 3; i += 1) {
      node.emitSpeechEnd(fakeSegment(16000, i));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(statusMessages.some((msg) => /Falling behind live speech/.test(msg)), false);

    node.emitSpeechEnd(fakeSegment(16000, 4));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(statusMessages.at(-1), /Falling behind live speech — skipping audio to catch back up/);

    await driver.stop();
    for (const resolve of resolveFns) {
      resolve({ ok: true, status: 200, json: async () => ({}) });
    }
  });
});

test('openai transcription requests the three browser constraints instead of a bare audio:true', async () => {
  await withFakeNavigator(async () => {
    let capturedConstraints = null;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      capturedConstraints = constraints;
      return originalGetUserMedia(constraints);
    };

    const { factory } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      audioSettings: { audioBrowserAgc: true, audioBrowserNoiseSuppression: true, audioBrowserEchoCancel: false }
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
  await withFakeNavigator(async () => {
    let capturedConstraints = null;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      capturedConstraints = constraints;
      return originalGetUserMedia(constraints);
    };

    const { factory } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      audioSettings: { audioDeviceId: 'mic-42' }
    });
    await driver.start({ currentMode: 'speaker' });
    await driver.stop();

    assert.deepEqual(capturedConstraints.audio.deviceId, { exact: 'mic-42' });
  });
});

test('a saved microphone that has been unplugged (OverconstrainedError) retries once against the system default instead of failing start()', async () => {
  await withFakeNavigator(async () => {
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
    const { factory } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      audioSettings: { audioDeviceId: 'unplugged-mic' },
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

test('reportGrantedConstraints: reports the granted device label and a truncated deviceId as a notable status', async () => {
  await withFakeNavigator(async () => {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop() {} }],
      getAudioTracks: () => [{
        label: 'UV1 (1397:0510)',
        getSettings: () => ({ deviceId: 'abcdef1234567890longhash', autoGainControl: true, noiseSuppression: true, echoCancellation: false })
      }]
    });

    const diagnostics = [];
    const { factory } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      onAudioDiagnostics: (event) => diagnostics.push(event)
    });

    try {
      await driver.start({ currentMode: 'speaker' });
      const deviceEvent = diagnostics.find((event) => /Microphone in use/.test(event.message));
      assert.ok(deviceEvent, 'a "Microphone in use" diagnostic was reported');
      assert.equal(deviceEvent.notable, true, 'device identity reaches the operator status line');
      assert.match(deviceEvent.message, /^Microphone in use: UV1 \(1397:0510\)\./, 'device name comes first');
      assert.match(deviceEvent.message, /abcdef12/, 'a short deviceId is included');
      assert.doesNotMatch(deviceEvent.message, /abcdef1234567890longhash/, 'the full deviceId hash is not printed');
      await driver.stop();
    } finally {
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
  });
});

test('reportGrantedConstraints: an empty track.label (permission not yet reflected) is reported honestly, not as a blank name', async () => {
  await withFakeNavigator(async () => {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop() {} }],
      getAudioTracks: () => [{
        label: '',
        getSettings: () => ({ deviceId: 'abcdef1234567890longhash', autoGainControl: true, noiseSuppression: true, echoCancellation: false })
      }]
    });

    const diagnostics = [];
    const { factory } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      onAudioDiagnostics: (event) => diagnostics.push(event)
    });

    try {
      await driver.start({ currentMode: 'speaker' });
      const deviceEvent = diagnostics.find((event) => /Microphone in use/.test(event.message));
      assert.ok(deviceEvent);
      assert.match(deviceEvent.message, /name unavailable until permission is granted/);
      await driver.stop();
    } finally {
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
  });
});

test('readLevels() exposes conditioner levels when connected, and null when there is no conditioner', async () => {
  await withFakeNavigator(async () => {
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

    const { factory } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      audioSettings: { audioConditioningEnabled: true },
      audioContextFactory: makeFakeConditionedContext
    });
    assert.equal(driver.readLevels(), null, 'no levels before start()');
    await driver.start({ currentMode: 'speaker' });
    assert.ok(driver.readLevels(), 'levels available once connected');
    await driver.stop();
  });
});

// --- onFrameProcessed accumulator: length cap + flush-on-stop (issue #19) ----------------------

test('openai transcription: a speech segment in progress is flushed as a final chunk on stop() (issue #19)', async () => {
  await withFakeNavigator(async () => {
    const capturedBodies = [];
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      fetchImpl: async (url, options) => {
        capturedBodies.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ text: 'last words' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    node.emitSpeechStart();
    // 1s of "speech" fed as frames, no onSpeechEnd -- the segment is still open when stop() runs.
    node.emitFrameProcessed(fakeSegment(16000, 0));
    await driver.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(capturedBodies.length, 1, 'the in-progress utterance was flushed as a final chunk');
    const bytes = Buffer.from(capturedBodies[0].audioBase64, 'base64');
    assert.ok(bytes.length > 44, 'the WAV payload is non-empty');
    const fields = wavHeaderFields(bytes);
    assert.equal(fields.sampleRate, 16000, 'declares 16000 Hz');
  });
});

test('openai transcription: less than 0.3s accumulated at stop() sends nothing', async () => {
  await withFakeNavigator(async () => {
    let fetchCalled = false;
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      fetchImpl: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    node.emitSpeechStart();
    // Well under 0.3s (4800 samples) at 16kHz.
    node.emitFrameProcessed(fakeSegment(100, 0));
    await driver.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(fetchCalled, false, 'too little audio accumulated to be worth sending');
  });
});

test('openai transcription: frames past 60s while still speaking split into chunks without onSpeechEnd firing', async () => {
  await withFakeNavigator(async () => {
    const capturedBodies = [];
    const diagnostics = [];
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      onAudioDiagnostics: (event) => diagnostics.push(event),
      fetchImpl: async (url, options) => {
        capturedBodies.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ text: 'segment' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    node.emitSpeechStart();

    // 61 one-second frames (16000 samples each) with no pause -- crosses the 60s cap mid-speech.
    for (let i = 0; i < 61; i += 1) {
      node.emitFrameProcessed(fakeSegment(16000, i));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(capturedBodies.length, 1, 'first 60s split produced exactly one chunk');
    assert.ok(
      diagnostics.some((event) => /long utterance split/i.test(event.message)),
      'the split is reported via onAudioDiagnostics'
    );

    // A second 60s of continuous speech (still no onSpeechEnd) produces a second split chunk,
    // proving the accumulator actually reset rather than just refusing to grow further.
    for (let i = 0; i < 61; i += 1) {
      node.emitFrameProcessed(fakeSegment(16000, i));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(capturedBodies.length, 2, 'a second 60s of continuous speech produces a second split chunk');

    await driver.stop();
  });
});

test('openai transcription: frames delivered outside a speech segment accumulate nothing, so stop() sends nothing', async () => {
  await withFakeNavigator(async () => {
    let fetchCalled = false;
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      fetchImpl: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    // No onSpeechStart -- these frames arrive while VAD considers this silence/non-speech.
    node.emitFrameProcessed(fakeSegment(16000, 0));
    node.emitFrameProcessed(fakeSegment(16000, 1));
    await driver.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(fetchCalled, false, 'frames outside a speech segment must never be sent');
  });
});

test('openai transcription: a 60s segment stays under the 25mb server limit (blocker regression guard)', async () => {
  await withFakeNavigator(async () => {
    let capturedBase64 = null;
    const { factory, getNode } = makeFakeVadFactory();
    const driver = createOpenAITranscriptionDriver({
      vadFactory: factory,
      fetchImpl: async (url, options) => {
        capturedBase64 = JSON.parse(options.body).audioBase64;
        return { ok: true, status: 200, json: async () => ({ text: 'segment' }) };
      }
    });

    await driver.start({ currentMode: 'speaker' });
    const node = getNode();
    node.emitSpeechStart();
    for (let i = 0; i < 60; i += 1) {
      node.emitFrameProcessed(fakeSegment(16000, i));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(capturedBase64, 'the 60s segment was sent');
    // 16 kHz mono int16 base64 is 42,667 bytes/second, so 60s should be ~2.5mb -- well under the
    // 25mb express.json limit. A future change to either the cap or the limit should fail this
    // loudly rather than silently 413ing during a real meeting.
    assert.ok(
      capturedBase64.length < 25 * 1024 * 1024,
      `a 60s segment's base64 body (${capturedBase64.length} bytes) must stay under the 25mb server limit`
    );

    await driver.stop();
  });
});
