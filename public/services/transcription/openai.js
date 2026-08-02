import { normalizeText } from '../text.js';
import { readResponseJson, responseErrorMessage } from '../response.js';
import { fetchWithTimeout } from '../fetch-timeout.js';
import { createAudioConditioner } from '../audio-processing.js';
import { deviceIdConstraint, browserAudioConstraints } from '../audio-monitor.js';
import { loadVad } from './vad-loader.js';

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
  // No longer used to size capture chunks -- Silero VAD decides chunk boundaries by real speech
  // segments now (see micVad below). Kept only for backoff-timing compatibility (BASE_BACKOFF_MS)
  // and so existing callers that pass it do not break.
  chunkMs = 3500,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  audioSettings = {},
  audioContextFactory = () => (typeof AudioContext !== 'undefined' ? new AudioContext() : (typeof webkitAudioContext !== 'undefined' ? new webkitAudioContext() : null)),
  now = () => Date.now(),
  onAudioDiagnostics = () => {},
  vadFactory = async (options) => {
    const vad = await loadVad();
    return vad.MicVAD.new(options);
  }
} = {}) {
  let stream = null; // raw microphone stream, tracks stopped on stop()
  let conditionedStream = null; // what the capture graph actually receives
  let conditioner = null;
  let listening = false;
  let queued = Promise.resolve();
  let sessionId = 0;
  // No `mode` here, deliberately. Voice to text and text to summary are two separate stages, and
  // only the second one knows this is a church meeting. Transcription takes audio and returns the
  // words that were said. Giving this driver meeting context is what produced issue #27, where the
  // context came back as if someone had spoken it.
  let activeRequestController = null;

  // Silero VAD instance (via @ricky0123/vad-web). Built fresh per start(), torn down fully on
  // stop() so a leaked worker/model can never hang the next recording -- or the test suite. This
  // replaces the AudioWorklet + fixed-interval sampleBuffer chunking entirely: chunk boundaries are
  // now real speech segments (VAD onSpeechStart/onSpeechEnd), not wall-clock intervals that used to
  // sever sentences mid-word (issue #24), and silence is never encoded or sent at all (issue #23).
  let micVad = null;

  // Our own copy of the in-progress utterance, built frame-by-frame from onFrameProcessed. Silero
  // VAD has no maximum-speech-duration option and only ends a segment after a 1.4s pause, so a
  // talk or prayer running long between pauses would otherwise grow unbounded (and, before the
  // server limit above was widened, would 413). This accumulator exists solely to (1) split a
  // segment that runs past MAX_SEGMENT_SECONDS while still speaking, and (2) flush whatever is
  // in progress if stop() is called mid-utterance (issue #19) -- the library itself gives us
  // neither.
  let activeFrames = [];
  let activeSampleCount = 0;
  let inSpeech = false;
  const MAX_SEGMENT_SECONDS = 60;
  const MAX_SEGMENT_SAMPLES = MAX_SEGMENT_SECONDS * TARGET_SAMPLE_RATE;
  // Below this, a flush-on-stop would send a WAV of near-silence/noise that is unlikely to
  // transcribe to anything useful -- not worth a network round trip.
  const MIN_FLUSH_SAMPLES = Math.round(0.3 * TARGET_SAMPLE_RATE);

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

  function concatFloat32(frames) {
    const total = frames.reduce((sum, frame) => sum + frame.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const frame of frames) {
      out.set(frame, offset);
      offset += frame.length;
    }
    return out;
  }

  // Encodes whatever has been accumulated in activeFrames and sends it through the same queue as
  // a normal onSpeechEnd chunk. Resets the accumulator but deliberately leaves `inSpeech` alone --
  // callers decide whether the segment continues (long-utterance split) or has actually ended.
  function flushAccumulated(currentSession, reasonMessage) {
    if (activeSampleCount === 0) return;
    const merged = concatFloat32(activeFrames);
    activeFrames = [];
    activeSampleCount = 0;
    const int16 = floatTo16BitPCM(merged);
    const wavBytes = buildWavBytes(int16, TARGET_SAMPLE_RATE);
    onAudioDiagnostics({ message: reasonMessage, at: now() });
    enqueueWavChunk(wavBytes, currentSession);
  }

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
          filename: `meeting-companion-${currentSession}.wav`
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

  // Sets up Silero VAD against the already-conditioned stream. This replaces the old worklet +
  // fixed-interval sampleBuffer chunking: every onSpeechEnd IS a chunk boundary, drawn at a real
  // speech segment rather than an arbitrary wall-clock tick, and pure silence never reaches
  // onSpeechEnd at all -- so there is nothing left to gate afterward the way the old
  // chunkContainsSpeech energy check had to.
  async function setupCapture(inputStream, currentSession) {
    const speechStartedAt = new Map();

    micVad = await vadFactory({
      model: 'v5',
      baseAssetPath: '/vendor/vad/',
      onnxWASMBasePath: '/vendor/ort/',
      startOnLoad: false,
      // The library's 1400ms default ends a segment on any pause longer than that, which is well
      // inside the pauses a person leaves mid-sentence at a pulpit. Measured on a real run: "Okay,
      // the last bit of text that came in was" and "didn't actually pick anything up" arrived as
      // two separate segments, were transcribed without each other's context, and were then
      // summarized separately into incoherent cards. A longer window costs a little latency and
      // buys three things: sentences that survive intact, better transcription (short fragments
      // transcribe badly because the model has no context), and cards built from whole thoughts.
      redemptionMs: 2500,
      // Slightly above the 400ms default so a cough, a chair, or a page turn does not become a
      // segment of its own.
      minSpeechMs: 600,
      // MicVAD must never open its own microphone -- it gets the stream this driver already
      // acquired (and conditioned). A second getUserMedia would light the browser's recording
      // indicator twice, which ADR-0003's no-surprise-capture rule forbids.
      getStream: async () => inputStream,
      // The driver, not the VAD instance, owns the shared stream's lifecycle.
      pauseStream: () => {},
      resumeStream: () => {},
      onSpeechStart: () => {
        speechStartedAt.set(currentSession, now());
        inSpeech = true;
        activeFrames = [];
        activeSampleCount = 0;
      },
      // Fires once per audio frame for the whole recording, not just during speech -- so only
      // accumulate while `inSpeech` is true. This is our own copy of the in-progress utterance,
      // used solely for the long-utterance split below and for flushing on stop().
      onFrameProcessed: (probabilities, frame) => {
        if (!inSpeech || currentSession !== sessionId) return;
        activeFrames.push(frame);
        activeSampleCount += frame.length;
        if (activeSampleCount >= MAX_SEGMENT_SAMPLES) {
          // Safety net, not the primary path -- Silero has no maximum-speech-duration option and
          // only ends a segment after a 1.4s pause, so someone speaking for a full minute without
          // one would otherwise grow this segment (and its eventual POST body) unbounded. Split it
          // here and keep listening; the utterance continues into the next piece.
          flushAccumulated(currentSession, `Long utterance split after ${MAX_SEGMENT_SECONDS}s (still speaking).`);
        }
      },
      onSpeechEnd: (audio) => {
        inSpeech = false;
        activeFrames = [];
        activeSampleCount = 0;
        if (!listening || currentSession !== sessionId) return;
        const startedAt = speechStartedAt.get(currentSession);
        speechStartedAt.delete(currentSession);
        onAudioDiagnostics({
          message: `Speech segment captured (${audio.length} samples @ 16kHz).`,
          at: now(),
          durationMs: Number.isFinite(startedAt) ? now() - startedAt : undefined
        });
        const int16 = floatTo16BitPCM(audio);
        const wavBytes = buildWavBytes(int16, TARGET_SAMPLE_RATE);
        enqueueWavChunk(wavBytes, currentSession);
      },
      onVADMisfire: () => {
        inSpeech = false;
        activeFrames = [];
        activeSampleCount = 0;
        onAudioDiagnostics({
          message: 'Speech was too short to send (VAD misfire).',
          at: now()
        });
      }
    });

    micVad.start();
  }

  async function teardownCapture() {
    if (micVad) {
      try { micVad.pause(); } catch {}
      try { micVad.destroy(); } catch {}
      micVad = null;
    }
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
        // `track.label` is the human-readable device name (e.g. "UV1 (1397:0510)"), but it is an
        // empty string until microphone permission has actually been granted -- say so honestly
        // rather than printing an empty name that reads as a bug. settings.deviceId is a long
        // opaque hash, so only its first 8 characters are shown, just enough to tell two similarly
        // labelled devices apart at a glance.
        const deviceLabel = track?.label ? track.label : 'name unavailable until permission is granted';
        const shortDeviceId = settings.deviceId ? String(settings.deviceId).slice(0, 8) : null;
        onAudioDiagnostics({
          message: `Microphone in use: ${deviceLabel}.${shortDeviceId ? ` (id ${shortDeviceId}…)` : ''} Constraints granted: autoGainControl=${settings.autoGainControl}, noiseSuppression=${settings.noiseSuppression}, echoCancellation=${settings.echoCancellation}`,
          // One-shot and worth the operator seeing, so it says so itself rather than leaving the
          // consumer to recognise it by its opening words. See the `notable` note in runtime.js.
          // Which physical device got picked matters enough on its own (a wrong microphone with
          // nothing on screen saying so cost hours of real meeting time) that this must reach the
          // operator's status line, not just the console.
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
    // No setMode: runtime.js guards with `typeof driver.setMode === 'function'`, so this driver
    // simply does not offer one. See the note on mode at the top of the factory.
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
    async start() {
      if (!this.isAvailable()) throw new Error('Microphone capture is not available in this browser.');
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
      // Flush any in-progress utterance BEFORE listening is dropped and sessionId is advanced --
      // both enqueueWavChunk and sendChunk gate on `listening` and `currentSession === sessionId`,
      // so this has to run while both still hold or the session guard would silently discard the
      // very audio we're trying to save (issue #19: the last thing said in a meeting was never
      // summarized because the old fixed chunking lost up to 3.5s to it; this design would
      // otherwise lose an entire in-progress utterance instead). Wrapped so a flush failure can
      // never prevent teardown.
      try {
        if (inSpeech && activeSampleCount >= MIN_FLUSH_SAMPLES) {
          flushAccumulated(sessionId, 'Flushed in-progress utterance on stop (issue #19).');
          // sendChunk itself gates on `listening`, which this same function is about to set to
          // false -- so the send has to actually go out (or fail) while listening is still true,
          // not just be enqueued. Await the queue's current tail rather than flipping `listening`
          // out from under a send that hasn't run yet.
          await queued.catch(() => {});
        }
      } catch (error) {
        onAudioDiagnostics({
          message: `Failed to flush final utterance on stop: ${error.message}`,
          at: now()
        });
      }
      inSpeech = false;
      activeFrames = [];
      activeSampleCount = 0;
      listening = false;
      sessionId += 1;
      resetFailureBackoff();
      pendingCount = 0;
      await stopTracks();
      onStatus('OpenAI transcription stopped.');
    }
  };
}
