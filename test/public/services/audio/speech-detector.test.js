import test from 'node:test';
import assert from 'node:assert/strict';

import { spectralFlatness, zeroCrossingRate, createSpeechDetector } from '../../../../public/services/audio/speech-detector.js';

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 480; // ~30ms @ 16kHz

function generateFrame(fn, length = FRAME_SAMPLES, sampleRate = SAMPLE_RATE) {
  const frame = new Float32Array(length);
  for (let i = 0; i < length; i += 1) frame[i] = fn(i / sampleRate);
  return frame;
}

function whiteNoiseFrame(amplitude = 0.5, seed = 1) {
  // Deterministic pseudo-random noise so the test is reproducible.
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
  return generateFrame(() => amplitude * next());
}

function vowelLikeFrame(amplitude = 0.5) {
  return generateFrame(
    (t) =>
      amplitude * Math.sin(2 * Math.PI * 120 * t) +
      amplitude * 0.6 * Math.sin(2 * Math.PI * 240 * t) +
      amplitude * 0.4 * Math.sin(2 * Math.PI * 360 * t) +
      amplitude * 0.2 * Math.sin(2 * Math.PI * 480 * t)
  );
}

function pureToneFrame(amplitude = 0.5, frequency = 300) {
  return generateFrame((t) => amplitude * Math.sin(2 * Math.PI * frequency * t));
}

test('spectralFlatness returns 1 for empty/degenerate input (fails closed toward noise-like)', () => {
  assert.equal(spectralFlatness([]), 1);
  assert.equal(spectralFlatness(null), 1);
  assert.ok(Math.abs(spectralFlatness([0, 0, 0]) - 1) < 1e-9);
});

test('spectralFlatness is near 1 for flat (noise-like) spectra and near 0 for peaky spectra', () => {
  const flat = [1, 1, 1, 1, 1];
  const peaky = [0, 0, 10, 0, 0];
  assert.ok(spectralFlatness(flat) > 0.9);
  assert.ok(spectralFlatness(peaky) < 0.3);
});

test('zeroCrossingRate is 0 for constant/short input and reflects sign changes otherwise', () => {
  assert.equal(zeroCrossingRate([]), 0);
  assert.equal(zeroCrossingRate([1]), 0);
  assert.equal(zeroCrossingRate(new Float32Array(10)), 0);
  assert.equal(zeroCrossingRate([1, -1, 1, -1]), 1);
});

test('createSpeechDetector: digital silence is not speech', () => {
  const detector = createSpeechDetector();
  assert.equal(detector.isSpeech(new Float32Array(FRAME_SAMPLES)), false);
  assert.equal(detector.lastScore().isSpeech, false);
});

test('createSpeechDetector: white noise (flat spectrum) is not speech', () => {
  const detector = createSpeechDetector();
  const frame = whiteNoiseFrame();
  assert.equal(detector.isSpeech(frame), false);
  const score = detector.lastScore();
  assert.ok(score.flatness > 0.4, `expected flat spectrum, got ${score.flatness}`);
});

test('createSpeechDetector: a synthesized vowel-like signal (fundamental + harmonics) IS speech', () => {
  const detector = createSpeechDetector();
  const frame = vowelLikeFrame();
  assert.equal(detector.isSpeech(frame), true);
});

test('createSpeechDetector: a pure tone is not speech (issue #23 exact reproduction case)', () => {
  const detector = createSpeechDetector();
  const frame = pureToneFrame();
  assert.equal(detector.isSpeech(frame), false, 'a pure tone has speech-level RMS but must not read as speech');
});

test('createSpeechDetector: reset() clears lastScore back to the idle default', () => {
  const detector = createSpeechDetector();
  detector.isSpeech(vowelLikeFrame());
  assert.equal(detector.lastScore().isSpeech, true);
  detector.reset();
  assert.equal(detector.lastScore().isSpeech, false);
  assert.equal(detector.lastScore().rmsDbfs, -Infinity);
});

test('createSpeechDetector: an empty/missing frame is not speech and does not throw', () => {
  const detector = createSpeechDetector();
  assert.equal(detector.isSpeech(new Float32Array(0)), false);
  assert.equal(detector.isSpeech(null), false);
});
