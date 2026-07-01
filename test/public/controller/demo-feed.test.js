import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDemoModeEnabled,
  startDemoFeed
} from '../../../public/controller/demo-feed.js';

test('demo mode is enabled only when the query string asks for it', () => {
  assert.equal(isDemoModeEnabled('?demo=1'), true);
  assert.equal(isDemoModeEnabled('?demo=true&foo=bar'), true);
  assert.equal(isDemoModeEnabled('?foo=bar'), false);
  assert.equal(isDemoModeEnabled(''), false);
});

test('demo feed schedules a readable sequence of transcript items', () => {
  const calls = [];
  const cleared = [];
  const runtime = {
    setMode(mode) {
      calls.push(['mode', mode]);
    },
    addLine(text, options) {
      calls.push(['line', text, options]);
    }
  };
  const scheduled = [];

  const stop = startDemoFeed(runtime, {
    setTimeoutFn(fn, delay) {
      scheduled.push({ fn, delay });
      return scheduled.length - 1;
    },
    clearTimeoutFn(handle) {
      cleared.push(handle);
    }
  });

  assert.equal(scheduled.length >= 4, true);

  scheduled[0].fn();
  scheduled[1].fn();
  scheduled[2].fn();

  assert.deepEqual(calls[0], ['mode', 'speaker']);
  assert.deepEqual(calls[1], ['line', 'A long hospital visit changed the family pace for the week.', { source: 'ai', mode: 'speaker' }]);
  assert.deepEqual(calls[2], ['mode', 'information']);
  assert.deepEqual(calls[3], ['line', 'Tuesday, 7:00 p.m., Fellowship Hall.', { source: 'ai', mode: 'information' }]);
  assert.deepEqual(calls[4], ['mode', 'song']);
  assert.deepEqual(calls[5], ['line', 'Hymn 198, ready to sing.', { source: 'ai', mode: 'song' }]);

  stop();
  assert.equal(cleared.length, scheduled.length);
});
