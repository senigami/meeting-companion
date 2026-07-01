import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bindRailResize,
  syncRailWidth
} from '../../../public/controller/rail-resize.js';

function createElement(initial = {}) {
  return {
    attributes: {},
    handlers: {},
    dataset: initial.dataset || {},
    style: initial.style || {},
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    closest() {
      return null;
    },
    focus() {},
    ...initial
  };
}

test('syncRailWidth applies the current width to the layout variable and slider state', () => {
  const originalDocument = global.document;

  const rootStyles = {};
  const handle = createElement();

  global.document = {
    documentElement: {
      style: {
        setProperty(name, value) {
          rootStyles[name] = value;
        }
      },
      classList: {
        add() {},
        remove() {}
      }
    }
  };

  try {
    const ctx = {
      state: {
        operatorRailWidth: 320
      },
      dom: {
        railResizeHandle: handle
      }
    };

    syncRailWidth(ctx);

    assert.equal(rootStyles['--operator-rail-width'], '320px');
    assert.equal(handle.attributes['aria-valuenow'], '320');
    assert.equal(handle.attributes['aria-valuetext'], '320 pixels wide');
  } finally {
    global.document = originalDocument;
  }
});

test('bindRailResize lets the helper drag the rail wider', () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  const originalLocalStorage = global.localStorage;

  const rootStyles = {};
  const handle = createElement();
  const root = {
    getBoundingClientRect() {
      return { left: 0, right: 1440 };
    }
  };

  global.document = {
    documentElement: {
      style: {
        setProperty(name, value) {
          rootStyles[name] = value;
        }
      },
      classList: {
        add() {},
        remove() {}
      }
    },
    getComputedStyle() {
      return { paddingRight: '16px' };
    }
  };

  global.window = {
    handlers: {},
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    removeEventListener(type) {
      delete this.handlers[type];
    }
  };

  const storage = {};
  global.localStorage = {
    getItem(key) {
      return storage[key] ?? null;
    },
    setItem(key, value) {
      storage[key] = String(value);
    }
  };

  try {
    const ctx = {
      state: {
        operatorRailWidth: 220
      },
      dom: {
        root,
        panel: createElement(),
        railResizeHandle: handle
      }
    };

    bindRailResize(ctx);

    handle.handlers.pointerdown({
      button: 0,
      clientX: 1000,
      preventDefault() {},
      pointerId: 1
    });

    window.handlers.pointermove({
      clientX: 900,
      preventDefault() {}
    });

    window.handlers.pointerup?.({});

    assert.equal(ctx.state.operatorRailWidth, 524);
    assert.equal(rootStyles['--operator-rail-width'], '524px');
    assert.equal(storage.operatorRailWidth, '524');
    assert.equal(handle.attributes['aria-valuenow'], '524');
  } finally {
    global.document = originalDocument;
    global.window = originalWindow;
    global.localStorage = originalLocalStorage;
  }
});
