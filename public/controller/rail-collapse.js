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

export function setRailCollapsed(ctx, collapsed) {
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

  persistCollapsed(isCollapsed);

  if (!isCollapsed) {
    // Collapse never rewrites ctx.state.operatorRailWidth or its storage key,
    // so re-syncing here restores the pre-collapse width rather than 64px.
    syncRailWidth(ctx);
  }

  return isCollapsed;
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
