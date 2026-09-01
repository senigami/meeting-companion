// Real-time microphone conditioning for the OpenAI transcription path only (the browser
// SpeechRecognition path opens the microphone itself and accepts no audio input -- see
// docs/08-audio-conditioning.md). Owns the Web Audio graph, level analysis, AGC state,
// presets, and diagnostics. The transcription driver hands us a raw MediaStream and gets back
// either a conditioned MediaStream or, on any failure/bypass, the same raw stream untouched.
//
// No audio or diagnostics are ever written to disk or sent over the network here (ADR-0003 /
// INV-8 / INV-12) -- everything in this module is in-memory only, for the lifetime of the call.

import { deviceIdConstraint, browserAudioConstraints } from './audio-monitor.js';

export const AUDIO_PROCESSING_PRESETS = ['off', 'gentle', 'normal'];

// Silence must never drive gain upward -- this is the single most important AGC rule. We
// implement the gate by freezing the gain entirely (no movement either direction) whenever
// measured RMS is at or below the noise floor, which also satisfies "adapt across speakers, not
// across syllables" since a mid-sentence pause below the floor just holds the last gain.
export const NOISE_FLOOR_DBFS = -50;

// Per-device ambient calibration (backlog #7/#10). NOISE_FLOOR_DBFS above is only the fallback for
// a device that has never been calibrated -- a fixed floor either gates out real speech (a headset
// whose ambient sits near silence) or lets the room itself read as speech (a laptop mic with noise
// suppression off, which is what the real capture path requests -- see transcription/openai.js).
// AMBIENT_SAMPLE_COUNT * AMBIENT_SAMPLE_INTERVAL_MS = ~1.5s, long enough to average past a single
// cough or door slam without making the mic test feel stuck.
export const AMBIENT_SAMPLE_COUNT = 30;
export const AMBIENT_SAMPLE_INTERVAL_MS = 50;
// A high percentile, not the max: it keeps the steady top of what this room's ambient noise
// actually does, while a single rare loud outlier (the door slam) falls above enough samples to
// not move it. A mean would let that same outlier drag the floor up by exactly the amount the
// percentile is designed to reject.
export const AMBIENT_PERCENTILE = 0.9;
// 6dB of headroom above measured ambient before something counts as speech. Chosen as the smallest
// margin that reliably survives normal ambient variance without spurious triggering; it is also,
// deliberately, the exact number that makes a device with only ~6dB of headroom between its ambient
// floor and GOOD (Steve's measured built-in mic) land on the too-noisy verdict below rather than
// silently getting a gate wedged into the gap.
export const NOISE_GATE_MARGIN_DB = 6;
// Must match classifyLevel's GOOD/LOW boundary below -- this is the ceiling a calibrated gate is
// checked against.
export const GOOD_FLOOR_DBFS = -24;
// A LOW ("Too quiet") band narrower than this is not a real reading an operator could act on, just
// noise in the measurement; treat it as no usable band at all.
export const MIN_LOW_BAND_DB = 4;

const PRESETS = {
  off: {
    targetRmsDbfs: -18,
    maxBoostDb: 0,
    maxCutDb: 0,
    timeConstantSeconds: 1.5,
    adapt: false,
    compressor: { threshold: -18, ratio: 1, knee: 12, attack: 0.005, release: 0.25 }
  },
  gentle: {
    targetRmsDbfs: -18,
    maxBoostDb: 9,
    maxCutDb: -12,
    timeConstantSeconds: 1.5,
    adapt: true,
    compressor: { threshold: -18, ratio: 2, knee: 12, attack: 0.005, release: 0.25 }
  },
  normal: {
    targetRmsDbfs: -15,
    maxBoostDb: 12,
    maxCutDb: -12,
    timeConstantSeconds: 0.6,
    adapt: true,
    compressor: { threshold: -16, ratio: 3, knee: 6, attack: 0.003, release: 0.15 }
  }
};

const LIMITER_PARAMS = { threshold: -3, ratio: 20, knee: 0, attack: 0.001, release: 0.05 };

// Sustained-condition thresholds (issue #5). The 500ms-throttled `diagnostic()` messages above are
// one-shot/console-only by design (INV-10) -- a recurring clip or dropout needs its own duration-based
// gate rather than another prose message, or it either spams the rail every 500ms or never reaches it
// at all. Clipping is unambiguous evidence of signal damage happening right now (it cannot occur
// during real silence), so it earns a short fuse: 5s of continuous clipping is well past a single loud
// word or door slam and is aggressive enough that the operator still has time to act on it live.
export const CLIPPING_SUSTAINED_MS = 5000;
// A sustained reading below the calibrated noise floor is the same physical event the silence
// watchdog (runtime.js's SILENCE_WATCHDOG_MS) already guards against from the transcript side, and
// it carries the identical false-positive risk Steve ruled on there: this room's long sermon pauses
// and reflective silence during prayer are entirely normal and must never read as a fault. Reusing
// the exact same 45s figure (not importing it -- this module has no dependency on the controller)
// keeps the two instruments from ever disagreeing about how long is too long.
export const QUIET_SUSTAINED_MS = 45000;

// A neutral compressor -- threshold 0dB, ratio 1:1 -- passes signal through unchanged, used when
// a stage is individually disabled but the fixed graph stays wired (live re-tune must never
// rebuild the graph or touch the mic; see brief's "Live re-tune vs mic reacquisition").
const NEUTRAL_COMPRESSOR = { threshold: 0, ratio: 1, knee: 0, attack: 0.005, release: 0.25 };
const MEASUREMENT_INTERVAL_MS = 50;
const CLIP_WINDOW_MS = 2000;
const CLIP_LINEAR_THRESHOLD = 10 ** (-0.5 / 20); // -0.5 dBFS

export function presetParams(name) {
  return PRESETS[name] || PRESETS.gentle;
}

export function dbToLinear(db) {
  return 10 ** (db / 20);
}

export function linearToDb(linear) {
  if (!Number.isFinite(linear) || linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

// Pure, timer-free core of the AGC: given a measured RMS and the currently-held gain, decides
// the next gain. Exported standalone so the speech gate and clamping can be tested without any
// Web Audio mocking at all.
export function computeNextGainDb({
  rmsDbfs,
  currentGainDb = 0,
  preset,
  elapsedMs = MEASUREMENT_INTERVAL_MS,
  noiseFloorDbfs = NOISE_FLOOR_DBFS
}) {
  const config = typeof preset === 'string' ? presetParams(preset) : preset || PRESETS.gentle;
  if (!config.adapt) return 0;

  const speaking = rmsDbfs > noiseFloorDbfs;
  if (!speaking) return currentGainDb; // speech gate: silence never moves gain, in either direction

  const desiredGainDb = config.targetRmsDbfs - rmsDbfs;
  const clampedDesired = Math.min(config.maxBoostDb, Math.max(config.maxCutDb, desiredGainDb));

  const timeConstant = Math.max(0.001, config.timeConstantSeconds);
  const elapsedSeconds = Math.max(0, elapsedMs) / 1000;
  const alpha = 1 - Math.exp(-elapsedSeconds / timeConstant);
  const nextGainDb = currentGainDb + (clampedDesired - currentGainDb) * alpha;

  return Math.min(config.maxBoostDb, Math.max(config.maxCutDb, nextGainDb));
}

// Robust "typical ambient" estimate from a window of measured RMS samples. Pure and timer-free so
// it can be tested without any real sampling delay.
export function percentileDbfs(samples, percentile = AMBIENT_PERCENTILE) {
  const finite = (samples || []).filter((value) => Number.isFinite(value));
  if (!finite.length) return -Infinity;
  const sorted = [...finite].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * percentile)));
  return sorted[index];
}

// Turns a measured ambient floor into a gate, or an honest refusal to gate at all. Never fudges the
// threshold into the gap between ambient and GOOD -- see MIN_LOW_BAND_DB above and Steve's ruling
// in the backlog: a mic check that says "this microphone is too noisy in this room" is a better
// product than one that silently raises the gate to look healthy.
export function computeNoiseGate(ambientFloorDbfs, {
  marginDb = NOISE_GATE_MARGIN_DB,
  goodFloorDbfs = GOOD_FLOOR_DBFS,
  minLowBandDb = MIN_LOW_BAND_DB
} = {}) {
  if (!Number.isFinite(ambientFloorDbfs)) return { gateDbfs: null, tooNoisy: false };
  const gateDbfs = ambientFloorDbfs + marginDb;
  const tooNoisy = gateDbfs >= goodFloorDbfs - minLowBandDb;
  return { gateDbfs: tooNoisy ? null : gateDbfs, tooNoisy };
}

export function classifyLevel({ rmsDbfs, peakDbfs, speaking, clippedRecently }) {
  if (!speaking) return 'IDLE'; // silence is not a fault; the meter must not read LOW
  if (clippedRecently || peakDbfs >= -0.5) return 'CLIPPING';
  if (rmsDbfs > -8) return 'HIGH';
  if (rmsDbfs >= -24) return 'GOOD';
  return 'LOW';
}

export function rmsAndPeakDbfs(samples) {
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
    sumSquares += value * value;
  }
  const rms = samples.length ? Math.sqrt(sumSquares / samples.length) : 0;
  return { rmsDbfs: linearToDb(rms), peakDbfs: linearToDb(peak), peakLinear: peak };
}

export const SPEECH_FRAME_MS = 100;

// Frame-wise speech detection, not whole-chunk RMS (issue #23): a chunk-long average can hide a
// burst of real speech inside several seconds of silence, and the transcription model invents
// text from that silence when the chunk is sent anyway. Splitting into short frames and asking
// "did ANY frame clear the gate" catches speech wherever it sits in the chunk.
export function chunkContainsSpeech(samples, { gateDbfs, sampleRate, frameMs = SPEECH_FRAME_MS } = {}) {
  if (!samples || !samples.length) return false;
  // A programming error here (a bad gate or sample rate) must never silently mute a Deaf reader's
  // only channel, so fail OPEN and let the chunk through. A fabricated card from bad audio is
  // caught by the gate policy at the caller; muted audio is undetectable to the reader.
  if (!Number.isFinite(gateDbfs) || !Number.isFinite(sampleRate) || sampleRate <= 0) return true;

  const frameLength = Math.round((frameMs / 1000) * sampleRate);
  if (!(frameLength > 0)) return true;

  for (let start = 0; start < samples.length; start += frameLength) {
    const end = Math.min(start + frameLength, samples.length);
    const frame = samples.subarray ? samples.subarray(start, end) : samples.slice(start, end);
    if (rmsAndPeakDbfs(frame).rmsDbfs > gateDbfs) return true;
  }
  return false;
}

function clampHighPassHz(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 80;
  return Math.min(150, Math.max(50, numeric));
}

function applyCompressorParams(node, params) {
  const target = params || NEUTRAL_COMPRESSOR;
  try {
    if (node.threshold) node.threshold.value = target.threshold;
    if (node.knee) node.knee.value = target.knee;
    if (node.ratio) node.ratio.value = target.ratio;
    if (node.attack) node.attack.value = target.attack;
    if (node.release) node.release.value = target.release;
  } catch {
    // Some fakes/older implementations expose read-only AudioParams; conditioning degrades
    // gracefully to whatever the node's constructor defaults already were.
  }
}

export function createAudioConditioner({
  audioContextFactory,
  settings = {},
  now = () => Date.now(),
  onDiagnostics = () => {},
  // Fires once when a tracked condition ({ condition: 'clipping' | 'quiet', active: true }) crosses
  // its sustained threshold, and once more ({ active: false }) the instant it clears -- never on
  // every measurement tick in between, so a caller can drive a single rail message that starts and
  // stops with the condition instead of re-deciding it every 50ms. See CLIPPING_SUSTAINED_MS /
  // QUIET_SUSTAINED_MS above for why the two conditions get different fuses.
  onSustainedCondition = () => {}
} = {}) {
  let currentSettings = { ...settings };
  let ctx = null;
  let rawStream = null;
  let bypassed = true;
  let sourceNode = null;
  let highpassNode = null;
  let agcGainNode = null;
  let analyserNode = null;
  let compressorNode = null;
  let limiterNode = null;
  let destinationNode = null;
  let analyserBuffer = null;
  let measureTimer = null;
  let lastTickAt = null;
  let lastDiagnosticAt = 0;

  let gainDb = 0;
  let levels = {
    rms_dbfs: -Infinity,
    peak_dbfs: -Infinity,
    gain_db: 0,
    clipCount: 0,
    classification: 'IDLE',
    speaking: false
  };
  let lastClipAt = -Infinity;
  // One entry per tracked condition; `since` is the tick timestamp the condition first became true
  // (null while it is false), `active` is whether it has already crossed its threshold and fired.
  const sustained = {
    clipping: { since: null, active: false },
    quiet: { since: null, active: false }
  };

  function trackSustainedCondition(key, conditionNow, nowMs, thresholdMs) {
    const entry = sustained[key];
    if (!conditionNow) {
      entry.since = null;
      if (entry.active) {
        entry.active = false;
        emitSustainedCondition(key, false, nowMs);
      }
      return;
    }
    if (entry.since == null) entry.since = nowMs;
    if (!entry.active && nowMs - entry.since >= thresholdMs) {
      entry.active = true;
      emitSustainedCondition(key, true, nowMs);
    }
  }

  function emitSustainedCondition(condition, active, atMs) {
    try {
      onSustainedCondition({ condition, active, at: atMs });
    } catch {
      // Sustained-condition reporting must never take down conditioning or capture.
    }
  }

  function diagnostic(message) {
    const nowMs = now();
    if (nowMs - lastDiagnosticAt < 500 && lastDiagnosticAt !== 0) return; // throttle
    lastDiagnosticAt = nowMs;
    try {
      onDiagnostics({ message, at: nowMs });
    } catch {
      // Diagnostics must never take down conditioning or capture.
    }
  }

  function currentPreset() {
    return presetParams(currentSettings.audioProcessingPreset || 'gentle');
  }

  // Per-device calibrated gate (runtime.js reads it back from localStorage and passes it in as
  // settings.noiseFloorDbfs); falls back to the fixed default for any device never calibrated, or
  // whose calibration came back "too noisy" (computeNoiseGate returns gateDbfs: null there on
  // purpose -- never wedge a gate into a gap that doesn't have room for one).
  function effectiveNoiseFloorDbfs() {
    return Number.isFinite(currentSettings.noiseFloorDbfs) ? currentSettings.noiseFloorDbfs : NOISE_FLOOR_DBFS;
  }

  function retuneNodes() {
    if (!ctx) return;
    const preset = currentPreset();
    const highpassHz = currentSettings.audioHighPassEnabled === false ? 1 : clampHighPassHz(currentSettings.audioHighPassHz);
    if (highpassNode) highpassNode.frequency.value = highpassHz;

    const compressorParams = currentSettings.audioCompressorEnabled === false ? NEUTRAL_COMPRESSOR : preset.compressor;
    if (compressorNode) applyCompressorParams(compressorNode, compressorParams);

    const limiterParams = currentSettings.audioLimiterEnabled === false ? NEUTRAL_COMPRESSOR : LIMITER_PARAMS;
    if (limiterNode) applyCompressorParams(limiterNode, limiterParams);
  }

  function measureTick() {
    if (!ctx || !analyserNode || !agcGainNode) return;
    try {
      analyserNode.getFloatTimeDomainData(analyserBuffer);
    } catch (error) {
      diagnostic(`Level measurement failed (${error.message}); AGC paused, capture continues.`);
      return;
    }

    const { rmsDbfs, peakDbfs, peakLinear } = rmsAndPeakDbfs(analyserBuffer);
    const nowMs = now();
    if (peakLinear >= CLIP_LINEAR_THRESHOLD) {
      levels.clipCount += 1;
      lastClipAt = nowMs;
    }
    const clippedRecently = nowMs - lastClipAt <= CLIP_WINDOW_MS;
    const noiseFloorDbfs = effectiveNoiseFloorDbfs();
    const speaking = rmsDbfs > noiseFloorDbfs;

    const elapsedMs = lastTickAt == null ? MEASUREMENT_INTERVAL_MS : nowMs - lastTickAt;
    lastTickAt = nowMs;

    gainDb = computeNextGainDb({ rmsDbfs, currentGainDb: gainDb, preset: currentPreset(), elapsedMs, noiseFloorDbfs });
    try {
      agcGainNode.gain.setTargetAtTime(dbToLinear(gainDb), ctx.currentTime, currentPreset().timeConstantSeconds);
    } catch {
      try { agcGainNode.gain.value = dbToLinear(gainDb); } catch {}
    }

    const classification = classifyLevel({ rmsDbfs, peakDbfs, speaking, clippedRecently });
    levels = {
      rms_dbfs: rmsDbfs,
      peak_dbfs: peakDbfs,
      gain_db: gainDb,
      clipCount: levels.clipCount,
      classification,
      speaking
    };

    trackSustainedCondition('clipping', classification === 'CLIPPING', nowMs, CLIPPING_SUSTAINED_MS);
    // classifyLevel's 'IDLE' is exactly "not speaking" -- i.e. at or below the noise floor -- not the
    // 'LOW' band (speaking, just quietly), which is a different, non-silence condition this issue is
    // not asking us to alarm on.
    trackSustainedCondition('quiet', classification === 'IDLE', nowMs, QUIET_SUSTAINED_MS);
  }

  function startMeasurementLoop() {
    stopMeasurementLoop();
    lastTickAt = null;
    measureTimer = setInterval(measureTick, MEASUREMENT_INTERVAL_MS);
  }

  function stopMeasurementLoop() {
    if (measureTimer !== null) {
      clearInterval(measureTimer);
      measureTimer = null;
    }
  }

  function teardownGraph() {
    stopMeasurementLoop();
    for (const node of [sourceNode, highpassNode, agcGainNode, analyserNode, compressorNode, limiterNode, destinationNode]) {
      try { node?.disconnect?.(); } catch {}
    }
    try { ctx?.close?.(); } catch {}
    sourceNode = highpassNode = agcGainNode = analyserNode = compressorNode = limiterNode = destinationNode = null;
    ctx = null;
  }

  function connect(inputStream) {
    rawStream = inputStream;
    bypassed = true;

    if (!currentSettings.audioConditioningEnabled) {
      diagnostic('Audio processing bypassed by setting; transcription receives the raw microphone stream.');
      return rawStream;
    }

    if (typeof audioContextFactory !== 'function') {
      diagnostic('No AudioContext factory available; transcription receives the raw microphone stream.');
      return rawStream;
    }

    let candidateCtx;
    try {
      candidateCtx = audioContextFactory();
    } catch (error) {
      diagnostic(`AudioContext unavailable (${error.message}); transcription receives the raw microphone stream.`);
      return rawStream;
    }
    if (!candidateCtx || typeof candidateCtx.createMediaStreamSource !== 'function') {
      diagnostic('AudioContext missing required capability; transcription receives the raw microphone stream.');
      return rawStream;
    }
    if (typeof candidateCtx.createMediaStreamDestination !== 'function') {
      diagnostic('MediaStreamAudioDestinationNode unavailable in this browser; transcription receives the raw microphone stream.');
      try { candidateCtx.close?.(); } catch {}
      return rawStream;
    }

    try {
      ctx = candidateCtx;
      sourceNode = ctx.createMediaStreamSource(inputStream);
      highpassNode = ctx.createBiquadFilter();
      highpassNode.type = 'highpass';
      agcGainNode = ctx.createGain();
      agcGainNode.gain.value = 1;
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserBuffer = new Float32Array(analyserNode.fftSize);
      compressorNode = ctx.createDynamicsCompressor();
      limiterNode = ctx.createDynamicsCompressor();
      destinationNode = ctx.createMediaStreamDestination();

      sourceNode.connect(highpassNode);
      highpassNode.connect(agcGainNode);
      agcGainNode.connect(analyserNode);
      analyserNode.connect(compressorNode);
      compressorNode.connect(limiterNode);
      limiterNode.connect(destinationNode);

      gainDb = 0;
      retuneNodes();
      startMeasurementLoop();
      bypassed = false;
      return destinationNode.stream;
    } catch (error) {
      diagnostic(`Audio graph setup failed (${error.message}); transcription receives the raw microphone stream.`);
      teardownGraph();
      return rawStream;
    }
  }

  function update(nextSettings) {
    currentSettings = { ...currentSettings, ...nextSettings };
    if (bypassed) return; // no graph exists to retune; nothing to rebuild either
    retuneNodes();
  }

  function readLevels() {
    return { ...levels };
  }

  function close() {
    teardownGraph();
  }

  return { connect, update, readLevels, close };
}

// A standalone level probe for the pre-meeting mic test (docs/backlog.md item 1). Deliberately NOT
// wired through createAudioConditioner: conditioning ships bypassed by default
// (audioConditioningEnabled: false, view-settings.js), which means the conditioner's own
// readLevels() reports nothing for every real user until someone opts in. A meter hung off the
// conditioner would be dead on arrival. This probe opens its own getUserMedia and its own
// AudioContext/AnalyserNode, independent of whether listening is running and independent of the
// conditioning setting, exactly like Google Meet's mic test does.
//
// Our own graph adds nothing -- no gain, no compressor, no persistence. What it measures is still
// not the bare device: it requests the same three browser-level constraints as the real path
// (browserAudioConstraints), so AGC/noise-suppression/echo-cancel are asked of the browser, and
// applied wherever it honours them, before anything reaches the analyser. Asked, not guaranteed:
// see the diagnostic readback below for why a granted constraint still has to be read off the track
// rather than assumed. That sameness is the point (a probe that measured a different
// signal to the meeting would not predict it), but the earlier wording here claimed the probe
// measured the raw device, and #36 was filed on the strength of it.
//
// Also outside what any constraint can reach: hardware preamp gain on an external interface. #36
// was a maxed knob on a USB interface, invisible from here (2026-08-14).
//
// `stop()` must be idempotent and must
// never throw: a leaked live mic track after the test pane closes would leave the browser's mic
// indicator lit, which is a privacy-visible bug in an app whose whole premise is "no surprise
// capture" (ADR-0003).
export function createMicProbe({
  deviceId,
  audioSettings = {},
  getUserMediaImpl,
  audioContextImpl,
  delayImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  let stream = null;
  let ctx = null;
  let sourceNode = null;
  let analyserNode = null;
  let analyserBuffer = null;
  let active = false;
  let grantedConstraints = null;
  let calibration = null;

  function resolveGetUserMedia() {
    if (typeof getUserMediaImpl === 'function') return getUserMediaImpl;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      return navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    }
    return null;
  }

  function resolveAudioContext() {
    if (typeof audioContextImpl === 'function') return audioContextImpl;
    if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      return () => new Ctor();
    }
    return null;
  }

  function releaseTracks() {
    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
      // Best-effort only -- a track already stopped or a fake stream in tests must never throw here.
    }
    stream = null;
  }

  function teardown() {
    active = false;
    try { sourceNode?.disconnect?.(); } catch {}
    try { analyserNode?.disconnect?.(); } catch {}
    try { ctx?.close?.(); } catch {}
    sourceNode = null;
    analyserNode = null;
    analyserBuffer = null;
    ctx = null;
    grantedConstraints = null;
    calibration = null;
    releaseTracks();
  }

  // Samples ambient room noise for AMBIENT_SAMPLE_COUNT ticks (~1.5s) right after the graph opens,
  // while nobody has necessarily started speaking yet -- the mic test is already sampling audio at
  // this point regardless, so this adds no new capture, just a window of measurements before we
  // trust any of them as "the floor." Best-effort: a transient analyser read failure just yields one
  // fewer sample rather than aborting the whole test.
  async function calibrateAmbientFloor() {
    const samples = [];
    for (let i = 0; i < AMBIENT_SAMPLE_COUNT; i += 1) {
      if (i > 0) await delayImpl(AMBIENT_SAMPLE_INTERVAL_MS);
      if (!active || !analyserNode || !analyserBuffer) break; // stop() fired mid-calibration
      try {
        analyserNode.getFloatTimeDomainData(analyserBuffer);
        const { rmsDbfs } = rmsAndPeakDbfs(analyserBuffer);
        if (Number.isFinite(rmsDbfs)) samples.push(rmsDbfs);
      } catch {
        // best-effort only
      }
    }
    const ambientFloorDbfs = percentileDbfs(samples);
    const { gateDbfs, tooNoisy } = computeNoiseGate(ambientFloorDbfs);
    // resolvedDeviceId records what the browser actually granted (track.getSettings().deviceId,
    // read into grantedConstraints above, before this calibration ever runs) -- the one piece of
    // real device identity available when `deviceId` requested was '' (system default). "Default"
    // is a moving target: the physical device behind it can change (a headset unplugged, the
    // built-in mic becoming default) without the requested id ever changing, so isMicCalibrationValid
    // needs this to detect that the device this calibration measured is gone, not just that '' is
    // still ''.
    calibration = {
      ambientFloorDbfs,
      gateDbfs,
      tooNoisy,
      measuredAt: Date.now(),
      sampleCount: samples.length,
      resolvedDeviceId: grantedConstraints?.deviceId || null
    };
  }

  async function start() {
    const getUserMedia = resolveGetUserMedia();
    if (!getUserMedia) {
      return { ok: false, error: 'Microphone access is not available in this browser.' };
    }

    // Same three browser-level constraints (AGC/noise-suppression/echo-cancel) the real
    // transcription path requests, from the same shared builder -- otherwise this test measures a
    // different microphone than the one the meeting will actually use.
    const constraints = { ...browserAudioConstraints(audioSettings), ...deviceIdConstraint(deviceId) };
    try {
      stream = await getUserMedia({ audio: constraints });
    } catch (error) {
      // Mirrors the transcription path's fallback (transcription/openai.js): a saved device id can
      // go stale or a constraint can be refused outright, and a mic TEST that dies over this is
      // worse than one that degrades to the unconstrained default and says so.
      if (deviceId && (error?.name === 'OverconstrainedError' || error?.name === 'NotFoundError')) {
        try {
          stream = await getUserMedia({ audio: browserAudioConstraints(audioSettings) });
        } catch (fallbackError) {
          return { ok: false, error: fallbackError?.message || 'Could not open the microphone.' };
        }
      } else {
        return { ok: false, error: error?.message || 'Could not open the microphone.' };
      }
    }

    // Diagnostic readback only, never trust that asking for a constraint means the browser/device
    // honoured it (macOS and Bluetooth stacks quietly refuse them) -- same honesty openai.js's
    // reportGrantedConstraints applies to the real capture path.
    try {
      const track = stream.getAudioTracks?.()?.[0];
      grantedConstraints = track?.getSettings?.() || null;
    } catch {
      grantedConstraints = null;
    }

    const audioContextFactory = resolveAudioContext();
    if (!audioContextFactory) {
      releaseTracks();
      return { ok: false, error: 'This browser cannot measure microphone levels.' };
    }

    try {
      ctx = audioContextFactory();
      sourceNode = ctx.createMediaStreamSource(stream);
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserBuffer = new Float32Array(analyserNode.fftSize);
      sourceNode.connect(analyserNode);
      active = true;
      await calibrateAmbientFloor();
      if (!active) return { ok: false, error: 'Microphone test was stopped.' }; // stop() fired mid-calibration
      return { ok: true, grantedConstraints, calibration: getCalibration() };
    } catch (error) {
      teardown();
      return { ok: false, error: error?.message || 'Could not measure this microphone.' };
    }
  }

  function gateDbfsForReadLevels() {
    return calibration && Number.isFinite(calibration.gateDbfs) ? calibration.gateDbfs : NOISE_FLOOR_DBFS;
  }

  function readLevels() {
    if (!active || !analyserNode || !analyserBuffer) return null;
    try {
      analyserNode.getFloatTimeDomainData(analyserBuffer);
    } catch {
      return null;
    }
    const { rmsDbfs, peakDbfs } = rmsAndPeakDbfs(analyserBuffer);
    const speaking = rmsDbfs > gateDbfsForReadLevels();
    return {
      rms_dbfs: rmsDbfs,
      peak_dbfs: peakDbfs,
      gain_db: 0, // the probe applies no gain; it only measures
      clipCount: 0,
      classification: classifyLevel({ rmsDbfs, peakDbfs, speaking, clippedRecently: peakDbfs >= -0.5 }),
      speaking
    };
  }

  function stop() {
    teardown();
  }

  function getGrantedConstraints() {
    return grantedConstraints;
  }

  function getCalibration() {
    return calibration ? { ...calibration } : null;
  }

  return { start, readLevels, stop, getGrantedConstraints, getCalibration };
}
