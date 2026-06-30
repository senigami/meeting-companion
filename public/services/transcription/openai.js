import { normalizeText } from '../text.js';
import { buildTranscriptionPrompt } from './prompt.js';

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
  chunkMs = 3500
} = {}) {
  let stream = null;
  let recorder = null;
  let listening = false;
  let queued = Promise.resolve();
  let sessionId = 0;
  let mode = 'speaker';

  function emit(type, text, extra = {}) {
    const clean = normalizeText(text);
    if (!clean) return;
    onEvent({ source: 'openai', type, text: clean, ...extra });
  }

  async function sendChunk(blob, currentSession) {
    if (!blob || blob.size === 0 || !listening || currentSession !== sessionId) return;
    const audioBase64 = await blobToBase64(blob);
    const response = await fetchImpl('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64,
        mimeType: blob.type || recorder?.mimeType || 'audio/webm',
        filename: `meeting-companion-${currentSession}.webm`,
        mode
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Transcription failed with ${response.status}`);
    if (currentSession !== sessionId) return;
    if (data.text) emit('final', data.text, { source: 'openai' });
  }

  async function stopTracks() {
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
    async start({ currentMode } = {}) {
      if (!this.isAvailable()) throw new Error('Microphone capture is not available in this browser.');
      mode = currentMode || mode;
      sessionId += 1;
      const currentSession = sessionId;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      listening = true;
      queued = Promise.resolve();

      recorder.ondataavailable = (event) => {
        const blob = event.data;
        if (!blob || blob.size === 0) return;
        queued = queued
          .then(() => sendChunk(blob, currentSession))
          .catch((error) => onStatus(`OpenAI transcription error: ${error.message}`));
      };

      recorder.onerror = (event) => onStatus(`OpenAI transcription error: ${event.error?.message || event.error || 'unknown error'}`);
      recorder.start(chunkMs);
      onStatus('OpenAI transcription is listening.');
    },
    async stop() {
      listening = false;
      sessionId += 1;
      await stopTracks();
      onStatus('OpenAI transcription stopped.');
    }
  };
}
