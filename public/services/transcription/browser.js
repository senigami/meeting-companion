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
  language = 'en-US'
} = {}) {
  let recognition = null;
  let listening = false;
  let started = false;

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
      if (listening) {
        try {
          recognition.start();
          started = true;
        } catch {}
      }
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
      listening = true;
      if (!started) {
        rec.start();
        started = true;
      }
      onStatus('Browser transcription is listening.');
    },
    async stop() {
      listening = false;
      started = false;
      if (recognition) recognition.stop();
      onStatus('Browser transcription stopped.');
    }
  };
}
