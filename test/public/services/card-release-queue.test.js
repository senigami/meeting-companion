import test from 'node:test';
import assert from 'node:assert/strict';

import { createCardReleaseQueue } from '../../../public/services/card-release-queue.js';

// A hand-driven clock. Real timers would make these tests slow and flaky, and the point of the
// queue is WHEN things happen -- so time has to be something the test moves, not something it waits
// for.
function fakeClock() {
  let now = 0;
  let seq = 0;
  const scheduled = new Map();
  return {
    setTimeoutFn(fn, ms) {
      const id = ++seq;
      scheduled.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeoutFn(id) {
      scheduled.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      let guard = 0;
      for (;;) {
        const due = [...scheduled.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        if (++guard > 1000) throw new Error('runaway timer loop');
        const [id, entry] = due;
        scheduled.delete(id);
        now = entry.at;
        entry.fn();
      }
      now = target;
    },
    pendingTimers: () => scheduled.size
  };
}

function harness({ intervalMs = 5000 } = {}) {
  const clock = fakeClock();
  const released = [];
  const queue = createCardReleaseQueue({
    intervalMs,
    onRelease: (item) => released.push(item),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn
  });
  return { clock, released, queue };
}

test('the first card of an idle queue goes up immediately, not after one interval', () => {
  const { released, queue } = harness();
  queue.enqueue(['a', 'b', 'c']);
  assert.deepEqual(released, ['a'], 'making the operator wait 5s for already-spoken words is added latency');
});

test('the rest follow one per interval, in order', () => {
  const { clock, released, queue } = harness({ intervalMs: 5000 });
  queue.enqueue(['a', 'b', 'c']);

  clock.advance(4999);
  assert.deepEqual(released, ['a'], 'nothing may arrive early');

  clock.advance(1);
  assert.deepEqual(released, ['a', 'b']);

  clock.advance(5000);
  assert.deepEqual(released, ['a', 'b', 'c']);
});

test('a second result queues behind the first instead of overtaking it', () => {
  // Out-of-order cards would rewrite somebody's testimony into a different testimony.
  const { clock, released, queue } = harness();
  queue.enqueue(['first-1', 'first-2']);
  queue.enqueue(['second-1']);

  clock.advance(60000);
  assert.deepEqual(released, ['first-1', 'first-2', 'second-1']);
});

test('a card arriving while the queue is idle-but-cooling does not jump the cadence', () => {
  // The tick after the last card is deliberately still scheduled, so two summarize results landing
  // a second apart do not flash back to back.
  const { clock, released, queue } = harness({ intervalMs: 5000 });
  queue.enqueue(['a']);
  assert.deepEqual(released, ['a']);

  clock.advance(1000);
  queue.enqueue(['b']);
  assert.deepEqual(released, ['a'], 'b must wait out the remaining cooldown');

  clock.advance(4000);
  assert.deepEqual(released, ['a', 'b']);
});

test('clear drops everything still waiting, so it cannot land on a screen just emptied', () => {
  const { clock, released, queue } = harness();
  queue.enqueue(['a', 'b', 'c', 'd']);
  assert.deepEqual(released, ['a']);

  queue.clear();
  assert.equal(queue.pendingCount(), 0);

  clock.advance(60000);
  assert.deepEqual(released, ['a'], 'nothing queued may survive a Clear');
});

test('the queue goes fully idle once drained, leaving no timer running', () => {
  const { clock, queue } = harness();
  queue.enqueue(['a', 'b']);
  clock.advance(60000);
  assert.equal(queue.pendingCount(), 0);
  assert.equal(clock.pendingTimers(), 0, 'a leaked repeating timer would tick for the whole meeting');
});

test('enqueueing nothing does not start a timer or release an empty card', () => {
  const { clock, released, queue } = harness();
  queue.enqueue([]);
  queue.enqueue([null, undefined]);
  assert.deepEqual(released, []);
  assert.equal(clock.pendingTimers(), 0);
});

test('stop halts the cadence without discarding what was already shown', () => {
  const { clock, released, queue } = harness();
  queue.enqueue(['a', 'b', 'c']);
  queue.stop();
  clock.advance(60000);
  assert.deepEqual(released, ['a']);
  assert.equal(clock.pendingTimers(), 0);
});
