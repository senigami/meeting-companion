import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bindRangeSlider,
  valueFromPointer
} from '../../../public/controller/range-slider.js';

function createElement(initial = {}) {
  return {
    handlers: {},
    parentElement: null,
    ownerDocument: initial.ownerDocument || null,
    min: '0',
    max: '40',
    step: '0.5',
    value: '0',
    focus() {},
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    removeEventListener(type) {
      delete this.handlers[type];
    },
    closest() {
      return this.parentElement;
    },
    getBoundingClientRect() {
      return { left: 100, width: 300 };
    },
    setPointerCapture() {},
    ...initial
  };
}

test('range slider maps pointer position to the visible track width', () => {
  const rect = { left: 100, width: 300 };

  assert.equal(valueFromPointer({ clientX: 100, rect, min: 0, max: 40, step: 0.5 }), 0);
  assert.equal(valueFromPointer({ clientX: 250, rect, min: 0, max: 40, step: 0.5 }), 20);
  assert.equal(valueFromPointer({ clientX: 400, rect, min: 0, max: 40, step: 0.5 }), 40);
});

test('range slider clamps pointer positions outside the track', () => {
  const rect = { left: 100, width: 300 };

  assert.equal(valueFromPointer({ clientX: 50, rect, min: 0, max: 40, step: 0.5 }), 0);
  assert.equal(valueFromPointer({ clientX: 500, rect, min: 0, max: 40, step: 0.5 }), 40);
});

test('range slider ends drag mode when the pointer is lost or the tab hides', () => {
  const scope = {
    handlers: {},
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    removeEventListener(type) {
      delete this.handlers[type];
    }
  };
  const ownerDocument = {
    hidden: false,
    handlers: {},
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    removeEventListener(type) {
      delete this.handlers[type];
    }
  };
  const slider = createElement({ ownerDocument });
  const input = createElement({
    ownerDocument,
    parentElement: slider,
    closest() {
      return slider;
    }
  });
  const changes = [];
  const dragEvents = [];

  const originalWindow = global.window;
  global.window = scope;

  try {
    bindRangeSlider(input, (value) => changes.push(value), {
      onDragStart: () => dragEvents.push('start'),
      onDragEnd: () => dragEvents.push('end')
    });

    slider.handlers.pointerdown({
      button: 0,
      clientX: 250,
      pointerId: 7,
      preventDefault() {}
    });

    assert.deepEqual(dragEvents, ['start']);
    assert.equal(typeof scope.handlers.pointermove, 'function');

    ownerDocument.hidden = true;
    ownerDocument.handlers.visibilitychange?.();

    assert.deepEqual(dragEvents, ['start', 'end']);
    assert.equal(scope.handlers.pointermove, undefined);
    assert.equal(scope.handlers.pointerup, undefined);
    assert.equal(scope.handlers.pointercancel, undefined);
    assert.equal(ownerDocument.handlers.pointerup, undefined);
    assert.equal(ownerDocument.handlers.mouseup, undefined);

    slider.handlers.pointerdown({
      button: 0,
      clientX: 260,
      pointerId: 8,
      preventDefault() {}
    });
    assert.deepEqual(dragEvents, ['start', 'end', 'start']);

    ownerDocument.handlers.keydown?.({ key: 'Escape' });
    assert.deepEqual(dragEvents, ['start', 'end', 'start', 'end']);
  } finally {
    global.window = originalWindow;
  }
});
