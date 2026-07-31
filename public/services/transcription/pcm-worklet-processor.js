// AudioWorklet processor for the OpenAI transcription capture path (public/services/transcription/openai.js).
//
// Runs on the audio render thread and does exactly one job: forward raw mono Float32 PCM frames,
// at the AudioContext's native sample rate, back to the main thread over the node's message port.
// All downsampling to 16 kHz, int16 conversion, and WAV framing happen on the main thread -- this
// keeps the real-time audio thread doing the minimum possible work (a single copy) and keeps the
// encoding logic testable without a real AudioWorkletGlobalScope.
//
// No audio is written to disk, cached beyond the current in-memory frame, or sent anywhere from
// this file -- ADR-0003 / INV-8. It only relays samples in-memory to the driver that already owns
// sending a chunk to /api/transcribe and never persisting it.
class PCMCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length) {
      // .slice(0) copies out of the buffer the audio thread will reuse for the next render
      // quantum -- posting the live buffer directly would race with it being overwritten.
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
