import { normalizeText } from '../text.js';

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isFatalSpeechRecognitionError(error) {
  return !['no-speech', 'aborted'].includes(String(error || '').toLowerCase());
}

export function createBrowserTranscriptionDriver({
  onEvent = () => {},
  onStatus = () => {},
  language = 'en-US',
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  let recognition = null;
  let listening = false;
  let started = false;
  let restartFailureCount = 0;
  let restartTimer = null;

  // A transient blip (network flap, audio device hiccup) must never end
  // transcription for the rest of a meeting the operator isn't watching, so
  // restarts back off exponentially but never stop trying. 500ms lets a
  // one-off failure recover almost instantly; doubling per consecutive
  // failure spaces out a sustained outage instead of spinning; the 30s
  // ceiling keeps the driver checking often enough to notice recovery
  // quickly once the underlying condition clears.
  const RESTART_BASE_DELAY_MS = 500;
  const RESTART_MAX_DELAY_MS = 30000;

  function clearRestartTimer() {
    if (restartTimer !== null) {
      clearTimeoutFn(restartTimer);
      restartTimer = null;
    }
  }

  function attemptRestart() {
    if (!listening || !recognition) return;
    try {
      recognition.start();
      started = true;
      if (restartFailureCount > 0) {
        onStatus('Browser transcription is listening again.');
      }
      restartFailureCount = 0;
    } catch {
      restartFailureCount += 1;
      // Prefixing with "Speech recognition error:" keeps this read as
      // non-fatal by transcriptionStatusLevel in runtime.js, so the operator
      // sees "retrying", never "stopped" — while it keeps retrying.
      onStatus(`Speech recognition error: retrying microphone connection (attempt ${restartFailureCount})...`);
      scheduleRestart();
    }
  }

  function scheduleRestart() {
    clearRestartTimer();
    const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** (restartFailureCount - 1), RESTART_MAX_DELAY_MS);
    restartTimer = setTimeoutFn(() => {
      restartTimer = null;
      attemptRestart();
    }, delay);
  }

  function emit(type, text, extra = {}) {
    const clean = normalizeText(text);
    if (!clean) return;
    onEvent({ source: 'browser', type, text: clean, ...extra });
  }

  function ensureRecognition() {
    if (recognition) return recognition;
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) return null;

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += `${text} `;
        else interimText += `${text} `;
      }

      restartFailureCount = 0;
      if (finalText.trim()) emit('final', finalText, { source: 'browser' });
      if (interimText.trim()) emit('partial', interimText, { source: 'browser' });
    };

    recognition.onerror = (event) => {
      const error = String(event?.error || 'unknown error');
      if (isFatalSpeechRecognitionError(error)) {
        listening = false;
        started = false;
        onStatus(`Browser transcription stopped after speech recognition error: ${error}`);
        return;
      }

      onStatus(`Speech recognition error: ${error}`);
    };
    recognition.onend = () => {
      started = false;
      if (listening) attemptRestart();
    };

    return recognition;
  }

  return {
    id: 'browser',
    label: 'Browser',
    isAvailable() {
      return Boolean(getSpeechRecognition());
    },
    async start() {
      const rec = ensureRecognition();
      if (!rec) throw new Error('Speech recognition is not available in this browser.');
      clearRestartTimer();
      listening = true;
      restartFailureCount = 0;
      if (!started) {
        rec.start();
        started = true;
      }
      onStatus('Browser transcription is listening.');
    },
    async stop() {
      listening = false;
      started = false;
      clearRestartTimer();
      restartFailureCount = 0;
      if (recognition) recognition.stop();
      onStatus('Browser transcription stopped.');
    }
  };
}
