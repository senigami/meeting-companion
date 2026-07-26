const STORAGE_KEY = 'railTranscriptHeight';
// Matches .railTranscript's own CSS min-height (4.5rem at the 16px root size).
const MIN_TRANSCRIPT_HEIGHT = 72;
// Matches .railTranscript's own CSS max-height (min(28rem, 60vh)) -- kept in
// sync by hand since JS can't read a CSS min()/vh expression back out.
const MAX_TRANSCRIPT_HEIGHT_REM = 448;

function getMaxTranscriptHeight() {
  const viewportHeight = Number(globalThis.innerHeight || globalThis.window?.innerHeight || 0) || 900;
  return Math.max(MIN_TRANSCRIPT_HEIGHT, Math.round(Math.min(MAX_TRANSCRIPT_HEIGHT_REM, viewportHeight * 0.6)));
}

function isMobileViewport() {
  const width = Number(globalThis.innerWidth || globalThis.window?.innerWidth || 0);
  return width > 0 && width <= 900;
}

function clampTranscriptHeight(height, maxHeight = getMaxTranscriptHeight()) {
  const value = Number(height);
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(MIN_TRANSCRIPT_HEIGHT, Math.round(value)), Math.max(MIN_TRANSCRIPT_HEIGHT, Math.round(maxHeight)));
}

function persistHeight(height) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(height));
  } catch {
    // Ignore storage failures in private browsing or hardened test environments.
  }
}

export function loadTranscriptHeight(storage = globalThis.localStorage) {
  const stored = storage?.getItem?.(STORAGE_KEY);
  if (stored == null) return null;
  return clampTranscriptHeight(stored);
}

// Restores the operator's chosen height before first paint. Skipped on
// mobile, where the box lives inside the quick-controls sheet and its
// rendered height feeds that sheet's snap-point maths (measureSnapHeights
// in quick-panel-sheet.js) -- a leftover desktop height here would corrupt
// that measurement, and responsive.css neutralises the inline style anyway.
export function applyPersistedTranscriptHeight(ctx) {
  const el = ctx.dom.railTranscript;
  if (!el || isMobileViewport()) return;
  const height = loadTranscriptHeight();
  if (height != null) el.style.height = `${height}px`;
}

// There is no native "resize" event, so a ResizeObserver is the only way to
// notice a drag on the browser's own resize handle and persist the result.
export function bindTranscriptResize(ctx) {
  const el = ctx.dom.railTranscript;
  if (!el || typeof ResizeObserver === 'undefined') return;

  // observe() delivers one callback immediately with the current size. Persisting that would
  // overwrite the stored preference with whatever this window could render: open a box saved at
  // 448px on a shorter laptop, where the clamp is 420, and the 448 is gone for good rather than
  // merely clamped for this session. Skip the initial observation; only a real resize is saved.
  let sawInitialObservation = false;

  const observer = new ResizeObserver((entries) => {
    if (isMobileViewport()) return;
    const entry = entries[0];
    if (!entry) return;
    if (!sawInitialObservation) {
      sawInitialObservation = true;
      return;
    }
    // contentRect is the content box; applyPersistedTranscriptHeight writes style.height, which is
    // the border box under this app's global box-sizing: border-box. The round-trip is only lossless
    // because .railTranscript has no padding and no border -- add either and every reload will
    // shrink the box by twice that amount, compounding. Keep that box padding-free.
    const height = clampTranscriptHeight(entry.contentRect.height);
    if (height == null) return;
    persistHeight(height);
  });

  observer.observe(el);
}

export { STORAGE_KEY as TRANSCRIPT_HEIGHT_STORAGE_KEY, MIN_TRANSCRIPT_HEIGHT, clampTranscriptHeight };
