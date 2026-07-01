import { setDisplayMarginGuidesVisible } from './view.js';

const marginGuideTimers = new WeakMap();

export function flashDisplayMarginGuides(ctx, { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  const currentTimer = marginGuideTimers.get(ctx) || null;
  setDisplayMarginGuidesVisible(ctx, true);
  clearTimeoutFn(currentTimer);
  const nextTimer = setTimeoutFn(() => {
    marginGuideTimers.delete(ctx);
    setDisplayMarginGuidesVisible(ctx, false);
  }, 600);
  marginGuideTimers.set(ctx, nextTimer);
  nextTimer?.unref?.();
  return nextTimer;
}
