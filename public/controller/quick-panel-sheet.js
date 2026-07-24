const STORAGE_KEY = 'quickPanelSnap';
const COMPACT = 'compact';
const EXPANDED = 'expanded';
const TAP_THRESHOLD_PX = 6;

export function loadQuickPanelSnap(storage = globalThis.localStorage) {
  const stored = storage?.getItem?.(STORAGE_KEY);
  return stored === EXPANDED ? EXPANDED : COMPACT;
}

function persistSnap(snap) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, snap);
  } catch {
    // Ignore storage failures in private browsing or hardened test environments.
  }
}

/**
 * The sheet's two snap heights are measured from actual rendered content
 * rather than hardcoded, so they stay correct if the Quick Controls grid
 * or transcript styling ever changes: compact is the handle + Quick
 * Controls' own height; expanded adds Live Transcript's height on top,
 * capped so the sheet never eats the whole screen (the display panel
 * should stay meaningfully visible above it, per "doesn't take up that
 * much space").
 */
function measureSnapHeights(ctx) {
  const handleH = ctx.dom.quickPanelHandle?.getBoundingClientRect().height || 0;
  const quickH = ctx.dom.quickControlsSection?.getBoundingClientRect().height || 0;
  const transcriptH = ctx.dom.railTranscriptSection?.getBoundingClientRect().height || 0;
  const scrollStyle = ctx.dom.quickPanelScroll ? getComputedStyle(ctx.dom.quickPanelScroll) : null;
  const scrollPadding = scrollStyle ? parseFloat(scrollStyle.paddingBottom) || 0 : 0;
  const gap = scrollStyle ? parseFloat(scrollStyle.rowGap || scrollStyle.gap) || 0 : 0;

  const compact = handleH + quickH + scrollPadding;
  const maxHeight = (globalThis.visualViewport?.height || globalThis.innerHeight || 800) * 0.82;
  const expanded = Math.min(compact + gap + transcriptH, maxHeight);

  return { compact, expanded: Math.max(expanded, compact) };
}

export function applyQuickPanelSnap(ctx, snap, { animate = true } = {}) {
  const sheet = ctx.dom.quickPanel;
  if (!sheet) return;
  const resolved = snap === EXPANDED ? EXPANDED : COMPACT;
  const { compact, expanded } = measureSnapHeights(ctx);
  const height = resolved === EXPANDED ? expanded : compact;

  sheet.classList.toggle('is-dragging', !animate);
  sheet.style.height = `${Math.round(height)}px`;
  if (!animate) {
    // Force layout so a caller that flips is-dragging straight back off
    // (e.g. measuring before the panel is even visible) doesn't
    // accidentally coalesce this height change into the next transition.
    void sheet.offsetHeight;
    sheet.classList.remove('is-dragging');
  }

  ctx.state.quickPanelSnap = resolved;
  ctx.dom.quickPanelHandle?.setAttribute('aria-expanded', String(resolved === EXPANDED));
  persistSnap(resolved);
}

export function bindQuickPanelSheet(ctx) {
  const handle = ctx.dom.quickPanelHandle;
  const sheet = ctx.dom.quickPanel;
  if (!handle || !sheet) return;

  let dragging = false;
  let startY = 0;
  let startHeight = 0;
  let moved = 0;
  let bounds = { compact: 0, expanded: 0 };

  const onPointerMove = (event) => {
    if (!dragging) return;
    event.preventDefault?.();
    const deltaY = startY - event.clientY;
    moved = Math.max(moved, Math.abs(deltaY));
    const next = Math.min(bounds.expanded, Math.max(bounds.compact, startHeight + deltaY));
    sheet.style.height = `${Math.round(next)}px`;
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    globalThis.removeEventListener?.('pointermove', onPointerMove);
    globalThis.removeEventListener?.('pointerup', onPointerUp);
    globalThis.removeEventListener?.('pointercancel', onPointerUp);
    globalThis.removeEventListener?.('blur', onPointerUp);
    document?.removeEventListener?.('visibilitychange', onVisibilityChange);

    if (moved < TAP_THRESHOLD_PX) {
      // A tap, not a drag: toggle snaps so this stays keyboard/switch
      // operable, not just draggable.
      const next = ctx.state.quickPanelSnap === EXPANDED ? COMPACT : EXPANDED;
      applyQuickPanelSnap(ctx, next);
      return;
    }

    const currentRect = sheet.getBoundingClientRect();
    const midpoint = (bounds.compact + bounds.expanded) / 2;
    const next = currentRect.height >= midpoint ? EXPANDED : COMPACT;
    applyQuickPanelSnap(ctx, next);
  };

  const onVisibilityChange = () => {
    if (document?.hidden) onPointerUp();
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault?.();
    dragging = true;
    moved = 0;
    startY = event.clientY;
    startHeight = sheet.getBoundingClientRect().height;
    bounds = measureSnapHeights(ctx);
    sheet.classList.add('is-dragging');
    globalThis.addEventListener?.('pointermove', onPointerMove);
    globalThis.addEventListener?.('pointerup', onPointerUp);
    globalThis.addEventListener?.('pointercancel', onPointerUp);
    globalThis.addEventListener?.('blur', onPointerUp);
    document?.addEventListener?.('visibilitychange', onVisibilityChange);
  }, { passive: false });

  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const next = ctx.state.quickPanelSnap === EXPANDED ? COMPACT : EXPANDED;
    applyQuickPanelSnap(ctx, next);
  });
}

export { COMPACT as QUICK_PANEL_COMPACT, EXPANDED as QUICK_PANEL_EXPANDED };
