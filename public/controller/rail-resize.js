const STORAGE_KEY = 'operatorRailWidth';
const DEFAULT_RAIL_WIDTH = 220;
const MIN_RAIL_WIDTH = 180;
const KEY_STEP = 16;
const LARGE_KEY_STEP = 48;

function clampRailWidth(width, maxWidth = Number.POSITIVE_INFINITY) {
  const value = Number(width);
  if (!Number.isFinite(value)) return DEFAULT_RAIL_WIDTH;
  return Math.min(Math.max(MIN_RAIL_WIDTH, Math.round(value)), Math.max(MIN_RAIL_WIDTH, Math.round(maxWidth)));
}

function getRailHandle(ctx) {
  return ctx.dom.railResizeHandle || null;
}

function getRootNode(ctx) {
  return ctx.dom.root
    || document.getElementById?.('root')
    || document.documentElement;
}

function getInnerRight(root) {
  const rect = root?.getBoundingClientRect?.();
  const styles = globalThis.getComputedStyle?.(root)
    || globalThis.document?.getComputedStyle?.(root)
    || globalThis.document?.defaultView?.getComputedStyle?.(root);
  const paddingRight = Number.parseFloat(styles?.paddingRight || '0') || 0;
  const viewportWidth = Number(globalThis.innerWidth || globalThis.window?.innerWidth || 0) || 1440;
  if (!rect) return viewportWidth - paddingRight;
  return rect.right - paddingRight;
}

function getMaxRailWidth(ctx) {
  const root = getRootNode(ctx);
  return Math.max(MIN_RAIL_WIDTH, Math.round(getInnerRight(root) - 320));
}

function persistWidth(width) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(width));
  } catch {
    // Ignore storage failures in private browsing or hardened test environments.
  }
}

function updateHandleState(ctx, width) {
  const handle = getRailHandle(ctx);
  if (!handle) return;
  const maxWidth = getMaxRailWidth(ctx);

  handle.setAttribute('aria-valuemin', String(MIN_RAIL_WIDTH));
  handle.setAttribute('aria-valuemax', String(maxWidth));
  handle.setAttribute('aria-valuenow', String(width));
  handle.setAttribute('aria-valuetext', `${width} pixels wide`);
}

export function loadRailWidth(storage = globalThis.localStorage) {
  const stored = storage?.getItem?.(STORAGE_KEY);
  return clampRailWidth(stored ?? DEFAULT_RAIL_WIDTH);
}

export function syncRailWidth(ctx) {
  const width = clampRailWidth(ctx.state.operatorRailWidth, getMaxRailWidth(ctx));
  ctx.state.operatorRailWidth = width;
  document.documentElement.style.setProperty('--operator-rail-width', `${width}px`);
  updateHandleState(ctx, width);
  return width;
}

export function setRailWidth(ctx, nextWidth) {
  ctx.state.operatorRailWidth = clampRailWidth(nextWidth, getMaxRailWidth(ctx));
  persistWidth(ctx.state.operatorRailWidth);
  return syncRailWidth(ctx);
}

export function bindRailResize(ctx) {
  const handle = getRailHandle(ctx);
  if (!handle) return;
  const scope = globalThis.window || globalThis;

  let dragging = false;

  const updateFromClientX = (clientX) => {
    const root = getRootNode(ctx);
    const innerRight = getInnerRight(root);
    const nextWidth = innerRight - Number(clientX);
    setRailWidth(ctx, nextWidth);
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    document.documentElement.classList.remove('is-resizing-rail');
    scope.removeEventListener?.('pointermove', onPointerMove);
    scope.removeEventListener?.('pointerup', onPointerUp);
    scope.removeEventListener?.('pointercancel', onPointerUp);
  };

  function onPointerMove(event) {
    if (!dragging) return;
    event.preventDefault?.();
    updateFromClientX(event.clientX);
  }

  function onPointerUp() {
    stopDragging();
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault?.();
    dragging = true;
    document.documentElement.classList.add('is-resizing-rail');
    updateFromClientX(event.clientX);
    scope.addEventListener?.('pointermove', onPointerMove);
    scope.addEventListener?.('pointerup', onPointerUp);
    scope.addEventListener?.('pointercancel', onPointerUp);
  });

  handle.addEventListener('keydown', (event) => {
    const current = clampRailWidth(ctx.state.operatorRailWidth, getMaxRailWidth(ctx));
    const shiftStep = event.shiftKey ? LARGE_KEY_STEP : KEY_STEP;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault?.();
      setRailWidth(ctx, current - shiftStep);
      return;
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault?.();
      setRailWidth(ctx, current + shiftStep);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault?.();
      setRailWidth(ctx, MIN_RAIL_WIDTH);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault?.();
      setRailWidth(ctx, getMaxRailWidth(ctx));
    }
  });

  syncRailWidth(ctx);
}

export { STORAGE_KEY as RAIL_WIDTH_STORAGE_KEY, DEFAULT_RAIL_WIDTH, MIN_RAIL_WIDTH };
