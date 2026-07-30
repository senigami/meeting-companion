import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAudioConditioner,
  createMicProbe,
  computeNextGainDb,
  classifyLevel,
  presetParams,
  dbToLinear,
  NOISE_FLOOR_DBFS
} from '../../../public/services/audio-processing.js';

// --- Pure-function AGC math: no Web Audio involved at all -----------------

test('AGC speech gate refuses to raise gain on silence', () => {
  const preset = presetParams('gentle');
  const silentRms = NOISE_FLOOR_DBFS - 5; // below the floor
  const next = computeNextGainDb({ rmsDbfs: silentRms, currentGainDb: 3, preset, elapsedMs: 500 });
  assert.equal(next, 3, 'gain must not move at all during silence');
});

test('AGC speech gate also holds gain steady right at the noise floor', () => {
  const preset = presetParams('gentle');
  const next = computeNextGainDb({ rmsDbfs: NOISE_FLOOR_DBFS, currentGainDb: -2, preset, elapsedMs: 500 });
  assert.equal(next, -2);
});

test('AGC clamps gain at the preset boost limit and never exceeds it', () => {
  const preset = presetParams('gentle'); // maxBoostDb: 9
  let gain = 0;
  for (let i = 0; i < 50; i += 1) {
    // Very quiet speech (above the floor) repeatedly pushes the desired gain far past the limit.
    gain = computeNextGainDb({ rmsDbfs: -45, currentGainDb: gain, preset, elapsedMs: 1500 });
  }
  assert.ok(gain <= 9.0001, `gain ${gain} exceeded max boost`);
});

test('AGC clamps gain at the preset cut limit and never goes below it', () => {
  const preset = presetParams('gentle'); // maxCutDb: -12
  let gain = 0;
  for (let i = 0; i < 50; i += 1) {
    gain = computeNextGainDb({ rmsDbfs: 0, currentGainDb: gain, preset, elapsedMs: 1500 });
  }
  assert.ok(gain >= -12.0001, `gain ${gain} exceeded max cut`);
});

test('off preset never adapts gain', () => {
  const preset = presetParams('off');
  const next = computeNextGainDb({ rmsDbfs: -5, currentGainDb: 4, preset, elapsedMs: 1000 });
  assert.equal(next, 0);
});

test('gentle and normal presets resolve to the documented parameters', () => {
  const gentle = presetParams('gentle');
  assert.equal(gentle.targetRmsDbfs, -18);
  assert.equal(gentle.maxBoostDb, 9);
  assert.equal(gentle.maxCutDb, -12);
  assert.equal(gentle.timeConstantSeconds, 1.5);
  assert.equal(gentle.compressor.threshold, -18);
  assert.equal(gentle.compressor.ratio, 2);
  assert.equal(gentle.compressor.knee, 12);

  const normal = presetParams('normal');
  assert.equal(normal.targetRmsDbfs, -15);
  assert.equal(normal.maxBoostDb, 12);
  assert.equal(normal.maxCutDb, -12);
  assert.equal(normal.timeConstantSeconds, 0.6);
  assert.equal(normal.compressor.threshold, -16);
  assert.equal(normal.compressor.ratio, 3);
  assert.equal(normal.compressor.knee, 6);
});

test('an unknown preset name falls back to gentle', () => {
  assert.deepEqual(presetParams('bogus'), presetParams('gentle'));
});

test('dbToLinear round-trips with 20*log10', () => {
  assert.ok(Math.abs(dbToLinear(0) - 1) < 1e-9);
  assert.ok(Math.abs(dbToLinear(-20) - 0.1) < 1e-9);
});

// --- Level classification --------------------------------------------------

test('level classification: IDLE when not speaking, regardless of RMS', () => {
  assert.equal(classifyLevel({ rmsDbfs: -60, peakDbfs: -60, speaking: false, clippedRecently: false }), 'IDLE');
  assert.equal(classifyLevel({ rmsDbfs: 0, peakDbfs: 0, speaking: false, clippedRecently: false }), 'IDLE');
});

test('level classification: CLIPPING when peak crosses -0.5dBFS or a recent clip was seen', () => {
  assert.equal(classifyLevel({ rmsDbfs: -10, peakDbfs: -0.4, speaking: true, clippedRecently: false }), 'CLIPPING');
  assert.equal(classifyLevel({ rmsDbfs: -10, peakDbfs: -10, speaking: true, clippedRecently: true }), 'CLIPPING');
});

test('level classification: HIGH above -8dBFS RMS', () => {
  assert.equal(classifyLevel({ rmsDbfs: -7, peakDbfs: -7, speaking: true, clippedRecently: false }), 'HIGH');
});

test('level classification: GOOD within [-24, -8]', () => {
  assert.equal(classifyLevel({ rmsDbfs: -8, peakDbfs: -8, speaking: true, clippedRecently: false }), 'GOOD');
  assert.equal(classifyLevel({ rmsDbfs: -24, peakDbfs: -24, speaking: true, clippedRecently: false }), 'GOOD');
  assert.equal(classifyLevel({ rmsDbfs: -15, peakDbfs: -15, speaking: true, clippedRecently: false }), 'GOOD');
});

test('level classification: LOW below -24dBFS', () => {
  assert.equal(classifyLevel({ rmsDbfs: -25, peakDbfs: -25, speaking: true, clippedRecently: false }), 'LOW');
});

// --- createAudioConditioner: connect/update/readLevels/close --------------

function makeFakeAudioParam(initial = 1) {
  return {
    value: initial,
    setTargetAtTime(target) {
      this.value = target;
    }
  };
}

function makeFakeCompressorNode() {
  return {
    threshold: makeFakeAudioParam(-24),
    knee: makeFakeAudioParam(30),
    ratio: makeFakeAudioParam(12),
    attack: makeFakeAudioParam(0.003),
    release: makeFakeAudioParam(0.25),
    connect() {},
    disconnect() {}
  };
}

function makeFakeContext({ withDestination = true, withSource = true } = {}) {
  const nodes = { biquad: null, gain: null, analyser: null, compressors: [] };
  const ctx = {
    currentTime: 0,
    createMediaStreamSource: withSource
      ? () => ({ connect() {}, disconnect() {} })
      : undefined,
    createBiquadFilter: () => {
      const node = { type: '', frequency: makeFakeAudioParam(80), connect() {}, disconnect() {} };
      nodes.biquad = node;
      return node;
    },
    createGain: () => {
      const node = { gain: makeFakeAudioParam(1), connect() {}, disconnect() {} };
      nodes.gain = node;
      return node;
    },
    createAnalyser: () => {
      const node = {
        fftSize: 2048,
        connect() {},
        disconnect() {},
        getFloatTimeDomainData(buffer) {
          buffer.fill(0); // silence by default; tests override via a custom analyser fill fn
        }
      };
      nodes.analyser = node;
      return node;
    },
    createDynamicsCompressor: () => {
      const node = makeFakeCompressorNode();
      nodes.compressors.push(node);
      return node;
    },
    createMediaStreamDestination: withDestination
      ? () => ({ stream: { id: 'conditioned-stream' }, connect() {}, disconnect() {} })
      : undefined,
    close() {},
    _nodes: nodes
  };
  return ctx;
}

test('connect returns the raw stream unchanged by default (audioConditioningEnabled unset -- the shipped default)', () => {
  const rawStream = { id: 'raw' };
  const conditioner = createAudioConditioner({
    audioContextFactory: () => makeFakeContext(),
    settings: {},
    now: () => 0
  });
  const result = conditioner.connect(rawStream);
  assert.equal(result, rawStream);
  assert.doesNotThrow(() => conditioner.readLevels());
  conditioner.close();
});

test('connect returns the raw stream unchanged when audioConditioningEnabled is explicitly false (real bypass)', () => {
  const rawStream = { id: 'raw' };
  const conditioner = createAudioConditioner({
    audioContextFactory: () => makeFakeContext(),
    settings: { audioConditioningEnabled: false },
    now: () => 0
  });
  const result = conditioner.connect(rawStream);
  assert.equal(result, rawStream);
  assert.doesNotThrow(() => conditioner.readLevels());
  conditioner.close();
});

test('connect returns the raw stream when no AudioContext factory is available', () => {
  const rawStream = { id: 'raw' };
  const conditioner = createAudioConditioner({
    audioContextFactory: undefined,
    settings: { audioConditioningEnabled: true },
    now: () => 0
  });
  const result = conditioner.connect(rawStream);
  assert.equal(result, rawStream);
});

test('connect returns the raw stream when AudioContext construction throws', () => {
  const rawStream = { id: 'raw' };
  const conditioner = createAudioConditioner({
    audioContextFactory: () => { throw new Error('not allowed'); },
    settings: { audioConditioningEnabled: true },
    now: () => 0
  });
  const result = conditioner.connect(rawStream);
  assert.equal(result, rawStream);
});

test('connect returns the raw stream when MediaStreamAudioDestinationNode is unavailable', () => {
  const rawStream = { id: 'raw' };
  const conditioner = createAudioConditioner({
    audioContextFactory: () => makeFakeContext({ withDestination: false }),
    settings: { audioConditioningEnabled: true },
    now: () => 0
  });
  const result = conditioner.connect(rawStream);
  assert.equal(result, rawStream);
});

test('connect builds the graph and returns the conditioned destination stream when conditioning is enabled and everything is available', () => {
  const rawStream = { id: 'raw' };
  const conditioner = createAudioConditioner({
    audioContextFactory: () => makeFakeContext(),
    settings: { audioConditioningEnabled: true, audioProcessingPreset: 'normal' },
    now: () => 0
  });
  const result = conditioner.connect(rawStream);
  assert.notEqual(result, rawStream);
  assert.equal(result.id, 'conditioned-stream');
  conditioner.close();
});

test('update() re-tunes live without needing a new connect() call, and never throws when bypassed', () => {
  const rawStream = { id: 'raw' };
  const conditioner = createAudioConditioner({
    audioContextFactory: () => makeFakeContext(),
    settings: { audioConditioningEnabled: true, audioProcessingPreset: 'gentle' },
    now: () => 0
  });
  conditioner.connect(rawStream);
  assert.doesNotThrow(() => conditioner.update({ audioProcessingPreset: 'normal', audioHighPassHz: 120 }));
  conditioner.close();

  const bypassConditioner = createAudioConditioner({
    audioContextFactory: () => makeFakeContext(),
    settings: { audioConditioningEnabled: false },
    now: () => 0
  });
  bypassConditioner.connect(rawStream);
  assert.doesNotThrow(() => bypassConditioner.update({ audioProcessingPreset: 'normal' }));
});

test('measurement loop: a fully silent signal reads IDLE, never LOW, after a real tick', async () => {
  const ctx = makeFakeContext();
  const conditioner = createAudioConditioner({
    audioContextFactory: () => ctx,
    settings: { audioConditioningEnabled: true, audioProcessingPreset: 'gentle' },
    now: () => Date.now(),
    onDiagnostics: () => {}
  });
  conditioner.connect({ id: 'raw' });
  await new Promise((resolve) => setTimeout(resolve, 80)); // let one ~50ms measurement tick fire
  const levels = conditioner.readLevels();
  assert.equal(levels.classification, 'IDLE');
  assert.equal(levels.speaking, false);
  conditioner.close();
});

test('measurement loop: a near-full-scale signal registers a clip and CLIPPING classification', async () => {
  const ctx = makeFakeContext();
  ctx.createAnalyser = () => ({
    fftSize: 2048,
    connect() {},
    disconnect() {},
    getFloatTimeDomainData(buffer) {
      buffer.fill(0.98); // above the -0.5dBFS clip threshold (~0.944)
    }
  });
  const conditioner = createAudioConditioner({
    audioContextFactory: () => ctx,
    settings: { audioConditioningEnabled: true, audioProcessingPreset: 'gentle' },
    now: () => Date.now(),
    onDiagnostics: () => {}
  });
  conditioner.connect({ id: 'raw' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const levels = conditioner.readLevels();
  assert.equal(levels.classification, 'CLIPPING');
  assert.ok(levels.clipCount >= 1);
  conditioner.close();
});

test('close() tears down without throwing even if it was never connected', () => {
  const conditioner = createAudioConditioner({ audioContextFactory: () => makeFakeContext(), settings: {}, now: () => 0 });
  assert.doesNotThrow(() => conditioner.close());
});

// --- createMicProbe: independent pre-meeting level test -------------------

function makeFakeProbeStream(trackedStops) {
  return {
    getTracks: () => [{ stop: () => trackedStops.push(true) }]
  };
}

function makeFakeProbeContext({ fill = 0 } = {}) {
  return {
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createAnalyser: () => ({
      fftSize: 2048,
      connect() {},
      disconnect() {},
      getFloatTimeDomainData(buffer) {
        buffer.fill(fill);
      }
    }),
    close() {}
  };
}

test('createMicProbe.start() opens getUserMedia with the deviceId constraint merged in and reports ok', async () => {
  let capturedConstraints = null;
  const probe = createMicProbe({
    deviceId: 'mic-7',
    getUserMediaImpl: async (constraints) => {
      capturedConstraints = constraints;
      return makeFakeProbeStream([]);
    },
    audioContextImpl: () => makeFakeProbeContext()
  });

  const result = await probe.start();
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(capturedConstraints, { audio: { deviceId: { exact: 'mic-7' } } });
  probe.stop();
});

test('createMicProbe.start() never throws on getUserMedia failure, returning ok:false with the error message', async () => {
  const probe = createMicProbe({
    getUserMediaImpl: async () => {
      throw new Error('Permission denied');
    }
  });
  const result = await probe.start();
  assert.equal(result.ok, false);
  assert.match(result.error, /Permission denied/);
});

test('createMicProbe.readLevels() returns null before start() and after stop()', async () => {
  const probe = createMicProbe({
    getUserMediaImpl: async () => makeFakeProbeStream([]),
    audioContextImpl: () => makeFakeProbeContext()
  });
  assert.equal(probe.readLevels(), null, 'never started');

  await probe.start();
  assert.notEqual(probe.readLevels(), null, 'started');

  probe.stop();
  assert.equal(probe.readLevels(), null, 'after stop');
});

test('createMicProbe.readLevels() shape matches the conditioner readLevels() shape, with gain_db always 0', async () => {
  const probe = createMicProbe({
    getUserMediaImpl: async () => makeFakeProbeStream([]),
    audioContextImpl: () => makeFakeProbeContext({ fill: 0.5 })
  });
  await probe.start();
  const levels = probe.readLevels();
  assert.equal(levels.gain_db, 0);
  assert.ok(Number.isFinite(levels.rms_dbfs));
  assert.ok(Number.isFinite(levels.peak_dbfs));
  assert.equal(typeof levels.classification, 'string');
  assert.equal(typeof levels.speaking, 'boolean');
  probe.stop();
});

test('createMicProbe.stop() releases every mic track and is idempotent', async () => {
  const stops = [];
  const probe = createMicProbe({
    getUserMediaImpl: async () => makeFakeProbeStream(stops),
    audioContextImpl: () => makeFakeProbeContext()
  });
  await probe.start();
  probe.stop();
  assert.equal(stops.length, 1);
  assert.doesNotThrow(() => probe.stop()); // idempotent, never throws on a second stop
  assert.equal(stops.length, 1, 'stop() a second time must not re-stop or double-count tracks');
});

test('createMicProbe.stop() never throws even if it was never started', () => {
  const probe = createMicProbe();
  assert.doesNotThrow(() => probe.stop());
});
