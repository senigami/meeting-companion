// Mic picker + level meter (docs/backlog.md item 1).
//
// This module is deliberately pure and DOM-free: it turns the browser's device list and the
// conditioner's readLevels() output into plain data a view can render. Nothing here touches
// getUserMedia, an AudioContext, or the document, which is the only reason it can be tested at all --
// the conditioner itself needs real Web Audio and so its behavior can only be verified in a browser.
//
// No dependency was added for any of this. enumerateDevices() plus a deviceId constraint IS the
// standard browser path for source selection, and readLevels() already returns everything a meter
// needs. An audio library would have brought its own AudioContext graph to sit beside ours.

export const METER_FLOOR_DBFS = -60;
export const METER_CEILING_DBFS = 0;

// Shown when a track exists but the browser withholds its label, which it does until microphone
// permission has been granted at least once. An empty <option> looks broken; "Microphone 2" does not.
function fallbackLabel(index) {
  return `Microphone ${index + 1}`;
}

/**
 * Read the available audio input devices.
 *
 * Returns [] rather than throwing on any failure -- an unavailable device list must degrade to
 * "you get the system default", never to a broken settings pane before a meeting.
 */
export async function listAudioInputs(mediaDevices) {
  if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') return [];

  let devices;
  try {
    devices = await mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
  if (!Array.isArray(devices)) return [];

  return devices
    .filter((device) => device && device.kind === 'audioinput')
    .map((device, index) => ({
      deviceId: typeof device.deviceId === 'string' ? device.deviceId : '',
      label: (device.label || '').trim() || fallbackLabel(index)
    }));
}

/**
 * Resolve the device the app should actually open.
 *
 * A remembered deviceId goes stale the moment a USB interface is unplugged, so a saved id that is no
 * longer in the list falls back to '' (system default) instead of being passed to getUserMedia, where
 * an exact-match constraint on a missing device throws OverconstrainedError and takes the whole
 * listening start with it.
 */
export function resolveDeviceId(devices, preferredId) {
  if (!preferredId) return '';
  const found = (devices || []).some((device) => device && device.deviceId === preferredId);
  return found ? preferredId : '';
}

/**
 * The deviceId fragment to merge into a getUserMedia audio constraint. Empty object means
 * "say nothing and let the browser pick", which is not the same as asking for a device named ''.
 */
export function deviceIdConstraint(deviceId) {
  if (!deviceId) return {};
  return { deviceId: { exact: deviceId } };
}

/**
 * The three browser-level getUserMedia audio constraints (AGC/noise-suppression/echo-cancel),
 * built from the operator's saved audioSettings the exact same way in every caller. This is the
 * single definition backing both the real transcription path (transcription/openai.js) and the
 * Settings mic test probe (audio-processing.js#createMicProbe) -- they must never drift apart, or
 * a pre-meeting mic check stops predicting what the meeting will actually sound like.
 */
export function browserAudioConstraints(audioSettings = {}) {
  return {
    autoGainControl: audioSettings.audioBrowserAgc !== false,
    noiseSuppression: audioSettings.audioBrowserNoiseSuppression === true,
    echoCancellation: audioSettings.audioBrowserEchoCancel === true
  };
}

/**
 * Turn a permission-state string and a device list into a real readiness verdict.
 *
 * Pure and DOM-free like the rest of this module, so it can be unit tested without a browser --
 * only the caller (runtime.js) touches navigator.permissions/mediaDevices. `denied` always wins
 * regardless of what the device list says (a stale non-empty list must not paper over a user who
 * just revoked access). Otherwise readiness requires at least one device with a real, non-blank
 * deviceId: enumerateDevices() returns a single blank-label, blank-id placeholder before permission
 * is ever granted, and listAudioInputs's fallbackLabel ("Microphone 1") makes that placeholder look
 * like a real option -- checking deviceId (never substituted) rather than label or array length is
 * what keeps that placeholder from reading as a working microphone.
 */
export function evaluateMicReadiness({ permissionState, devices } = {}) {
  const hasRealDevice = Array.isArray(devices) && devices.some((device) => Boolean(device && device.deviceId));
  if (permissionState === 'denied') return { ready: false, reason: 'denied' };
  if (!hasRealDevice) return { ready: false, reason: 'no-device' };
  return { ready: true, reason: null };
}

// A saved calibration goes stale for the same reason a saved deviceId does (resolveDeviceId above),
// plus one more: room noise itself changes between an empty room and a full one, not just between
// mic tests. 6 hours covers "settings reopened later the same day" while forcing a fresh measurement
// across any real gap -- and recalibration is cheap (~1.5s, automatic on every mic test), so there is
// no cost to erring toward "measure again" over "trust an old number."
export const MIC_CALIBRATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Decide whether a persisted per-device calibration is still trustworthy.
 *
 * Two independent invalidation rules, either one is enough to discard it: the device it was
 * measured on is no longer in the current device list (same stale-id hazard resolveDeviceId
 * guards against -- a calibration for a device that no longer exists is calibration for nothing),
 * or it is older than MIC_CALIBRATION_MAX_AGE_MS. Pure and DOM-free like the rest of this module;
 * the caller owns reading/writing localStorage.
 */
export function isMicCalibrationValid({ calibration, deviceId, devices, nowMs = Date.now(), maxAgeMs = MIC_CALIBRATION_MAX_AGE_MS } = {}) {
  if (!calibration || !Number.isFinite(calibration.measuredAt)) return false;
  const id = deviceId || '';
  if (id) {
    if (resolveDeviceId(devices, id) !== id) return false;
  } else {
    // '' (system default) is a moving target by definition: resolveDeviceId(devices, '') is always
    // '' regardless of what the device list contains, so the direct-id check above can never catch
    // a default that has silently changed hardware (e.g. a headset unplugged, promoting the
    // built-in mic to default). resolvedDeviceId -- the real device the browser granted at
    // calibration time (track.getSettings().deviceId, recorded in audio-processing.js) -- is the
    // only identity available for "default" and stands in for the direct check. Older calibrations
    // written before this field existed have no resolvedDeviceId to check and fall back to the
    // age-only rule below, same as before.
    if (calibration.resolvedDeviceId && resolveDeviceId(devices, calibration.resolvedDeviceId) !== calibration.resolvedDeviceId) {
      return false;
    }
  }
  return nowMs - calibration.measuredAt <= maxAgeMs;
}

// Plain-language copy for the too-noisy verdict, matching CLASSIFICATION_TEXT's register: written
// for a helper under time pressure who is not an audio engineer, so it names the fix (a headset or a
// quieter spot) rather than describing dBFS math.
const TOO_NOISY_TEXT = 'This microphone is too noisy in this room to read levels reliably. Try a headset, or move somewhere quieter.';

/**
 * Turn a mic probe's calibration result into a renderable verdict. `measured: false` when
 * calibration has not finished (or never ran) -- same "don't draw a reading that isn't there"
 * discipline describeLevels applies for INV-10.
 */
export function describeMicCalibration(calibration) {
  if (!calibration || !Number.isFinite(calibration.ambientFloorDbfs)) {
    return { measured: false, tooNoisy: false, text: '' };
  }
  if (calibration.tooNoisy) {
    return { measured: true, tooNoisy: true, text: TOO_NOISY_TEXT };
  }
  return { measured: true, tooNoisy: false, text: '' };
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function dbToPercent(db) {
  if (!Number.isFinite(db)) return 0;
  const span = METER_CEILING_DBFS - METER_FLOOR_DBFS;
  return clampPercent(((db - METER_FLOOR_DBFS) / span) * 100);
}

// Plain-language words, because this is read under time pressure by a helper who is not an audio
// engineer. The classification names (IDLE/LOW/GOOD/HIGH/CLIPPING) are the conditioner's internal
// vocabulary and are not shown.
const CLASSIFICATION_TEXT = {
  IDLE: 'No sound',
  LOW: 'Too quiet',
  GOOD: 'Good',
  HIGH: 'Loud',
  CLIPPING: 'Too loud'
};

/**
 * Turn one readLevels() sample into something renderable.
 *
 * Reports `measured: false` when there is nothing to show -- no conditioner running yet -- so the
 * view can say "not measuring" rather than draw an empty bar that looks like silence. A meter that
 * reads zero when it is simply not connected is the INV-10 failure in miniature: the surface would be
 * telling the operator their microphone is dead when in fact nobody asked it anything.
 */
export function describeLevels(levels) {
  if (!levels || !Number.isFinite(levels.rms_dbfs)) {
    return {
      measured: false,
      text: 'Not measuring',
      classification: 'IDLE',
      rmsPercent: 0,
      peakPercent: 0,
      speaking: false,
      clipCount: 0,
      gainText: ''
    };
  }

  const classification = CLASSIFICATION_TEXT[levels.classification] ? levels.classification : 'IDLE';
  const gainDb = Number(levels.gain_db);

  return {
    measured: true,
    text: CLASSIFICATION_TEXT[classification],
    classification,
    rmsPercent: dbToPercent(levels.rms_dbfs),
    peakPercent: dbToPercent(levels.peak_dbfs),
    speaking: levels.speaking === true,
    clipCount: Number.isFinite(levels.clipCount) ? levels.clipCount : 0,
    // Signed on purpose: "+6 dB" and "-6 dB" mean opposite things to whoever is setting a gain knob,
    // and an unsigned "6 dB" hides which way the AGC is currently pulling.
    gainText: Number.isFinite(gainDb) ? `${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB` : ''
  };
}

// --- Reading-load stabilizer for the meter's TEXT and peak marker (docs/backlog.md item 1, the
// 2026-07-30 mic test). describeLevels() above is a snapshot of one tick; a raw tick-by-tick replay
// of it flickers between classifications every AUDIO_LEVEL_METER_INTERVAL_MS, which is fine for a
// live bar but not for words a slow reader is reading, and it made a real "Too loud" warning
// disappear before Steve (Deaf, low vision, slow reader) could read it. This stays pure and DOM-free
// like describeLevels -- it takes the previous stabilizer state plus a fresh describeLevels() result
// and returns what the DOM should show plus the next state to carry forward. The caller (runtime.js)
// owns nothing but storing that state between ticks.
//
// Two asymmetric rules, per Ansel's readability ruling:
//   1. CLIPPING is a worsening state and always wins the tick it appears on -- the word and the red
//      class must be immediate, never delayed by debouncing. Once shown, it then LATCHES for
//      CLIP_DWELL_MS so a slow reader has time to actually read "Too loud" even if the clip was a
//      single instant. Every new clip tick while already latched extends the dwell from that tick,
//      so a sustained clipping run never releases mid-problem.
//   2. Any other classification change (the IDLE/LOW/GOOD/HIGH flicker Steve also saw) must persist
//      for TEXT_DEBOUNCE_MS of consecutive ticks before the displayed word changes. This is the
//      "only the RELEASE is delayed" rule generalized to non-clip noise: appearing is free, settling
//      into a new displayed word takes sustained agreement.
// Values are chosen for a slow reader glancing at a settings pane, not a developer watching a log:
// long enough to read four short words, short enough that the meter still feels responsive.
export const CLIP_DWELL_MS = 3000;
export const TEXT_DEBOUNCE_MS = 600;

// Peak marker: held at its maximum for PEAK_HOLD_MS (so a brief spike is still visible after it
// passes), then eases back down to the live peak over PEAK_DECAY_MS rather than snapping instantly --
// an instant snap-down at the moment a spike ends reads as another flicker.
export const PEAK_HOLD_MS = 1500;
export const PEAK_DECAY_MS = 1000;

function emptyStabilizedDisplay() {
  return {
    measured: false,
    text: 'Not measuring',
    classification: 'IDLE',
    clipping: false,
    rmsPercent: 0,
    peakPercent: 0,
    speaking: false,
    clipCount: 0,
    gainText: ''
  };
}

/**
 * Advance the meter's stabilizer by one tick.
 *
 * `previous` is either `null` (no prior tick -- a fresh probe start) or the `.state` this function
 * returned last tick. `described` is this tick's describeLevels() output. `nowMs` is injected rather
 * than read from Date.now() so this stays unit-testable at fixed synthetic timestamps; the one real
 * call site defaults it to Date.now().
 *
 * Returns `{ display, state }`: `display` is what the DOM should render this tick (same shape as
 * describeLevels() plus a `clipping` boolean); `state` is opaque and must be passed back as
 * `previous` on the next tick (and reset to `null` whenever the probe restarts).
 */
export function stabilizeMeterDisplay({ previous, described, nowMs = Date.now() } = {}) {
  // Not measuring resets everything immediately -- no latch or debounce survives the probe
  // stopping, matching describeLevels(null)'s own "don't draw a reading that isn't there" rule.
  if (!described || described.measured === false) {
    return { display: emptyStabilizedDisplay(), state: null };
  }

  const prev = previous || null;
  const rawClassification = described.classification;
  const rawText = described.text;

  let displayedClassification;
  let displayedText;
  let clipLatchUntil = prev?.clipLatchUntil ?? 0;
  let candidateClassification = prev?.candidateClassification ?? null;
  let candidateSince = prev?.candidateSince ?? nowMs;

  const stillLatched = clipLatchUntil > nowMs;

  if (rawClassification === 'CLIPPING') {
    // Immediate: a fresh clip always shows and (re-)starts the dwell window from this tick.
    displayedClassification = 'CLIPPING';
    displayedText = rawText;
    clipLatchUntil = nowMs + CLIP_DWELL_MS;
    candidateClassification = 'CLIPPING';
    candidateSince = nowMs;
  } else if (stillLatched) {
    // Still inside the post-clip dwell: hold "Too loud" regardless of what the live reading now
    // says. Track the live classification as the pending candidate so debouncing resumes cleanly
    // (rather than restarting its clock) once the dwell actually releases.
    displayedClassification = 'CLIPPING';
    displayedText = CLASSIFICATION_TEXT.CLIPPING;
    if (rawClassification !== candidateClassification) {
      candidateClassification = rawClassification;
      candidateSince = nowMs;
    }
  } else if (!prev) {
    // First real tick with no history to debounce against -- show it, don't leave the pane blank.
    displayedClassification = rawClassification;
    displayedText = rawText;
    candidateClassification = rawClassification;
    candidateSince = nowMs;
  } else if (rawClassification === prev.displayedClassification) {
    // No change to settle towards.
    displayedClassification = prev.displayedClassification;
    displayedText = prev.displayedText;
    candidateClassification = rawClassification;
    candidateSince = rawClassification === candidateClassification ? candidateSince : nowMs;
  } else if (rawClassification === candidateClassification && nowMs - candidateSince >= TEXT_DEBOUNCE_MS) {
    // The new reading has persisted long enough to trust it -- settle the displayed word onto it.
    displayedClassification = rawClassification;
    displayedText = rawText;
  } else {
    // A new reading that hasn't persisted yet: keep showing the old word, keep the candidate clock
    // running (or start one if this is a different candidate than before).
    displayedClassification = prev.displayedClassification;
    displayedText = prev.displayedText;
    if (rawClassification !== candidateClassification) {
      candidateClassification = rawClassification;
      candidateSince = nowMs;
    }
  }

  // Peak hold: grow instantly, hold at the max for PEAK_HOLD_MS, then ease down over PEAK_DECAY_MS
  // rather than snapping straight to the live (possibly much lower) instantaneous peak.
  const rawPeakPercent = described.peakPercent;
  let peakPercent = rawPeakPercent;
  let peakHeldAt = nowMs;
  let peakHeldValue = rawPeakPercent;
  if (prev && rawPeakPercent <= prev.peakHeldValue) {
    const elapsedSinceHeld = nowMs - prev.peakHeldAt;
    if (elapsedSinceHeld < PEAK_HOLD_MS) {
      peakPercent = prev.peakHeldValue;
      peakHeldAt = prev.peakHeldAt;
      peakHeldValue = prev.peakHeldValue;
    } else {
      const decayElapsed = elapsedSinceHeld - PEAK_HOLD_MS;
      const fraction = Math.min(1, decayElapsed / PEAK_DECAY_MS);
      peakPercent = prev.peakHeldValue - (prev.peakHeldValue - rawPeakPercent) * fraction;
      peakHeldAt = prev.peakHeldAt;
      peakHeldValue = prev.peakHeldValue;
    }
  }

  return {
    display: {
      measured: true,
      text: displayedText,
      classification: displayedClassification,
      clipping: displayedClassification === 'CLIPPING',
      rmsPercent: described.rmsPercent, // the bar itself stays live/instantaneous, per Ansel's ruling
      peakPercent: clampPercent(peakPercent),
      speaking: described.speaking,
      clipCount: described.clipCount,
      gainText: described.gainText
    },
    state: {
      displayedClassification,
      displayedText,
      clipLatchUntil,
      candidateClassification,
      candidateSince,
      peakHeldAt,
      peakHeldValue
    }
  };
}
