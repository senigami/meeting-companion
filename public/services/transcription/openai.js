import { normalizeText } from '../text.js';
import { readResponseJson, responseErrorMessage } from '../response.js';
import { buildTranscriptionPrompt } from './prompt.js';
import { fetchWithTimeout } from '../fetch-timeout.js';
import { createAudioConditioner, chunkContainsSpeech, NOISE_FLOOR_DBFS } from '../audio-processing.js';
import { deviceIdConstraint, browserAudioConstraints } from '../audio-monitor.js';

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Every reference live-transcription client (WhisperLiveKit, Collabora's WhisperLive) captures
// raw PCM via AudioWorklet at 16 kHz mono rather than touching a container format at all -- see
// commit f5fa2c8's WebM-splice fix and the research that followed it. 16 kHz mono is what speech
// models actually want; sending the browser's native 48 kHz stereo would cost roughly 6x the bytes
// for no accuracy gain.
export const TARGET_SAMPLE_RATE = 16000;

// Linear-interpolation downsample from the AudioContext's native sample rate to
// TARGET_SAMPLE_RATE. Pure and DOM-free so it is unit-testable without a real AudioContext.
export function downsampleTo16kMono(float32Samples, sourceSampleRate) {
  if (!sourceSampleRate || sourceSampleRate === TARGET_SAMPLE_RATE) {
    return Float32Array.from(float32Samples);
  }
  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.max(0, Math.floor(float32Samples.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(float32Samples.length - 1, i0 + 1);
    const frac = srcIndex - i0;
    out[i] = float32Samples[i0] + (float32Samples[i1] - float32Samples[i0]) * frac;
  }
  return out;
}

export function floatTo16BitPCM(float32Samples) {
  const out = new Int16Array(float32Samples.length);
  for (let i = 0; i < float32Samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32Samples[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

// Writes a real 44-byte RIFF/WAVE header + PCM data, so every chunk is a standalone-decodable
// file BY CONSTRUCTION -- no splicing, no dependence on any other chunk. int16Samples must already
// be at `sampleRate`.
export function buildWavBytes(int16Samples, sampleRate = TARGET_SAMPLE_RATE) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = int16Samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < int16Samples.length; i += 1) {
    view.setInt16(offset, int16Samples[i], true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export function createOpenAITranscriptionDriver({
  onEvent = () => {},
  onStatus = () => {},
  fetchImpl = fetch,
  chunkMs = 3500,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  audioSettings = {},
  audioContextFactory = () => (typeof AudioContext !== 'undefined' ? new AudioContext() : (typeof webkitAudioContext !== 'undefined' ? new webkitAudioContext() : null)),
  now = () => Date.now(),
  onAudioDiagnostics = () => {},
  workletModuleUrl = new URL('./pcm-worklet-processor.js', import.meta.url)
} = {}) {
  let stream = null; // raw microphone stream, tracks stopped on stop()
  let conditionedStream = null; // what the capture graph actually receives
  let conditioner = null;
  let listening = false;
  let queued = Promise.resolve();
  let sessionId = 0;
  let mode = 'speaker';
  let activeRequestController = null;

  // AudioWorklet capture graph. Built fresh per start(), torn down fully on stop() so a leaked
  // AudioContext or dangling worklet node can never hang the next recording -- or the test suite.
  let captureCtx = null;
  let captureSource = null;
  let workletNode = null;
  let nativeSampleRate = TARGET_SAMPLE_RATE;

  // Native-rate Float32 frames accumulated between worklet messages, flushed into a WAV chunk
  // every time enough native samples exist for `chunkMs` of audio. Reset on every start().
  let sampleBuffer = [];
  let sampleBufferLength = 0;

  // Recovery state for repeated /api/transcribe failures. A sustained outage
  // must not turn into a tight failure loop firing every ~chunkMs, so after
  // FAILURE_THRESHOLD consecutive failures we stop attempting sends entirely
  // for a cooldown that itself grows (doubling, capped) the longer the
  // outage persists — the same escalate-then-back-off shape runtime.js uses
  // for summarize failures, applied here to the transcribe call.
  const FAILURE_THRESHOLD = 3;
  const BASE_BACKOFF_MS = chunkMs * 2;
  const MAX_BACKOFF_MS = 60000;
  let consecutiveFailures = 0;
  let backoffEscalations = 0;
  let inBackoff = false;
  let backoffTimer = null;

  // Bound on how far the send queue may trail live speech. Each queued
  // chunk represents ~chunkMs of audio, so 3 pending chunks caps the lag at
  // roughly 3 * chunkMs (~10.5s at the default interval) before we start
  // shedding the oldest audio instead of letting captions silently drift
  // minutes behind what is actually being said right now.
  const MAX_PENDING_CHUNKS = 3;
  let pendingCount = 0;
  let droppedForBacklog = 0;
  let silentChunksSkipped = 0;

  function emit(type, text, extra = {}) {
    const clean = normalizeText(text);
    if (!clean) return;
    onEvent({ source: 'openai', type, text: clean, ...extra });
  }

  function clearBackoffTimer() {
    if (backoffTimer !== null) {
      clearTimeoutFn(backoffTimer);
      backoffTimer = null;
    }
  }

  function enterBackoff() {
    inBackoff = true;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** backoffEscalations, MAX_BACKOFF_MS);
    backoffEscalations += 1;
    onStatus(
      `OpenAI transcription is having trouble reaching the server. Pausing sends for ${Math.round(delay / 1000)}s and will keep retrying — captured audio is not being sent to the transcript during this pause.`
    );
    clearBackoffTimer();
    backoffTimer = setTimeoutFn(() => {
      backoffTimer = null;
      inBackoff = false;
    }, delay);
  }

  function resetFailureBackoff() {
    consecutiveFailures = 0;
    backoffEscalations = 0;
    clearBackoffTimer();
    inBackoff = false;
  }

  async function sendChunk(wavBytes, currentSession) {
    if (!wavBytes || wavBytes.length === 0 || !listening || currentSession !== sessionId) return;
    const audioBase64 = bytesToBase64(wavBytes);
    if (!listening || currentSession !== sessionId) return;
    const requestController = new AbortController();
    activeRequestController = requestController;
    try {
      const response = await fetchWithTimeout(fetchImpl, '/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: requestController.signal,
        body: JSON.stringify({
          audioBase64,
          mimeType: 'audio/wav',
          filename: `meeting-companion-${currentSession}.wav`,
          mode
        })
      }, { setTimeoutFn, clearTimeoutFn });

      const data = await readResponseJson(response);
      if (!response.ok) throw new Error(responseErrorMessage(data, `Transcription failed with ${response.status}`));
      if (currentSession !== sessionId) return;
      resetFailureBackoff();
      if (data.text) emit('final', data.text, { source: 'openai' });
    } finally {
      if (activeRequestController === requestController) activeRequestController = null;
    }
  }

  // Enqueues one already-encoded WAV chunk onto the same serialized send queue the driver has
  // always used -- same backoff, backlog-dropping, and pendingCount accounting as before, just fed
  // by the worklet's chunk boundary instead of MediaRecorder's ondataavailable.
  function enqueueWavChunk(wavBytes, currentSession) {
    if (inBackoff) {
      // Backing off after repeated failures — never queue behind a
      // known-failing call, and never present this dropped audio as
      // captured; the operator is told once per backoff entry, not
      // spammed per dropped chunk.
      droppedForBacklog += 1;
      return;
    }

    if (pendingCount >= MAX_PENDING_CHUNKS) {
      // The queue is already as far behind live speech as we allow.
      // Shedding the newest chunk (rather than growing the queue
      // further) keeps the lag bounded; recovering stale minutes-old
      // captions presented as live would be worse than an honest gap.
      droppedForBacklog += 1;
      onStatus(
        'Falling behind live speech — skipping audio to catch back up. Some speech will be missing from the transcript.',
        { level: 'problem' }
      );
      return;
    }

    pendingCount += 1;
    queued = queued
      .then(() => sendChunk(wavBytes, currentSession))
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        consecutiveFailures += 1;
        onStatus(`OpenAI transcription error: ${error.message}`);
        if (consecutiveFailures >= FAILURE_THRESHOLD) enterBackoff();
      })
      .finally(() => {
        pendingCount = Math.max(0, pendingCount - 1);
      });
  }

  function samplesNeededForChunk() {
    return Math.max(1, Math.round((chunkMs / 1000) * nativeSampleRate));
  }

  // Drains sampleBuffer into fixed-size, chunkMs-sized native-rate slices, each turned into a
  // standalone WAV chunk and enqueued. Loops (rather than a single if) so a worklet message that
  // pushes past two chunk boundaries at once (e.g. after a GC pause) still flushes every full
  // chunk rather than only the first.
  function drainSampleBuffer(currentSession) {
    const needed = samplesNeededForChunk();
    while (sampleBufferLength >= needed) {
      const merged = new Float32Array(sampleBufferLength);
      let offset = 0;
      for (const part of sampleBuffer) {
        merged.set(part, offset);
        offset += part.length;
      }
      const slice = merged.subarray(0, needed);
      const remainder = merged.subarray(needed);

      const downsampled = downsampleTo16kMono(slice, nativeSampleRate);

      // Silence gate (issue #23): the transcription model invents text from audio that contains
      // no speech at all, so a chunk with nothing in it must never be sent. Reads the same
      // audioSettings.noiseFloorDbfs the conditioner's effectiveNoiseFloorDbfs() reads (see
      // audio-processing.js), rather than reaching into the conditioner, so the gate still works
      // when conditioning is bypassed. This only catches dead air -- a sustained tone or loud
      // noise has speech-level RMS and still passes; real voice activity detection is the
      // follow-up for that.
      const gateDbfs = Number.isFinite(audioSettings.noiseFloorDbfs) ? audioSettings.noiseFloorDbfs : NOISE_FLOOR_DBFS;
      if (chunkContainsSpeech(downsampled, { gateDbfs, sampleRate: TARGET_SAMPLE_RATE })) {
        const int16 = floatTo16BitPCM(downsampled);
        const wavBytes = buildWavBytes(int16, TARGET_SAMPLE_RATE);
        enqueueWavChunk(wavBytes, currentSession);
      } else {
        silentChunksSkipped += 1;
        onAudioDiagnostics({
          message: `Skipped a silent audio chunk (below ${gateDbfs} dBFS gate) -- not sent for transcription.`,
          at: now()
        });
      }

      sampleBuffer = remainder.length ? [Float32Array.from(remainder)] : [];
      sampleBufferLength = remainder.length;
    }
  }

  async function setupCapture(inputStream, currentSession) {
    if (typeof AudioWorkletNode === 'undefined' || typeof audioContextFactory !== 'function') {
      throw new Error('AudioWorklet capture is not available in this browser.');
    }
    const ctx = audioContextFactory();
    if (!ctx || typeof ctx.audioWorklet?.addModule !== 'function' || typeof ctx.createMediaStreamSource !== 'function') {
      throw new Error('AudioWorklet capture is not available in this browser.');
    }

    await ctx.audioWorklet.addModule(workletModuleUrl);
    const source = ctx.createMediaStreamSource(inputStream);
    const node = new AudioWorkletNode(ctx, 'pcm-capture-processor', { numberOfOutputs: 0 });
    node.onprocessorerror = (error) => onStatus(`OpenAI transcription capture error: ${error?.message || 'worklet error'}`);
    node.port.onmessage = (event) => {
      if (!listening || currentSession !== sessionId) return;
      sampleBuffer.push(event.data);
      sampleBufferLength += event.data.length;
      drainSampleBuffer(currentSession);
    };
    source.connect(node);

    captureCtx = ctx;
    captureSource = source;
    workletNode = node;
    nativeSampleRate = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0 ? ctx.sampleRate : TARGET_SAMPLE_RATE;
  }

  async function teardownCapture() {
    if (workletNode) {
      try { workletNode.port.onmessage = null; } catch {}
      try { workletNode.disconnect(); } catch {}
      workletNode = null;
    }
    if (captureSource) {
      try { captureSource.disconnect(); } catch {}
      captureSource = null;
    }
    if (captureCtx) {
      try { await captureCtx.close(); } catch {}
      captureCtx = null;
    }
    sampleBuffer = [];
    sampleBufferLength = 0;
  }

  async function stopTracks() {
    activeRequestController?.abort();
    activeRequestController = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    await teardownCapture();
    try {
      conditioner?.close();
    } catch {}
    conditioner = null;
    conditionedStream = null;
  }

  // Requests the three browser-level constraints, then reports what was actually granted -- a
  // constraint request can be silently ignored by the browser/device, so we never assume it was
  // honoured just because getUserMedia resolved.
  async function reportGrantedConstraints(mediaStream) {
    try {
      const track = mediaStream.getAudioTracks?.()?.[0];
      const settings = track?.getSettings?.();
      if (settings) {
        onAudioDiagnostics({
          message: `Microphone constraints granted: autoGainControl=${settings.autoGainControl}, noiseSuppression=${settings.noiseSuppression}, echoCancellation=${settings.echoCancellation}`,
          // One-shot and worth the operator seeing, so it says so itself rather than leaving the
          // consumer to recognise it by its opening words. See the `notable` note in runtime.js.
          notable: true,
          settings
        });
      }
    } catch {
      // Diagnostic only; never fail capture over introspection.
    }
  }

  return {
    id: 'openai',
    label: 'OpenAI',
    // A live microphone is behind this driver -- the status rail may say "Listening".
    isLive: true,
    isAvailable() {
      return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    },
    setMode(nextMode) {
      mode = nextMode || 'speaker';
    },
    // Live re-tune of the conditioning graph (preset, high-pass, compressor, limiter) without
    // rebuilding the graph or touching the mic. The three browser-level constraints need
    // reacquisition to change and are intentionally NOT retuned here -- that is a separate,
    // future-pass concern per the brief; this pass only exposes the read side (readLevels).
    updateAudioSettings(nextAudioSettings) {
      audioSettings = { ...audioSettings, ...nextAudioSettings };
      conditioner?.update(audioSettings);
    },
    readLevels() {
      return conditioner ? conditioner.readLevels() : null;
    },
    async start({ currentMode } = {}) {
      if (!this.isAvailable()) throw new Error('Microphone capture is not available in this browser.');
      mode = currentMode || mode;
      sessionId += 1;
      const currentSession = sessionId;

      const baseAudioConstraints = browserAudioConstraints(audioSettings);

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...baseAudioConstraints, ...deviceIdConstraint(audioSettings.audioDeviceId) }
        });
      } catch (error) {
        // A saved device id goes stale the moment a USB mic is unplugged, and an exact-match
        // deviceId constraint on a missing device throws OverconstrainedError (some browsers
        // report NotFoundError instead). A saved microphone that vanished must never be what
        // stops a meeting from starting -- retry once against the system default and say so
        // through the existing diagnostics channel rather than failing start() outright.
        if (audioSettings.audioDeviceId && (error?.name === 'OverconstrainedError' || error?.name === 'NotFoundError')) {
          onAudioDiagnostics({
            message: 'The chosen microphone was unavailable; using the system default instead.',
            // The operator deliberately picked a device and is now on a different one. Telling them
            // only via the console would mean the app quietly overrode an explicit choice.
            notable: true,
            at: now()
          });
          stream = await navigator.mediaDevices.getUserMedia({ audio: baseAudioConstraints });
        } else {
          throw error;
        }
      }
      await reportGrantedConstraints(stream);

      conditioner = createAudioConditioner({
        audioContextFactory,
        settings: audioSettings,
        now,
        onDiagnostics: onAudioDiagnostics
      });
      conditionedStream = conditioner.connect(stream);

      listening = true;
      queued = Promise.resolve();
      resetFailureBackoff();
      pendingCount = 0;
      droppedForBacklog = 0;
      silentChunksSkipped = 0;

      try {
        await setupCapture(conditionedStream || stream, currentSession);
      } catch (error) {
        listening = false;
        onStatus(`OpenAI transcription cannot start: ${error.message}`);
        await stopTracks();
        throw error;
      }

      onStatus('OpenAI transcription is listening.');
    },
    async stop() {
      listening = false;
      sessionId += 1;
      resetFailureBackoff();
      pendingCount = 0;
      await stopTracks();
      onStatus('OpenAI transcription stopped.');
    }
  };
}
