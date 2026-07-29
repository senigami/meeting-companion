import { normalizeText } from '../text.js';
import { readResponseJson, responseErrorMessage } from '../response.js';
import { buildTranscriptionPrompt } from './prompt.js';
import { fetchWithTimeout } from '../fetch-timeout.js';
import { createAudioConditioner } from '../audio-processing.js';

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
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
  onAudioDiagnostics = () => {}
} = {}) {
  let stream = null; // raw microphone stream, tracks stopped on stop()
  let conditionedStream = null; // what MediaRecorder actually receives
  let conditioner = null;
  let recorder = null;
  let listening = false;
  let queued = Promise.resolve();
  let sessionId = 0;
  let mode = 'speaker';
  let activeRequestController = null;

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

  async function sendChunk(blob, currentSession) {
    if (!blob || blob.size === 0 || !listening || currentSession !== sessionId) return;
    const audioBase64 = await blobToBase64(blob);
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
          mimeType: blob.type || recorder?.mimeType || 'audio/webm',
          filename: `meeting-companion-${currentSession}.webm`,
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

  async function stopTracks() {
    activeRequestController?.abort();
    activeRequestController = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {}
    }
    recorder = null;
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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: audioSettings.audioBrowserAgc !== false,
          noiseSuppression: audioSettings.audioBrowserNoiseSuppression === true,
          echoCancellation: audioSettings.audioBrowserEchoCancel === true
        }
      });
      await reportGrantedConstraints(stream);

      conditioner = createAudioConditioner({
        audioContextFactory,
        settings: audioSettings,
        now,
        onDiagnostics: onAudioDiagnostics
      });
      conditionedStream = conditioner.connect(stream);
      recorder = new MediaRecorder(conditionedStream || stream);
      listening = true;
      queued = Promise.resolve();
      resetFailureBackoff();
      pendingCount = 0;
      droppedForBacklog = 0;

      recorder.ondataavailable = (event) => {
        const blob = event.data;
        if (!blob || blob.size === 0) return;

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
          // State the level explicitly: dropping captured speech is a real problem, and the
          // runtime's prose classifier would not have caught this wording.
          onStatus(
            'Falling behind live speech — skipping audio to catch back up. Some speech will be missing from the transcript.',
            { level: 'problem' }
          );
          return;
        }

        pendingCount += 1;
        queued = queued
          .then(() => sendChunk(blob, currentSession))
          .catch((error) => {
            if (error?.name === 'AbortError') return;
            consecutiveFailures += 1;
            onStatus(`OpenAI transcription error: ${error.message}`);
            if (consecutiveFailures >= FAILURE_THRESHOLD) enterBackoff();
          })
          .finally(() => {
            pendingCount = Math.max(0, pendingCount - 1);
          });
      };

      recorder.onerror = (event) => onStatus(`OpenAI transcription error: ${event.error?.message || event.error || 'unknown error'}`);
      recorder.start(chunkMs);
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
