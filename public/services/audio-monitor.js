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
