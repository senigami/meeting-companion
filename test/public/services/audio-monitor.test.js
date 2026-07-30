import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listAudioInputs,
  resolveDeviceId,
  deviceIdConstraint,
  describeLevels,
  evaluateMicReadiness,
  METER_FLOOR_DBFS,
  isMicCalibrationValid,
  describeMicCalibration,
  MIC_CALIBRATION_MAX_AGE_MS,
  stabilizeMeterDisplay,
  CLIP_DWELL_MS,
  TEXT_DEBOUNCE_MS,
  PEAK_HOLD_MS,
  PEAK_DECAY_MS
} from '../../../public/services/audio-monitor.js';

function fakeMediaDevices(devices) {
  return { enumerateDevices: async () => devices };
}

// --- Device listing --------------------------------------------------------

test('listAudioInputs keeps only audio inputs', async () => {
  const devices = await listAudioInputs(
    fakeMediaDevices([
      { kind: 'audioinput', deviceId: 'a', label: 'USB Interface' },
      { kind: 'videoinput', deviceId: 'b', label: 'FaceTime Camera' },
      { kind: 'audiooutput', deviceId: 'c', label: 'Speakers' }
    ])
  );
  assert.deepEqual(devices, [{ deviceId: 'a', label: 'USB Interface' }]);
});

test('listAudioInputs names unlabelled devices instead of showing a blank option', async () => {
  // This is the real pre-permission case: the browser returns the tracks but withholds the labels.
  const devices = await listAudioInputs(
    fakeMediaDevices([
      { kind: 'audioinput', deviceId: 'a', label: '' },
      { kind: 'audioinput', deviceId: 'b', label: '   ' }
    ])
  );
  assert.deepEqual(devices.map((d) => d.label), ['Microphone 1', 'Microphone 2']);
});

test('listAudioInputs degrades to an empty list rather than throwing', async () => {
  assert.deepEqual(await listAudioInputs(undefined), []);
  assert.deepEqual(await listAudioInputs({}), []);
  assert.deepEqual(
    await listAudioInputs({
      enumerateDevices: async () => {
        throw new Error('permission dismissed');
      }
    }),
    []
  );
  assert.deepEqual(await listAudioInputs({ enumerateDevices: async () => null }), []);
});

// --- Stale saved device ---------------------------------------------------

test('resolveDeviceId keeps a saved device that is still present', () => {
  const devices = [{ deviceId: 'a' }, { deviceId: 'b' }];
  assert.equal(resolveDeviceId(devices, 'b'), 'b');
});

test('resolveDeviceId falls back to the system default when the saved device is gone', () => {
  // The unplugged-USB-interface case. Passing a missing id to getUserMedia as an exact constraint
  // throws OverconstrainedError and would take the whole listening start down with it.
  assert.equal(resolveDeviceId([{ deviceId: 'a' }], 'gone'), '');
  assert.equal(resolveDeviceId([], 'a'), '');
  assert.equal(resolveDeviceId(undefined, 'a'), '');
  assert.equal(resolveDeviceId([{ deviceId: 'a' }], ''), '');
});

test('deviceIdConstraint says nothing at all when no device is chosen', () => {
  assert.deepEqual(deviceIdConstraint(''), {});
  assert.deepEqual(deviceIdConstraint(undefined), {});
  assert.deepEqual(deviceIdConstraint('a'), { deviceId: { exact: 'a' } });
});

// --- Meter presentation ---------------------------------------------------

test('describeLevels distinguishes not-measuring from silence', () => {
  const idle = describeLevels(null);
  assert.equal(idle.measured, false);
  assert.equal(idle.text, 'Not measuring');
  assert.equal(idle.rmsPercent, 0);

  const silent = describeLevels({ rms_dbfs: -80, peak_dbfs: -75, classification: 'IDLE' });
  assert.equal(silent.measured, true, 'a real silent reading is still a reading');
  assert.equal(silent.text, 'No sound');
});

test('describeLevels maps the dBFS range onto the bar and clamps below the floor', () => {
  assert.equal(describeLevels({ rms_dbfs: 0, peak_dbfs: 0, classification: 'CLIPPING' }).rmsPercent, 100);
  assert.equal(describeLevels({ rms_dbfs: METER_FLOOR_DBFS, peak_dbfs: -60, classification: 'IDLE' }).rmsPercent, 0);
  assert.equal(describeLevels({ rms_dbfs: -30, peak_dbfs: -20, classification: 'GOOD' }).rmsPercent, 50);
  assert.equal(describeLevels({ rms_dbfs: -200, peak_dbfs: -200, classification: 'IDLE' }).rmsPercent, 0);
});

test('describeLevels uses plain words, never the internal classification names', () => {
  const words = ['IDLE', 'LOW', 'GOOD', 'HIGH', 'CLIPPING'].map(
    (classification) => describeLevels({ rms_dbfs: -20, peak_dbfs: -10, classification }).text
  );
  assert.deepEqual(words, ['No sound', 'Too quiet', 'Good', 'Loud', 'Too loud']);
});

test('describeLevels tolerates an unknown classification', () => {
  const described = describeLevels({ rms_dbfs: -20, peak_dbfs: -10, classification: 'WEIRD' });
  assert.equal(described.classification, 'IDLE');
  assert.equal(described.text, 'No sound');
});

test('describeLevels signs the gain so the direction is readable', () => {
  assert.equal(describeLevels({ rms_dbfs: -20, peak_dbfs: -10, classification: 'GOOD', gain_db: 6 }).gainText, '+6.0 dB');
  assert.equal(describeLevels({ rms_dbfs: -20, peak_dbfs: -10, classification: 'GOOD', gain_db: -6 }).gainText, '-6.0 dB');
  assert.equal(describeLevels({ rms_dbfs: -20, peak_dbfs: -10, classification: 'GOOD' }).gainText, '');
});

// --- Mic readiness (docs/backlog.md item 1: the Ready check row must reflect real state) --------

test('evaluateMicReadiness reads not-ready on denied permission, even with a real device listed', () => {
  const result = evaluateMicReadiness({
    permissionState: 'denied',
    devices: [{ deviceId: 'abc123', label: 'USB Mic' }]
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'denied');
});

test('evaluateMicReadiness reads not-ready on an empty device list', () => {
  const result = evaluateMicReadiness({ permissionState: 'granted', devices: [] });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'no-device');
});

test('evaluateMicReadiness reads not-ready when the only device is the pre-permission blank-id placeholder', () => {
  const result = evaluateMicReadiness({
    permissionState: 'prompt',
    devices: [{ deviceId: '', label: 'Microphone 1' }]
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'no-device');
});

test('evaluateMicReadiness reads ready with granted permission and a real device', () => {
  const result = evaluateMicReadiness({
    permissionState: 'granted',
    devices: [{ deviceId: 'abc123', label: 'USB Mic' }]
  });
  assert.equal(result.ready, true);
  assert.equal(result.reason, null);
});

test('evaluateMicReadiness reads ready on an unknown permission state (permissions.query threw) as long as a real device is present', () => {
  const result = evaluateMicReadiness({
    permissionState: 'unknown',
    devices: [{ deviceId: 'abc123', label: 'USB Mic' }]
  });
  assert.equal(result.ready, true);
});

// --- Mic calibration validity/staleness (backlog #7/#10) -------------------

test('isMicCalibrationValid accepts a fresh calibration for a device still in the list', () => {
  const calibration = { gateDbfs: -44, ambientFloorDbfs: -50, measuredAt: 1000 };
  const result = isMicCalibrationValid({
    calibration,
    deviceId: 'mic-1',
    devices: [{ deviceId: 'mic-1', label: 'USB Mic' }],
    nowMs: 1000 + 60000
  });
  assert.equal(result, true);
});

test('isMicCalibrationValid rejects a calibration older than MIC_CALIBRATION_MAX_AGE_MS', () => {
  const calibration = { gateDbfs: -44, ambientFloorDbfs: -50, measuredAt: 0 };
  const result = isMicCalibrationValid({
    calibration,
    deviceId: 'mic-1',
    devices: [{ deviceId: 'mic-1', label: 'USB Mic' }],
    nowMs: MIC_CALIBRATION_MAX_AGE_MS + 1
  });
  assert.equal(result, false);
});

test('isMicCalibrationValid rejects a calibration right at the age boundary but accepts just under it', () => {
  const calibration = { gateDbfs: -44, ambientFloorDbfs: -50, measuredAt: 0 };
  const devices = [{ deviceId: 'mic-1', label: 'USB Mic' }];
  assert.equal(isMicCalibrationValid({ calibration, deviceId: 'mic-1', devices, nowMs: MIC_CALIBRATION_MAX_AGE_MS }), true);
  assert.equal(isMicCalibrationValid({ calibration, deviceId: 'mic-1', devices, nowMs: MIC_CALIBRATION_MAX_AGE_MS + 1 }), false);
});

test('isMicCalibrationValid rejects a calibration for a device that is no longer in the device list', () => {
  const calibration = { gateDbfs: -44, ambientFloorDbfs: -50, measuredAt: 1000 };
  const result = isMicCalibrationValid({
    calibration,
    deviceId: 'mic-unplugged',
    devices: [{ deviceId: 'mic-1', label: 'USB Mic' }],
    nowMs: 1000
  });
  assert.equal(result, false, 'same stale-id hazard resolveDeviceId already guards against');
});

test('isMicCalibrationValid accepts the system-default device id ("") regardless of the device list', () => {
  const calibration = { gateDbfs: -44, ambientFloorDbfs: -50, measuredAt: 1000 };
  const result = isMicCalibrationValid({ calibration, deviceId: '', devices: [], nowMs: 1000 });
  assert.equal(result, true);
});

test('isMicCalibrationValid rejects a default-device (\'\') calibration once the device it actually resolved to has disappeared', () => {
  // Sign-off blocker (2026-07-30): resolveDeviceId(devices, '') is always '' for the system-default
  // id, so a direct-id check can never catch a default that quietly changed hardware. Regression
  // guard: calibrate while a headset is system default (resolvedDeviceId records the granted
  // track's real id), unplug it -- the calibration must be discarded, not trusted for 6 more hours.
  const calibration = { gateDbfs: -49, ambientFloorDbfs: -55, measuredAt: 1000, resolvedDeviceId: 'headset-1' };
  const result = isMicCalibrationValid({
    calibration,
    deviceId: '',
    devices: [{ deviceId: 'builtin-mic', label: 'Built-in Microphone' }],
    nowMs: 1000
  });
  assert.equal(result, false, 'the headset behind the old default is gone; built-in mic taking over "default" must not inherit its calibration');
});

test('isMicCalibrationValid accepts a default-device calibration while the resolved device is still present', () => {
  const calibration = { gateDbfs: -49, ambientFloorDbfs: -55, measuredAt: 1000, resolvedDeviceId: 'headset-1' };
  const result = isMicCalibrationValid({
    calibration,
    deviceId: '',
    devices: [{ deviceId: 'headset-1', label: 'Headset Mic' }],
    nowMs: 1000
  });
  assert.equal(result, true);
});

test('isMicCalibrationValid rejects null/incomplete calibration data', () => {
  assert.equal(isMicCalibrationValid({ calibration: null, deviceId: '', devices: [] }), false);
  assert.equal(isMicCalibrationValid({ calibration: { gateDbfs: -44 }, deviceId: '', devices: [] }), false, 'missing measuredAt');
});

test('describeMicCalibration reports measured:false when calibration never completed', () => {
  assert.deepEqual(describeMicCalibration(null), { measured: false, tooNoisy: false, text: '' });
  assert.deepEqual(describeMicCalibration({ ambientFloorDbfs: -Infinity }), { measured: false, tooNoisy: false, text: '' });
});

test('describeMicCalibration surfaces plain-language copy for a too-noisy verdict, and stays silent otherwise', () => {
  const noisy = describeMicCalibration({ ambientFloorDbfs: -30, tooNoisy: true, gateDbfs: null });
  assert.equal(noisy.measured, true);
  assert.equal(noisy.tooNoisy, true);
  assert.match(noisy.text, /too noisy/i);
  assert.match(noisy.text, /headset|quieter/i);

  const fine = describeMicCalibration({ ambientFloorDbfs: -60, tooNoisy: false, gateDbfs: -54 });
  assert.equal(fine.tooNoisy, false);
  assert.equal(fine.text, '', 'no verdict text needed when the mic calibrated cleanly');
});

// --- stabilizeMeterDisplay: latch, immediate-on/delayed-off, and anti-flicker settling ----------

function levels(rms_dbfs, classification, peak_dbfs = rms_dbfs) {
  return { rms_dbfs, peak_dbfs, classification };
}

test('stabilizeMeterDisplay: a single CLIPPING tick keeps the warning visible across subsequent non-clipping ticks for the full dwell', () => {
  let t = 1000;
  let step = stabilizeMeterDisplay({ previous: null, described: describeLevels(levels(0, 'CLIPPING')), nowMs: t });
  assert.equal(step.display.classification, 'CLIPPING');
  assert.equal(step.display.clipping, true);
  assert.match(step.display.text, /too loud/i);

  // A single non-clipping tick immediately after must NOT clear the warning.
  t += 50;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-40, 'GOOD')), nowMs: t });
  assert.equal(step.display.classification, 'CLIPPING', 'still latched right after the clip');

  // Still latched just before the dwell expires.
  t = 1000 + CLIP_DWELL_MS - 10;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-40, 'GOOD')), nowMs: t });
  assert.equal(step.display.classification, 'CLIPPING', 'latched right up to the dwell boundary');

  // Released once the dwell has fully elapsed -- the GOOD candidate has already been persisting
  // (tracked silently) throughout the latch, well past its own debounce window, so release is
  // immediate rather than making the reader wait a second debounce on top of the dwell.
  t = 1000 + CLIP_DWELL_MS + 10;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-40, 'GOOD')), nowMs: t });
  assert.equal(step.display.classification, 'GOOD', 'released once the dwell elapses, since GOOD already settled during it');
});

test('stabilizeMeterDisplay: a new clip extends the dwell so a sustained clipping run never releases mid-problem', () => {
  let t = 0;
  let step = stabilizeMeterDisplay({ previous: null, described: describeLevels(levels(0, 'CLIPPING')), nowMs: t });
  t += CLIP_DWELL_MS - 5;
  // Clip again just before the first dwell would have expired.
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(0, 'CLIPPING')), nowMs: t });
  // Advance past where the FIRST dwell would have expired, but not the second.
  t += 10;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-40, 'GOOD')), nowMs: t });
  assert.equal(step.display.classification, 'CLIPPING', 'second clip re-armed the dwell');
});

test('stabilizeMeterDisplay: CLIPPING appears immediately even mid-debounce of another pending change', () => {
  let t = 0;
  let step = stabilizeMeterDisplay({ previous: null, described: describeLevels(levels(-50, 'LOW')), nowMs: t });
  t += 10;
  // Reading starts drifting toward HIGH but hasn't settled yet.
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-10, 'HIGH')), nowMs: t });
  assert.equal(step.display.classification, 'LOW', 'HIGH has not persisted long enough to settle yet');
  t += 10;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(0, 'CLIPPING')), nowMs: t });
  assert.equal(step.display.classification, 'CLIPPING', 'a worsening CLIPPING tick is never delayed by debouncing');
});

test('stabilizeMeterDisplay: rapid non-clip oscillation does not flicker the displayed word', () => {
  let t = 0;
  let step = stabilizeMeterDisplay({ previous: null, described: describeLevels(levels(-70, 'IDLE')), nowMs: t });
  assert.equal(step.display.classification, 'IDLE');

  // Oscillate IDLE/LOW every 50ms (the real meter interval) -- much faster than TEXT_DEBOUNCE_MS.
  for (let i = 0; i < 6; i++) {
    t += 50;
    const cls = i % 2 === 0 ? 'LOW' : 'IDLE';
    step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-58, cls)), nowMs: t });
  }
  assert.equal(step.display.classification, 'IDLE', 'never settled on the flickering LOW because it kept getting interrupted');

  // Now let it actually settle on LOW.
  t += 50;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-58, 'LOW')), nowMs: t });
  t += TEXT_DEBOUNCE_MS + 10;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-58, 'LOW')), nowMs: t });
  assert.equal(step.display.classification, 'LOW', 'settles once LOW actually persists past the debounce window');
});

test('stabilizeMeterDisplay: a pending classification change must NOT be shown before TEXT_DEBOUNCE_MS has elapsed, and MUST be shown once it has', () => {
  let t = 0;
  let step = stabilizeMeterDisplay({ previous: null, described: describeLevels(levels(-70, 'IDLE')), nowMs: t });
  assert.equal(step.display.classification, 'IDLE');

  // LOW starts persisting from here. Thresholds below are deliberately absolute milliseconds (not
  // derived from the imported TEXT_DEBOUNCE_MS) -- deriving the "before" boundary from the constant
  // itself would shift in lockstep with any shrinkage of the constant and never catch a regression.
  // A reader cannot be made to wait less than ~400ms and still call this "settled reading pace", so
  // pin against that real-world floor.
  t += 10;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-58, 'LOW')), nowMs: t });
  const candidateSince = t;
  assert.equal(step.display.classification, 'IDLE', 'must not settle immediately');

  // Comfortably short of the real 600ms threshold: still must not have settled onto LOW.
  t = candidateSince + 400;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-58, 'LOW')), nowMs: t });
  assert.equal(step.display.classification, 'IDLE', 'must not settle before a real readability-length debounce has elapsed');

  // Past the real 600ms threshold: must now have settled onto LOW.
  t = candidateSince + TEXT_DEBOUNCE_MS + 10;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-58, 'LOW')), nowMs: t });
  assert.equal(step.display.classification, 'LOW', 'must settle once the debounce threshold has elapsed');
});

test('stabilizeMeterDisplay: the rms bar itself stays live/instantaneous even while the text is latched or debounced', () => {
  let t = 0;
  let step = stabilizeMeterDisplay({ previous: null, described: describeLevels(levels(0, 'CLIPPING', 0)), nowMs: t });
  t += 50;
  const described = describeLevels(levels(-40, 'GOOD', -40));
  step = stabilizeMeterDisplay({ previous: step.state, described, nowMs: t });
  assert.equal(step.display.classification, 'CLIPPING', 'text still latched');
  assert.equal(step.display.rmsPercent, described.rmsPercent, 'bar reflects the live reading, not the latched one');
});

test('stabilizeMeterDisplay: not-measuring resets latch/debounce/peak state immediately', () => {
  let t = 0;
  let step = stabilizeMeterDisplay({ previous: null, described: describeLevels(levels(0, 'CLIPPING')), nowMs: t });
  t += 50;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(null), nowMs: t });
  assert.equal(step.display.measured, false);
  assert.equal(step.display.text, 'Not measuring');
  assert.equal(step.display.clipping, false);
  assert.equal(step.state, null);
});

test('stabilizeMeterDisplay: peak marker holds at its max before easing down, rather than snapping', () => {
  let t = 0;
  let step = stabilizeMeterDisplay({ previous: null, described: describeLevels(levels(-20, 'GOOD', -5)), nowMs: t });
  const peakedPercent = step.display.peakPercent;

  // Live peak drops right away -- held value should not follow instantly.
  t += 50;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-20, 'GOOD', -40)), nowMs: t });
  assert.equal(step.display.peakPercent, peakedPercent, 'holds at the max through the hold window');

  // Still held just before PEAK_HOLD_MS elapses.
  t = PEAK_HOLD_MS - 10;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-20, 'GOOD', -40)), nowMs: t });
  assert.equal(step.display.peakPercent, peakedPercent, 'still held right up to the hold boundary');

  // Partway through the decay window it should have eased down, not snapped.
  t = PEAK_HOLD_MS + PEAK_DECAY_MS / 2;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-20, 'GOOD', -40)), nowMs: t });
  assert.ok(step.display.peakPercent < peakedPercent, 'eased down from the held max');
  assert.ok(step.display.peakPercent > describeLevels(levels(-20, 'GOOD', -40)).peakPercent, 'not fully decayed yet');

  // Fully decayed to the live peak after PEAK_DECAY_MS has elapsed.
  t = PEAK_HOLD_MS + PEAK_DECAY_MS + 10;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-20, 'GOOD', -40)), nowMs: t });
  assert.equal(step.display.peakPercent, describeLevels(levels(-20, 'GOOD', -40)).peakPercent, 'fully eased to the live peak');
});

test('stabilizeMeterDisplay: a rising peak tracks instantly (only the fall is held/eased)', () => {
  let t = 0;
  let step = stabilizeMeterDisplay({ previous: null, described: describeLevels(levels(-20, 'GOOD', -40)), nowMs: t });
  t += 50;
  step = stabilizeMeterDisplay({ previous: step.state, described: describeLevels(levels(-20, 'GOOD', -5)), nowMs: t });
  assert.equal(step.display.peakPercent, describeLevels(levels(-20, 'GOOD', -5)).peakPercent, 'a new higher peak shows immediately');
});
