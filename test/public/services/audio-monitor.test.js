import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listAudioInputs,
  resolveDeviceId,
  deviceIdConstraint,
  describeLevels,
  METER_FLOOR_DBFS
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
