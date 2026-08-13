# Design brief — real-time microphone conditioning before transcription

Surface this covers: `public/services/audio-processing.js`, `public/services/transcription/*`,
`registry.js`. This document is the binding contract for that surface; where it and the original
2026-07-28 request differ, this document wins and the deviation is recorded under Deviations below.

## Architectural truth, verified 2026-07-28 (do not re-litigate, do verify before relying)

- `public/services/transcription/browser.js:80` — `new SpeechRecognition()`. The Web Speech API opens
  the microphone itself and accepts no audio input. **Conditioning is impossible on this path.** Not a
  code limitation; an API one.
- `public/services/transcription/openai.js:151-152` — `getUserMedia({ audio: true })` then
  `new MediaRecorder(stream)`. This is the conditionable path, and the only one.
- `getUserMedia` is currently called with NO constraints. Adding them is a behavior change.
- There is no `AudioContext` anywhere in the repo today. This is greenfield.

Consequence that must be honoured in the UI: audio-processing controls apply to OpenAI transcription
only. When the browser source is selected they must read as unavailable, with a plain reason. A
control that appears live but does nothing is the exact failure the source spec closes on, and
status honesty is this repo's oldest scar.

## Module contract

New file: `public/services/audio-processing.js`. It owns the Web Audio graph, level analysis, AGC
state, presets, and diagnostics. The transcription driver must not know how compression works.

```
createAudioConditioner({
  audioContextFactory,   // injected, so tests never touch real Web Audio
  settings,              // the resolved audio settings object
  now,                   // injected clock
  onDiagnostics           // optional callback, throttled
}) -> {
  connect(rawStream),    // returns a MediaStream to hand to MediaRecorder
  update(settings),      // live re-tune WITHOUT rebuilding the graph or touching the mic
  readLevels(),          // { rms_dbfs, peak_dbfs, gain_db, clipCount, classification, speaking }
  close()
}
```

`connect()` builds: source -> highpass -> agcGain -> compressor -> limiter -> destination, and
returns `destination.stream`. When processing is disabled entirely it returns the raw stream
unchanged — the bypass must be a real bypass, not a graph of neutral nodes.

## Stages and defaults

| Stage | Node | Default |
|---|---|---|
| High-pass | `BiquadFilterNode` type `highpass` | ON, 80 Hz (settable 50-150) |
| Automatic level control | `GainNode` + `AnalyserNode` measurement | `gentle` |
| Compression | `DynamicsCompressorNode` | ON when ALC is not `off` |
| Peak protection | `DynamicsCompressorNode`, final stage | ON |

Presets — `off` | `gentle` (default) | `normal`:

- `gentle`: target RMS -18 dBFS, max boost +9 dB, max cut -12 dB, gain time-constant ~1.5 s
- `normal`: target RMS -15 dBFS, max boost +12 dB, max cut -12 dB, gain time-constant ~0.6 s
- compressor `gentle`: threshold -18 dB, ratio 2, knee 12, attack 5 ms, release 250 ms
- compressor `normal`: threshold -16 dB, ratio 3, knee 6, attack 3 ms, release 150 ms
- limiter both: threshold -3 dB, ratio 20, knee 0, attack 1 ms, release 50 ms

Browser-level constraints, requested but never assumed honoured:
`autoGainControl: true`, `noiseSuppression: false`, `echoCancellation: false`. All three settable.

## AGC behaviour — the part most likely to be got wrong

- Measure short-term RMS from an `AnalyserNode` on a ~50 ms timer. Do NOT do per-frame JS work and do
  NOT use `ScriptProcessorNode`.
- Apply gain with `gain.setTargetAtTime(target, ctx.currentTime, timeConstant)`. Never assign
  `gain.value` directly while running — that steps and clicks.
- **Speech gate:** only adapt when RMS is above the noise floor (start at -50 dBFS). Silence must
  never drive gain up. This is the single most important rule in the AGC.
- Clamp cumulative gain to the preset's boost/cut limits. Unlimited gain is a defect, not a tuning
  choice.
- Adapt across speakers, not across syllables. Sentence dynamics stay intact.

## Level classification (operator-facing)

`CLIPPING` if peak >= -0.5 dBFS or a clip was seen in the last 2 s; else `HIGH` if RMS > -8;
`GOOD` if RMS in [-24, -8]; `LOW` if RMS < -24. When `speaking` is false the classification is
`IDLE` and the meter must not read LOW. Silence is not a fault.

## Settings and persistence

Extend the existing mechanism in `public/services/view-settings.js`. Do not invent storage.

**KNOWN TRAP, from the code map's own gotcha on `runtime.js`:** `runtime.js` and `start-app.js` each
define their OWN `STORAGE` constant listing the same keys. A key added to only one causes
`localStorage.setItem(undefined, ...)`, writing a key literally named `undefined`. Unit tests stub
localStorage and assert values, not key names, so nothing catches it. **Add every new key to BOTH
maps or neither.** Verify by grepping both files for each new key.

Keys: `audioProcessingPreset`, `audioHighPassEnabled`, `audioHighPassHz`, `audioCompressorEnabled`,
`audioLimiterEnabled`, `audioBrowserAgc`, `audioBrowserNoiseSuppression`, `audioBrowserEchoCancel`,
`audioBypassForTest`.

## Live re-tune vs mic reacquisition

- Preset, high-pass cutoff, compressor and limiter params: apply live via `update()`. Never restart
  capture for these.
- The three browser constraints: these need `applyConstraints()` on the live track, falling back to
  reacquiring the mic. Do this ONLY for those three, never for the graph params, and never mid-chunk
  without letting the in-flight chunk finish.

## Privacy — non-negotiable, do not touch

ADR-0003 / INV-8 / INV-12: no audio or transcript persistence by default, provider keys in memory
only. This work adds no persistence and no new network call: conditioning is in-memory, and the only
thing crossing the wire is the same audio chunk that already did. Diagnostics may hold levels and a
device label in memory but must never be written to disk. Any change to that is ask-first, always.

## Tests — mock Web Audio, never touch hardware

Required: settings defaults; each preset's resolved parameters; gain clamped at both limits; the
speech gate refusing to raise gain on silence; level classification at each boundary including IDLE;
clipping detection; enable/disable producing a real bypass; both STORAGE maps carrying every new key.
Inject `audioContextFactory` and a fake clock. No test may require a microphone.

## Deviations from the source spec, deliberate

1. **No AudioWorklet for the AGC.** Slow adaptive gain needs periodic measurement, not per-frame
   processing. An `AnalyserNode` polled at ~20 Hz plus `setTargetAtTime` gives smooth adaptation with
   no continuous main-thread work and no worklet module to serve or fail to load. The source spec
   permits a worklet "if necessary"; it is not. Revisit only if measurement proves too coarse.
2. **Conditioning is OpenAI-only,** because the browser recognizer cannot accept audio. The source
   spec assumed both paths were feedable.
3. **Limiter is a `DynamicsCompressorNode`,** not a custom worklet limiter, for the same reason as 1
   and because the spec explicitly allows it and warns against lookahead latency.
