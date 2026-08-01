import test from 'node:test';
import assert from 'node:assert/strict';

import { createSpeechSegmenter } from '../../../../public/services/audio/speech-segmenter.js';

const SAMPLE_RATE = 16000;
const FRAME_MS = 30;
const FRAME_LENGTH = Math.round((FRAME_MS / 1000) * SAMPLE_RATE);

// Driven by a stub isSpeech so these tests are deterministic and independent of the real
// spectral detector -- a queue of booleans, one per 30ms frame the segmenter asks about.
function makeStubDetector(pattern) {
  let index = 0;
  return () => {
    const value = index < pattern.length ? pattern[index] : pattern[pattern.length - 1];
    index += 1;
    return value;
  };
}

// A distinctly-valued frame (rather than all-zero) so pre-roll content can be told apart from
// in-segment content by inspecting the emitted samples.
function frame(tag) {
  const out = new Float32Array(FRAME_LENGTH);
  out.fill(tag);
  return out;
}

function pushFrames(segmenter, count, tag = 0.1) {
  for (let i = 0; i < count; i += 1) segmenter.push(frame(tag));
}

test('speech segmenter: silence only never calls onSegment', () => {
  const segments = [];
  const isSpeech = makeStubDetector([false]);
  const segmenter = createSpeechSegmenter({ isSpeech, sampleRate: SAMPLE_RATE, frameMs: FRAME_MS, onSegment: (s, m) => segments.push(m) });

  pushFrames(segmenter, 50);
  segmenter.flush();

  assert.equal(segments.length, 0);
});

test('speech segmenter: speech then silence emits exactly one segment containing pre-roll audio from before speech started', () => {
  const segments = [];
  // 5 idle frames (pre-roll accumulates), 15 speech frames, then enough silence to clear hangover.
  const pattern = [...Array(5).fill(false), ...Array(15).fill(true), ...Array(30).fill(false)];
  const isSpeech = makeStubDetector(pattern);
  const preRollMs = 90; // 3 frames
  const segmenter = createSpeechSegmenter({
    isSpeech,
    sampleRate: SAMPLE_RATE,
    frameMs: FRAME_MS,
    preRollMs,
    hangoverMs: 300, // 10 frames
    minSpeechMs: 60,
    onSegment: (samples, meta) => segments.push({ samples, meta })
  });

  // Tag pre-roll frames distinctly from speech frames so we can assert the pre-roll content
  // actually made it into the emitted segment.
  for (let i = 0; i < 5; i += 1) segmenter.push(frame(0.9));
  for (let i = 0; i < 15; i += 1) segmenter.push(frame(0.1));
  for (let i = 0; i < 30; i += 1) segmenter.push(frame(0));

  assert.equal(segments.length, 1);
  const { samples, meta } = segments[0];
  assert.equal(meta.reason, 'silence');
  // Pre-roll is the last preRollMs of idle audio -- 3 frames' worth, tagged 0.9.
  assert.equal(samples[0], 0.9, 'segment begins with pre-roll audio, not the first speech frame');
  // Total length includes 3 pre-roll frames + 15 speech frames + 10 hangover frames.
  assert.equal(samples.length, (3 + 15 + 10) * FRAME_LENGTH);
});

test('speech segmenter: a short gap shorter than hangover between two speech bursts yields ONE segment (issue #24)', () => {
  const segments = [];
  // 10 speech frames, a 3-frame gap (well under a 10-frame hangover), 10 more speech frames, then
  // enough silence to end the segment.
  const pattern = [...Array(10).fill(true), ...Array(3).fill(false), ...Array(10).fill(true), ...Array(30).fill(false)];
  const isSpeech = makeStubDetector(pattern);
  const segmenter = createSpeechSegmenter({
    isSpeech,
    sampleRate: SAMPLE_RATE,
    frameMs: FRAME_MS,
    preRollMs: 0,
    hangoverMs: 300, // 10 frames
    minSpeechMs: 60,
    onSegment: (samples, meta) => segments.push(meta)
  });

  pushFrames(segmenter, pattern.length);

  assert.equal(segments.length, 1, 'a pause shorter than the hangover must not sever the sentence into two segments');
  assert.equal(segments[0].speechMs, 20 * FRAME_MS, 'speech duration counts both bursts, not just one');
});

test('speech segmenter: a burst shorter than minSpeechMs is discarded', () => {
  const segments = [];
  const discards = [];
  // 2 speech frames (60ms) then plenty of silence -- shorter than a 300ms minimum.
  const pattern = [...Array(2).fill(true), ...Array(30).fill(false)];
  const isSpeech = makeStubDetector(pattern);
  const segmenter = createSpeechSegmenter({
    isSpeech,
    sampleRate: SAMPLE_RATE,
    frameMs: FRAME_MS,
    preRollMs: 0,
    hangoverMs: 300,
    minSpeechMs: 300,
    onSegment: (samples, meta) => segments.push(meta),
    onDiscard: (meta) => discards.push(meta)
  });

  pushFrames(segmenter, pattern.length);

  assert.equal(segments.length, 0, 'a cough-length burst must never be sent for transcription');
  assert.equal(discards.length, 1);
  assert.equal(discards[0].reason, 'too-short');
});

test('speech segmenter: continuous speech longer than maxSegmentMs is split into multiple segments with reason maxlength', () => {
  const segments = [];
  const isSpeech = makeStubDetector([true]); // continuous speech forever
  const maxSegmentMs = 300; // 10 frames
  const segmenter = createSpeechSegmenter({
    isSpeech,
    sampleRate: SAMPLE_RATE,
    frameMs: FRAME_MS,
    preRollMs: 0,
    hangoverMs: 300,
    minSpeechMs: 60,
    maxSegmentMs,
    onSegment: (samples, meta) => segments.push(meta)
  });

  pushFrames(segmenter, 35); // 3.5x the max segment length, still speaking throughout

  assert.ok(segments.length >= 3, `expected multiple forced splits, got ${segments.length}`);
  for (const meta of segments) assert.equal(meta.reason, 'maxlength');
});

test('speech segmenter: flush() mid-speech emits the partial segment (issue #19 regression guard)', () => {
  const segments = [];
  const isSpeech = makeStubDetector([true]); // still speaking when flush() is called
  const segmenter = createSpeechSegmenter({
    isSpeech,
    sampleRate: SAMPLE_RATE,
    frameMs: FRAME_MS,
    preRollMs: 0,
    hangoverMs: 300,
    minSpeechMs: 60,
    onSegment: (samples, meta) => segments.push(meta)
  });

  pushFrames(segmenter, 10); // 300ms of speech, never reaches silence or maxlength
  assert.equal(segments.length, 0, 'nothing emitted yet -- still mid-segment');

  segmenter.flush();

  assert.equal(segments.length, 1);
  assert.equal(segments[0].reason, 'flush');
  assert.equal(segments[0].speechMs, 10 * FRAME_MS);
});

test('speech segmenter: flush() with no in-progress segment is a no-op', () => {
  const segments = [];
  const isSpeech = makeStubDetector([false]);
  const segmenter = createSpeechSegmenter({ isSpeech, sampleRate: SAMPLE_RATE, frameMs: FRAME_MS, onSegment: (s, m) => segments.push(m) });

  pushFrames(segmenter, 5);
  segmenter.flush();
  segmenter.flush();

  assert.equal(segments.length, 0);
});
