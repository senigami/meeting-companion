# audio-capture

Portable microphone capture, device selection, level measurement, and conditioning logic,
extracted from meeting-companion's settings pane for reuse in other repos (issue #10).
audiobook-studio is the first named consumer.

Everything here is pure and dependency-injected: no `ctx.state`, no DOM, no reference to this
app's operator rail or transcription pipeline. The two files map onto the four pieces the
extraction issue asked about:

- **`audio-monitor.js`** — device enumeration (`listAudioInputs`, `resolveDeviceId`,
  `evaluateMicReadiness`), the settings-to-`getUserMedia`-constraints plumbing
  (`browserAudioConstraints`, `deviceIdConstraint`), calibration-staleness checks
  (`isMicCalibrationValid`), and the level-meter *data* transforms (`describeLevels`,
  `stabilizeMeterDisplay`, `describeMicCalibration`). All pure functions — no DOM, no timers except
  the caller-supplied `nowMs` clock.
- **`audio-processing.js`** — `createMicProbe` (the standalone pre-meeting mic test: its own
  `getUserMedia` + `AudioContext`, ambient-noise calibration, level classification thresholds) and
  `createAudioConditioner` (the AGC/compressor/limiter graph used on the real capture path). Both
  take their browser globals (`getUserMediaImpl`, `audioContextImpl`, `audioContextFactory`) as
  constructor options rather than reaching for `navigator`/`window` directly, which is what makes
  them unit-testable here and portable elsewhere.

## What did NOT come with it, and why

The **DOM rendering** of the level meter (writing `rmsPercent`/`peakPercent`/`text` onto actual
bar/peak-marker/label elements) stayed in `public/controller/runtime.js` (`renderAudioLevelMeter`).
It is ~15 lines of direct `element.style.width = ...` / `textContent = ...` against this app's
specific DOM ids (`ctx.dom.audioLevelBar`, etc.) and its own settings-pane markup — there is nothing
general left to extract once `describeLevels`/`stabilizeMeterDisplay` (the actual meter logic) are
already out. This was a deliberate **headless** choice (see "UI-ownership decision" below), not an
oversight: a consuming app renders its own bar against the numbers this module hands back.

Likewise **not extracted**: `buildAudioSettings()`-style glue that reads this app's `ctx.state` and
localStorage keys into the plain settings object these functions expect, the operator-rail status
wiring (`sustained condition` → rail message), and the mic-calibration persistence (`localStorage`
read/write keyed by device id). Each of those is a few lines of app-specific plumbing a consumer
writes once, following the pattern below.

## UI-ownership decision

The module owns **no DOM**, only headless capture/measurement logic plus the *data* a meter needs
to render (percentages, classification word, clip/peak state, already debounced for a slow reader).
This was weighed both ways:

- A module that also renders a `<div>` bar would port further with zero glue code, but it would
  either impose meeting-companion's specific markup/CSS on audiobook-studio, or grow an
  abstraction (custom element, render-into-container callback) purely to avoid that — complexity
  that exists only to paper over two apps having different settings panes.
- Headless leaves the consumer writing its own bar, but that's the cheap half: `describeLevels` and
  `stabilizeMeterDisplay` already did the actual work (dB→percent conversion, IDLE/LOW/GOOD/HIGH/
  CLIPPING classification, the clip-latch/debounce logic tuned for a slow reader). What's left for
  audiobook-studio is binding `display.rmsPercent` to a width and `display.text` to a label —
  the same handful of lines `renderAudioLevelMeter` has, not a level meter built from scratch.

Headless won because the *hard* part (device handling, calibration, debounced classification) is
100% portable either way, and the *easy* part (drawing a bar) is cheap enough in any UI framework
that shipping it pre-built would cost more in imposed structure than it saves in typing.

## Porting into another repo (audiobook-studio)

1. Copy this directory (`audio-monitor.js`, `audio-processing.js`) into the target repo, e.g.
   `public/services/audio-capture/` or wherever that repo keeps shared services. No changes needed
   to either file's contents.
2. Wire device selection: call `listAudioInputs(navigator.mediaDevices)` to populate a picker,
   `resolveDeviceId(devices, savedId)` when restoring a saved choice, and
   `evaluateMicReadiness({ permissionState, devices })` to decide whether to show "grant
   permission" vs. a working picker.
3. Build `getUserMedia` constraints from whatever settings shape that app has, by mapping its own
   fields onto `browserAudioConstraints({ audioBrowserAgc, audioBrowserNoiseSuppression,
   audioBrowserEchoCancel })` and merging in `deviceIdConstraint(deviceId)`.
4. For a pre-recording mic test: `createMicProbe({ deviceId, audioSettings })`, `.start()`,
   poll `.readLevels()` on an interval, `.stop()` when done. Feed each `readLevels()` result through
   `describeLevels()` then `stabilizeMeterDisplay({ previous, described })` and render `display.*`
   onto your own bar/label elements (`display.rmsPercent`, `display.peakPercent`, `display.text`,
   `display.clipping`).
5. For real-time conditioning on the capture path: `createAudioConditioner({ audioContextFactory,
   settings, onDiagnostics, onSustainedCondition })`, then `.connect(rawStream)` to get back a
   conditioned (or, on failure, the original) `MediaStream`, `.update(nextSettings)` on a live
   settings change, `.close()` on teardown.
6. Persisting mic calibration across sessions (optional): store whatever `createMicProbe`'s
   `.getCalibration()` returns, keyed by device id, and validate it on read with
   `isMicCalibrationValid({ calibration, deviceId, devices })` before trusting it.
7. Write your own render function analogous to meeting-companion's `renderAudioLevelMeter` in
   `public/controller/runtime.js` — that's the reference implementation for wiring steps 4 and the
   settings pane together, even though it doesn't move with the module.

None of this module touches `ctx.state`, an operator rail, or a transcription driver — the
consuming app owns all of that glue, same as meeting-companion's own `runtime.js` does today.
