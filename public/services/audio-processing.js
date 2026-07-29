// Real-time microphone conditioning for the OpenAI transcription path only (the browser
// SpeechRecognition path opens the microphone itself and accepts no audio input -- see
// .agent/audio-conditioning-brief.md). Owns the Web Audio graph, level analysis, AGC state,
// presets, and diagnostics. The transcription driver hands us a raw MediaStream and gets back
// either a conditioned MediaStream or, on any failure/bypass, the same raw stream untouched.
//
// No audio or diagnostics are ever written to disk or sent over the network here (ADR-0003 /
// INV-8 / INV-12) -- everything in this module is in-memory only, for the lifetime of the call.

export const AUDIO_PROCESSING_PRESETS = ['off', 'gentle', 'normal'];

// Silence must never drive gain upward -- this is the single most important AGC rule. We
// implement the gate by freezing the gain entirely (no movement either direction) whenever
// measured RMS is at or below the noise floor, which also satisfies "adapt across speakers, not
// across syllables" since a mid-sentence pause below the floor just holds the last gain.
export const NOISE_FLOOR_DBFS = -50;

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
export function computeNextGainDb({ rmsDbfs, currentGainDb = 0, preset, elapsedMs = MEASUREMENT_INTERVAL_MS }) {
  const config = typeof preset === 'string' ? presetParams(preset) : preset || PRESETS.gentle;
  if (!config.adapt) return 0;

  const speaking = rmsDbfs > NOISE_FLOOR_DBFS;
  if (!speaking) return currentGainDb; // speech gate: silence never moves gain, in either direction

  const desiredGainDb = config.targetRmsDbfs - rmsDbfs;
  const clampedDesired = Math.min(config.maxBoostDb, Math.max(config.maxCutDb, desiredGainDb));

  const timeConstant = Math.max(0.001, config.timeConstantSeconds);
  const elapsedSeconds = Math.max(0, elapsedMs) / 1000;
  const alpha = 1 - Math.exp(-elapsedSeconds / timeConstant);
  const nextGainDb = currentGainDb + (clampedDesired - currentGainDb) * alpha;

  return Math.min(config.maxBoostDb, Math.max(config.maxCutDb, nextGainDb));
}

export function classifyLevel({ rmsDbfs, peakDbfs, speaking, clippedRecently }) {
  if (!speaking) return 'IDLE'; // silence is not a fault; the meter must not read LOW
  if (clippedRecently || peakDbfs >= -0.5) return 'CLIPPING';
  if (rmsDbfs > -8) return 'HIGH';
  if (rmsDbfs >= -24) return 'GOOD';
  return 'LOW';
}

function rmsAndPeakDbfs(samples) {
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
  onDiagnostics = () => {}
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
    const speaking = rmsDbfs > NOISE_FLOOR_DBFS;

    const elapsedMs = lastTickAt == null ? MEASUREMENT_INTERVAL_MS : nowMs - lastTickAt;
    lastTickAt = nowMs;

    gainDb = computeNextGainDb({ rmsDbfs, currentGainDb: gainDb, preset: currentPreset(), elapsedMs });
    try {
      agcGainNode.gain.setTargetAtTime(dbToLinear(gainDb), ctx.currentTime, currentPreset().timeConstantSeconds);
    } catch {
      try { agcGainNode.gain.value = dbToLinear(gainDb); } catch {}
    }

    levels = {
      rms_dbfs: rmsDbfs,
      peak_dbfs: peakDbfs,
      gain_db: gainDb,
      clipCount: levels.clipCount,
      classification: classifyLevel({ rmsDbfs, peakDbfs, speaking, clippedRecently }),
      speaking
    };
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

    if (currentSettings.audioBypassForTest) {
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
