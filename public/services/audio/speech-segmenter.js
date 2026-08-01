// Speech-boundary segmentation for the OpenAI transcription path (issue #24: fixed-interval
// chunking severs sentences mid-word). Pure, DOM-free, timer-free -- driven entirely by the
// samples the caller pushes in, so it is fully unit-testable with a stub `isSpeech` and no real
// clock at all.
//
// push() accepts arbitrary-length 16kHz mono audio and frames it internally. A rolling pre-roll
// buffer (the most recent `preRollMs` while idle) is prepended to every segment so the recording
// includes the audio just before speech was detected -- clipping the first phoneme is a real
// failure this exists to prevent. Once in speech, silence does not end the segment until
// `hangoverMs` of continuous non-speech has passed, so a mid-sentence pause or breath does not cut
// a segment in half. A segment shorter than `minSpeechMs` of actual speech is discarded (a cough or
// a door, not a sentence). A segment reaching `maxSegmentMs` while still in speech is flushed with
// reason 'maxlength' and a new segment is started immediately, so continuous speech is still
// transcribed promptly. flush() emits any in-progress segment (used at stop(), so the last
// sentence of a meeting is never lost -- issue #19).
export function createSpeechSegmenter({
  isSpeech,
  sampleRate = 16000,
  frameMs = 30,
  preRollMs = 300,
  hangoverMs = 700,
  minSpeechMs = 300,
  maxSegmentMs = 12000,
  // Called only for segments that actually contain enough speech to keep -- never for a session
  // with no speech in it at all, and never for a discarded (too-short) burst; see onDiscard below.
  onSegment = () => {},
  // Not part of the constructor list in the original spec; added because the driver needs to
  // report discarded (too-short) bursts through its diagnostics channel, and there was otherwise no
  // way for a caller to observe a discard at all. Optional and defaults to a no-op, so existing
  // callers built against the documented signature are unaffected.
  onDiscard = () => {}
} = {}) {
  const frameLength = Math.max(1, Math.round((frameMs / 1000) * sampleRate));
  const preRollFrames = Math.max(0, Math.round(preRollMs / frameMs));
  const hangoverFrames = Math.max(0, Math.round(hangoverMs / frameMs));
  const minSpeechFrames = Math.max(0, Math.round(minSpeechMs / frameMs));
  const maxSegmentFrames = Math.max(1, Math.round(maxSegmentMs / frameMs));

  // Carry-over samples that don't yet fill a whole frame, across push() calls.
  let carry = new Float32Array(0);

  // Rolling pre-roll ring while idle (not yet in a segment).
  let preRoll = [];

  // Segment-in-progress state.
  let inSegment = false;
  let segmentFrames = []; // Float32Array frames, oldest first
  let speechFrameCount = 0;
  let hangoverCount = 0; // consecutive non-speech frames seen since the last speech frame

  function concatFrames(frames) {
    let total = 0;
    for (const frame of frames) total += frame.length;
    const out = new Float32Array(total);
    let offset = 0;
    for (const frame of frames) {
      out.set(frame, offset);
      offset += frame.length;
    }
    return out;
  }

  function resetSegmentState() {
    inSegment = false;
    segmentFrames = [];
    speechFrameCount = 0;
    hangoverCount = 0;
  }

  function endSegment(reason) {
    const totalFrames = segmentFrames.length;
    const speechMs = speechFrameCount * frameMs;
    const totalMs = totalFrames * frameMs;
    if (speechFrameCount === 0) {
      // Never emit a segment with no speech in it at all, regardless of reason.
      resetSegmentState();
      return;
    }
    if (speechFrameCount < minSpeechFrames) {
      onDiscard({ speechMs, totalMs, reason: 'too-short' });
      resetSegmentState();
      return;
    }
    const samples = concatFrames(segmentFrames);
    resetSegmentState();
    onSegment(samples, { speechMs, totalMs, reason });
  }

  function pushPreRoll(frame) {
    preRoll.push(frame);
    while (preRoll.length > preRollFrames) preRoll.shift();
  }

  function processFrame(frame) {
    const speech = Boolean(isSpeech(frame));

    if (!inSegment) {
      if (speech) {
        inSegment = true;
        segmentFrames = [...preRoll, frame];
        preRoll = [];
        speechFrameCount = 1;
        hangoverCount = 0;
      } else {
        pushPreRoll(frame);
      }
      return;
    }

    // In a segment.
    segmentFrames.push(frame);
    if (speech) {
      speechFrameCount += 1;
      hangoverCount = 0;
    } else {
      hangoverCount += 1;
      if (hangoverCount >= hangoverFrames) {
        endSegment('silence');
        return;
      }
    }

    if (segmentFrames.length >= maxSegmentFrames) {
      endSegment('maxlength');
    }
  }

  function push(float32Samples) {
    if (!float32Samples || !float32Samples.length) return;
    let merged;
    if (carry.length) {
      merged = new Float32Array(carry.length + float32Samples.length);
      merged.set(carry, 0);
      merged.set(float32Samples, carry.length);
    } else {
      merged = float32Samples;
    }

    let offset = 0;
    while (offset + frameLength <= merged.length) {
      processFrame(merged.subarray(offset, offset + frameLength));
      offset += frameLength;
    }
    carry = offset < merged.length ? Float32Array.from(merged.subarray(offset)) : new Float32Array(0);
  }

  function flush() {
    if (inSegment) endSegment('flush');
  }

  function reset() {
    carry = new Float32Array(0);
    preRoll = [];
    resetSegmentState();
  }

  return { push, flush, reset };
}
