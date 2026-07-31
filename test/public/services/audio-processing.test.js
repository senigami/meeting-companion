import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAudioConditioner,
  createMicProbe as createMicProbeReal,
  computeNextGainDb,
  classifyLevel,
  presetParams,
  dbToLinear,
  percentileDbfs,
  computeNoiseGate,
  NOISE_FLOOR_DBFS,
  AMBIENT_SAMPLE_COUNT,
  NOISE_GATE_MARGIN_DB,
  chunkContainsSpeech
} from '../../../public/services/audio-processing.js';

// Every existing test in this file predates ambient calibration and never intended to pay for its
// real ~1.5s sampling window (30 samples * 50ms) -- createMicProbe() defaults to a real setTimeout
// there. A no-op delayImpl keeps calibration's actual logic under test (via the dedicated
// calibration tests below, which inject their own synthetic timing) without making every other
// mic-probe test in this file take 1.5s apiece.
function createMicProbe(options = {}) {
  return createMicProbeReal({ delayImpl: () => Promise.resolve(), ...options });
}

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

function makeFakeProbeStream(trackedStops, trackSettings = { autoGainControl: true, noiseSuppression: false, echoCancellation: false }) {
  return {
    getTracks: () => [{ stop: () => trackedStops.push(true) }],
    getAudioTracks: () => [{ getSettings: () => trackSettings }]
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
  assert.equal(result.ok, true);
  assert.deepEqual(capturedConstraints, {
    audio: {
      autoGainControl: true,
      noiseSuppression: false,
      echoCancellation: false,
      deviceId: { exact: 'mic-7' }
    }
  });
  probe.stop();
});

test('createMicProbe.start() requests the SAME browser constraint triple as the transcription path, driven by audioSettings', async () => {
  let capturedConstraints = null;
  const probe = createMicProbe({
    audioSettings: { audioBrowserAgc: false, audioBrowserNoiseSuppression: true, audioBrowserEchoCancel: true },
    getUserMediaImpl: async (constraints) => {
      capturedConstraints = constraints;
      return makeFakeProbeStream([]);
    },
    audioContextImpl: () => makeFakeProbeContext()
  });

  await probe.start();
  assert.deepEqual(capturedConstraints.audio, {
    autoGainControl: false,
    noiseSuppression: true,
    echoCancellation: true
  });
  probe.stop();
});

test('createMicProbe.start() reads back the constraints Chrome actually granted via track.getSettings()', async () => {
  const granted = { autoGainControl: true, noiseSuppression: false, echoCancellation: false };
  const probe = createMicProbe({
    getUserMediaImpl: async () => makeFakeProbeStream([], granted),
    audioContextImpl: () => makeFakeProbeContext()
  });
  const result = await probe.start();
  assert.deepEqual(result.grantedConstraints, granted);
  assert.deepEqual(probe.getGrantedConstraints(), granted);
  probe.stop();
  assert.equal(probe.getGrantedConstraints(), null, 'cleared on stop');
});

test('createMicProbe.start() falls back to the unconstrained default when a constrained request is refused (OverconstrainedError)', async () => {
  let calls = 0;
  const probe = createMicProbe({
    deviceId: 'stale-device',
    getUserMediaImpl: async (constraints) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('Overconstrained');
        error.name = 'OverconstrainedError';
        throw error;
      }
      // Fallback request must drop the deviceId constraint but keep the browser constraints.
      assert.deepEqual(constraints.audio, {
        autoGainControl: true,
        noiseSuppression: false,
        echoCancellation: false
      });
      return makeFakeProbeStream([]);
    },
    audioContextImpl: () => makeFakeProbeContext()
  });

  const result = await probe.start();
  assert.equal(result.ok, true);
  assert.equal(calls, 2, 'retried once against the unconstrained default');
  probe.stop();
});

test('createMicProbe.start() still returns ok:false (never throws) if both the constrained request and the fallback fail', async () => {
  const probe = createMicProbe({
    deviceId: 'stale-device',
    getUserMediaImpl: async () => {
      const error = new Error('gone');
      error.name = 'NotFoundError';
      throw error;
    }
  });
  const result = await probe.start();
  assert.equal(result.ok, false);
  assert.match(result.error, /gone/);
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

// --- Ambient calibration (backlog #7/#10) ----------------------------------

function dbfsToLinear(db) {
  return 10 ** (db / 20);
}

test('percentileDbfs takes the 90th percentile, not the mean or max -- a single loud outlier does not move it', () => {
  const samples = new Array(29).fill(-30).concat([0]); // 29 quiet ticks, one door-slam spike
  assert.equal(percentileDbfs(samples, 0.9), -30, 'the rare spike must not drag the floor up');
});

test('percentileDbfs ignores non-finite samples and returns -Infinity when nothing measured', () => {
  assert.equal(percentileDbfs([]), -Infinity);
  assert.equal(percentileDbfs([-Infinity, NaN]), -Infinity);
});

test('computeNoiseGate adds the fixed margin above ambient when there is room for a LOW band', () => {
  const { gateDbfs, tooNoisy } = computeNoiseGate(-40);
  assert.equal(gateDbfs, -40 + NOISE_GATE_MARGIN_DB);
  assert.equal(tooNoisy, false);
});

test('computeNoiseGate refuses to gate (tooNoisy) when the margin would erase the LOW band -- never fudges into the gap', () => {
  // Steve's measured built-in mic: ambient ~-30dBFS, GOOD starts at -24, leaving exactly the
  // documented ~6dB of headroom the margin consumes entirely.
  const result = computeNoiseGate(-30);
  assert.equal(result.tooNoisy, true);
  assert.equal(result.gateDbfs, null, 'a too-noisy verdict must never hand back a usable gate');
});

test('computeNoiseGate on an uncalibrated (non-finite) floor reports neither a gate nor tooNoisy -- caller falls back to the default', () => {
  assert.deepEqual(computeNoiseGate(-Infinity), { gateDbfs: null, tooNoisy: false });
  assert.deepEqual(computeNoiseGate(NaN), { gateDbfs: null, tooNoisy: false });
});

// --- chunkContainsSpeech: silence gate (issue #23) -------------------------

test('chunkContainsSpeech: pure silence never clears the gate', () => {
  const samples = new Float32Array(1600); // 100ms at 16kHz, all zeros
  assert.equal(chunkContainsSpeech(samples, { gateDbfs: -50, sampleRate: 16000 }), false);
});

test('chunkContainsSpeech: a constant loud signal clears the gate', () => {
  const samples = new Float32Array(1600).fill(0.5);
  assert.equal(chunkContainsSpeech(samples, { gateDbfs: -50, sampleRate: 16000 }), true);
});

test('chunkContainsSpeech: finds a burst of speech buried in mostly-silent audio -- this is the regression whole-chunk RMS averaging would fail, since a 200ms burst inside 3.5s is too quiet on average to clear a -50dBFS gate even though real speech is present', () => {
  const sampleRate = 16000;
  const totalSamples = Math.round(3.5 * sampleRate);
  const samples = new Float32Array(totalSamples); // starts all zero (silence)
  const burstStart = Math.round(1.5 * sampleRate);
  const burstLength = Math.round(0.2 * sampleRate);
  for (let i = burstStart; i < burstStart + burstLength; i += 1) {
    // Amplitude is deliberately 0.01, not something loud. It has to be quiet enough that the
    // WHOLE-CHUNK average fails the gate while the burst's own frame clears it, or this test
    // passes under whole-chunk RMS too and pins nothing. Measured: whole chunk -52.43 dBFS
    // (below the -50 gate), burst frame -40.00 dBFS (above it).
    samples[i] = 0.01;
  }
  assert.equal(chunkContainsSpeech(samples, { gateDbfs: -50, sampleRate }), true);

  // And the other half of the claim, asserted rather than described: the SAME buffer is rejected
  // when one frame spans the whole chunk, which is what whole-chunk RMS averaging amounts to. If
  // frame-wise detection is ever lost, this line fails instead of the test quietly still passing.
  assert.equal(chunkContainsSpeech(samples, { gateDbfs: -50, sampleRate, frameMs: 3500 }), false);
});

test('chunkContainsSpeech: fails open (true) on a non-finite gate rather than silently muting the reader', () => {
  const samples = new Float32Array(1600);
  assert.equal(chunkContainsSpeech(samples, { gateDbfs: NaN, sampleRate: 16000 }), true);
  assert.equal(chunkContainsSpeech(samples, { gateDbfs: undefined, sampleRate: 16000 }), true);
});

test('chunkContainsSpeech: empty or absent samples never contain speech', () => {
  assert.equal(chunkContainsSpeech(new Float32Array(0), { gateDbfs: -50, sampleRate: 16000 }), false);
  assert.equal(chunkContainsSpeech(undefined, { gateDbfs: -50, sampleRate: 16000 }), false);
});

test('createMicProbe.start() calibrates against a constant quiet ambient (headset-like) and readLevels uses the calibrated gate, not the fallback', async () => {
  const probe = createMicProbe({
    getUserMediaImpl: async () => makeFakeProbeStream([]),
    audioContextImpl: () => makeFakeProbeContext({ fill: dbfsToLinear(-60) })
  });
  const result = await probe.start();
  assert.equal(result.ok, true);
  assert.equal(result.calibration.tooNoisy, false);
  assert.ok(Math.abs(result.calibration.ambientFloorDbfs - -60) < 1e-6);
  assert.ok(Math.abs(result.calibration.gateDbfs - (-60 + NOISE_GATE_MARGIN_DB)) < 1e-6);
  assert.equal(result.calibration.sampleCount, AMBIENT_SAMPLE_COUNT);
  assert.deepEqual(probe.getCalibration(), result.calibration);

  // -60 ambient never crosses -54 (the calibrated gate); a genuinely silent room must still read
  // as not-speaking, i.e. the calibration is actually being applied, not just measured and ignored.
  assert.equal(probe.readLevels().speaking, false);
  probe.stop();
  assert.equal(probe.getCalibration(), null, 'cleared on stop, same as grantedConstraints');
});

test('createMicProbe.start() records the granted track\'s real deviceId onto the calibration as resolvedDeviceId', async () => {
  // Sign-off blocker (2026-07-30): isMicCalibrationValid can only detect a system-default
  // calibration going stale if the calibration itself records what device '' actually resolved to
  // at measurement time. This pins that the real id (from track.getSettings(), already read into
  // grantedConstraints) flows through onto the stored calibration object.
  const probe = createMicProbe({
    getUserMediaImpl: async () => makeFakeProbeStream([], { deviceId: 'headset-real-id', autoGainControl: true, noiseSuppression: false, echoCancellation: false }),
    audioContextImpl: () => makeFakeProbeContext({ fill: dbfsToLinear(-60) })
  });
  const result = await probe.start();
  assert.equal(result.ok, true);
  assert.equal(result.calibration.resolvedDeviceId, 'headset-real-id');
});

test('createMicProbe.start() reports tooNoisy for a device whose ambient leaves no room for a LOW band, and readLevels falls back to the fixed default gate', async () => {
  const probe = createMicProbe({
    getUserMediaImpl: async () => makeFakeProbeStream([]),
    audioContextImpl: () => makeFakeProbeContext({ fill: dbfsToLinear(-30) })
  });
  const result = await probe.start();
  assert.equal(result.ok, true);
  assert.equal(result.calibration.tooNoisy, true);
  assert.equal(result.calibration.gateDbfs, null);

  // -30 is above NOISE_FLOOR_DBFS (-50), the fallback default, so with no valid calibrated gate the
  // probe must still fall back to the default rather than block or crash -- speaking reads true off
  // the fixed floor, which is exactly the mis-classification the too-noisy verdict exists to warn
  // about in the UI (Steve's ruling: say so, don't silently paper over it).
  assert.equal(probe.readLevels().speaking, true);
  probe.stop();
});

test('createMicProbe.start() falls back cleanly (no calibration) when ambient sampling never produced a finite reading', async () => {
  const probe = createMicProbe({
    getUserMediaImpl: async () => makeFakeProbeStream([]),
    audioContextImpl: () => makeFakeProbeContext({ fill: 0 }) // rms 0 -> -Infinity, filtered out
  });
  const result = await probe.start();
  assert.equal(result.ok, true);
  assert.equal(result.calibration.ambientFloorDbfs, -Infinity);
  assert.equal(result.calibration.gateDbfs, null);
  assert.equal(result.calibration.tooNoisy, false);
  probe.stop();
});

test('createMicProbe.start() still resolves (never hangs) if stop() is called mid-calibration', async () => {
  let resolveDelay;
  const probe = createMicProbeReal({
    getUserMediaImpl: async () => makeFakeProbeStream([]),
    audioContextImpl: () => makeFakeProbeContext({ fill: dbfsToLinear(-40) }),
    delayImpl: () => new Promise((resolve) => { resolveDelay = resolve; })
  });
  const startPromise = probe.start();
  // Let the first calibration tick run, then stop mid-loop before the delay ever resolves.
  await Promise.resolve();
  probe.stop();
  resolveDelay?.();
  const result = await startPromise;
  assert.equal(result.ok, false);
});

test('createAudioConditioner honors a per-device calibrated noiseFloorDbfs over the fixed default', async () => {
  const ctx = makeFakeContext();
  ctx.createAnalyser = () => ({
    fftSize: 2048,
    connect() {},
    disconnect() {},
    getFloatTimeDomainData(buffer) {
      buffer.fill(dbfsToLinear(-35));
    }
  });
  const conditioner = createAudioConditioner({
    audioContextFactory: () => ctx,
    settings: { audioConditioningEnabled: true, audioProcessingPreset: 'gentle', noiseFloorDbfs: -30 },
    now: () => Date.now(),
    onDiagnostics: () => {}
  });
  conditioner.connect({ id: 'raw' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  // -35 is below the calibrated gate of -30, so this must read as NOT speaking even though it is
  // well above the fixed default floor (-50) that would call it speech.
  assert.equal(conditioner.readLevels().speaking, false);
  conditioner.close();
});
