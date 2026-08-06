// Releases cards to the display one at a time on a fixed cadence, instead of dropping a whole
// summarize result on the wall at once.
//
// Steve, 2026-08-02: a testimony now becomes four or five cards rather than one, and four cards
// appearing simultaneously is worse than one -- a slow reader loses their place. So the summarizer
// produces them in a burst and this hands them over one every few seconds.
//
// Deliberately NOT adaptive. An earlier draft sped the release up once a backlog built, to stop the
// wall drifting behind the room. Steve's call, and he is the one who has sat in these meetings:
// testimony meetings have long gaps between speakers, so any backlog drains on its own during the
// walk to the pulpit. Lag is acceptable and measurable; a card that flashes past because the queue
// decided to catch up is neither. If a real recording later shows the lag is bad, the fix is a
// number here, not a rewrite.

const DEFAULT_INTERVAL_MS = 5000;

export function createCardReleaseQueue({
  intervalMs = DEFAULT_INTERVAL_MS,
  onRelease = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  let pending = [];
  let timer = null;

  function pump() {
    timer = null;
    const next = pending.shift();
    if (next === undefined) return;
    onRelease(next);
    // Scheduled even when nothing is left, so two summarize results landing a second apart do not
    // both release instantly -- the empty tick just clears the timer. The cadence is a property of
    // the display, not of one result.
    timer = setTimeoutFn(pump, intervalMs);
  }

  return {
    // The first card of an idle queue goes up immediately: making somebody wait 5s for the opening
    // line of a testimony that has already been spoken is latency we are adding for nothing.
    enqueue(items) {
      const incoming = (Array.isArray(items) ? items : [items]).filter((item) => item != null);
      if (!incoming.length) return;
      pending.push(...incoming);
      if (!timer) pump();
    },
    // Clear means the operator wants the screen empty NOW. Anything still queued belongs to what
    // they just cleared, so it must not arrive seconds later on a blank display.
    clear() {
      pending = [];
      clearTimeoutFn(timer);
      timer = null;
    },
    pendingCount() {
      return pending.length;
    },
    // A copy, not the live array: the dedupe window in runtime.js reads this on every summarize
    // call, and a caller that could mutate the queue's own backlog would be able to drop a card
    // that was already promised to the display.
    pendingItems() {
      return [...pending];
    },
    setIntervalMs(next) {
      if (Number.isFinite(next) && next > 0) intervalMs = next;
    },
    stop() {
      clearTimeoutFn(timer);
      timer = null;
    }
  };
}
