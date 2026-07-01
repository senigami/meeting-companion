export function valueFromPointer({ clientX, rect, min, max, step }) {
  const width = Math.max(1, Number(rect?.width) || 0);
  const left = Number(rect?.left) || 0;
  const rawPercent = (Number(clientX) - left) / width;
  const percent = Math.min(1, Math.max(0, rawPercent));
  const rawValue = Number(min) + percent * (Number(max) - Number(min));
  const stepSize = Number(step) || 1;
  return Math.round(rawValue / stepSize) * stepSize;
}

export function bindRangeSlider(input, onChange, {
  onDragStart = () => {},
  onDragEnd = () => {}
} = {}) {
  const slider = input?.closest?.('.sliderVisual') || input?.parentElement;
  if (!input || !slider) return;
  const scope = globalThis.window || globalThis;
  const ownerDocument = input.ownerDocument || globalThis.document;
  let dragging = false;

  const updateFromPointer = (event) => {
    const value = valueFromPointer({
      clientX: event.clientX,
      rect: slider.getBoundingClientRect?.(),
      min: input.min,
      max: input.max,
      step: input.step
    });
    onChange(value);
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    onDragEnd();
    scope.removeEventListener?.('pointermove', onPointerMove);
    scope.removeEventListener?.('pointerup', onPointerUp);
    scope.removeEventListener?.('pointercancel', onPointerUp);
    scope.removeEventListener?.('mouseup', onPointerUp);
    scope.removeEventListener?.('touchend', onPointerUp);
    scope.removeEventListener?.('touchcancel', onPointerUp);
    scope.removeEventListener?.('blur', onPointerUp);
    ownerDocument?.removeEventListener?.('pointerup', onPointerUp);
    ownerDocument?.removeEventListener?.('pointercancel', onPointerUp);
    ownerDocument?.removeEventListener?.('mouseup', onPointerUp);
    ownerDocument?.removeEventListener?.('touchend', onPointerUp);
    ownerDocument?.removeEventListener?.('touchcancel', onPointerUp);
    ownerDocument?.removeEventListener?.('keydown', onKeyDown);
    ownerDocument?.removeEventListener?.('visibilitychange', onVisibilityChange);
  };

  function onPointerMove(event) {
    if (!dragging) return;
    event.preventDefault?.();
    updateFromPointer(event);
  }

  function onPointerUp() {
    stopDragging();
  }

  function onVisibilityChange() {
    if (ownerDocument?.hidden) {
      stopDragging();
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      stopDragging();
    }
  }

  slider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault?.();
    input.focus?.();
    dragging = true;
    onDragStart();
    updateFromPointer(event);
    scope.addEventListener?.('pointermove', onPointerMove);
    scope.addEventListener?.('pointerup', onPointerUp);
    scope.addEventListener?.('pointercancel', onPointerUp);
    scope.addEventListener?.('mouseup', onPointerUp);
    scope.addEventListener?.('touchend', onPointerUp);
    scope.addEventListener?.('touchcancel', onPointerUp);
    scope.addEventListener?.('blur', onPointerUp);
    ownerDocument?.addEventListener?.('pointerup', onPointerUp);
    ownerDocument?.addEventListener?.('pointercancel', onPointerUp);
    ownerDocument?.addEventListener?.('mouseup', onPointerUp);
    ownerDocument?.addEventListener?.('touchend', onPointerUp);
    ownerDocument?.addEventListener?.('touchcancel', onPointerUp);
    ownerDocument?.addEventListener?.('keydown', onKeyDown);
    ownerDocument?.addEventListener?.('visibilitychange', onVisibilityChange);
  });
}
