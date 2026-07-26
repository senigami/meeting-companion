import { syncRailWidth } from './rail-resize.js';

const STORAGE_KEY = 'operatorRailCollapsed';
const COLLAPSED_CLASS = 'is-rail-collapsed';

const EXPANDED_LABEL = {
  title: 'Hide labels',
  ariaLabel: 'Collapse the control rail'
};

const COLLAPSED_LABEL = {
  title: 'Show labels',
  ariaLabel: 'Show the control rail labels'
};

function getToggle(ctx) {
  return ctx.dom.railCollapseToggle || null;
}

function getRailHandle(ctx) {
  return ctx.dom.railResizeHandle || null;
}

function persistCollapsed(collapsed) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Ignore storage failures in private browsing or hardened test environments.
  }
}

export function loadRailCollapsed(storage = globalThis.localStorage) {
  const stored = storage?.getItem?.(STORAGE_KEY);
  return stored === 'true';
}

export function setRailCollapsed(ctx, collapsed, { persist = true } = {}) {
  const isCollapsed = Boolean(collapsed);
  ctx.state.railCollapsed = isCollapsed;

  if (isCollapsed) {
    document.documentElement.classList.add(COLLAPSED_CLASS);
  } else {
    document.documentElement.classList.remove(COLLAPSED_CLASS);
  }

  const toggle = getToggle(ctx);
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(isCollapsed));
    const labels = isCollapsed ? COLLAPSED_LABEL : EXPANDED_LABEL;
    toggle.setAttribute('title', labels.title);
    toggle.setAttribute('aria-label', labels.ariaLabel);
  }

  // `persist: false` is used by autoExpandRailForCondition: a forced expansion the operator didn't ask
  // for should not overwrite their saved preference, or a reload mid-problem would silently
  // "fix itself" into collapsed again with no explanation, or worse, surprise them by staying
  // expanded on a later, unrelated session once the problem is long gone.
  if (persist) {
    persistCollapsed(isCollapsed);
  }

  if (!isCollapsed) {
    // Collapse never rewrites ctx.state.operatorRailWidth or its storage key,
    // so re-syncing here restores the pre-collapse width rather than 64px.
    syncRailWidth(ctx);
  }

  return isCollapsed;
}

// A persistent condition's reason (#railNote) is unreadable at the 64px collapsed width -- exactly
// the silent-failure symptom this whole hardening pass exists to prevent, surviving in one
// configuration. This now covers both persistent rail levels ('problem' and 'silence'), not just a
// confirmed problem -- verified live: with the rail collapsed the silence watchdog fired correctly
// and the operator saw nothing but an unchanged dot, because the 64px rail hides #railNote.
//
// The latch is per-condition (keyed by level) rather than one shared flag: a shared latch meant
// that once 'problem' had auto-expanded and the operator re-collapsed, a later, genuinely different
// condition ('silence') would never get its own expansion -- the note would fire but stay
// unreadable. Force the rail open once per *condition* so the operator can read why, but leave them
// free to re-collapse it (we do not fight that choice by re-expanding on every subsequent status
// update while the same condition is still active).
export function autoExpandRailForCondition(ctx, level) {
  if (!ctx.state.railCollapsed) return;
  ctx.state.railAutoExpandedLevels ??= new Set();
  if (ctx.state.railAutoExpandedLevels.has(level)) return;
  ctx.state.railAutoExpandedLevels.add(level);
  setRailCollapsed(ctx, false, { persist: false });
}

// Called when the rail returns to a normal (non-persistent) status -- i.e. every persistent
// condition has actually cleared. Resets the whole latch set so whichever condition fires next,
// 'problem' or 'silence', gets its own fresh forced expansion rather than inheriting a stale
// "already used" mark from an earlier, different condition.
export function resetRailAutoExpand(ctx) {
  ctx.state.railAutoExpandedLevels?.clear();
}

export function bindRailCollapse(ctx) {
  const toggle = getToggle(ctx);
  const handle = getRailHandle(ctx);

  if (handle) {
    // Suppress the drag-start that rail-resize.js begins on pointerdown when
    // that pointerdown is part of a multi-click (dblclick) sequence. Capture
    // phase guarantees this runs before rail-resize.js's bubble-phase
    // listener, regardless of binding order. Documented exception per I5/I6:
    // rail-resize.js itself is not modified.
    handle.addEventListener('pointerdown', (event) => {
      if (event.detail > 1) {
        event.stopImmediatePropagation?.();
      }
    }, true);

    handle.addEventListener('dblclick', (event) => {
      event.preventDefault?.();
      setRailCollapsed(ctx, !ctx.state.railCollapsed);
    });
  }

  if (!toggle) return;

  toggle.addEventListener('click', () => {
    setRailCollapsed(ctx, !ctx.state.railCollapsed);
  });

  setRailCollapsed(ctx, Boolean(ctx.state.railCollapsed));
}

export { STORAGE_KEY as RAIL_COLLAPSED_STORAGE_KEY };
