import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bindRailCollapse,
  loadRailCollapsed,
  setRailCollapsed
} from '../../../public/controller/rail-collapse.js';

function createElement(initial = {}) {
  return {
    attributes: {},
    handlers: {},
    captureHandlers: {},
    dataset: initial.dataset || {},
    style: initial.style || {},
    addEventListener(type, handler, useCapture) {
      if (useCapture) {
        this.captureHandlers[type] = handler;
      } else {
        this.handlers[type] = handler;
      }
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

function createDocumentElement(classes) {
  return {
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      }
    },
    style: {
      properties: {},
      setProperty(name, value) {
        this.properties[name] = String(value);
      },
      getPropertyValue(name) {
        return this.properties[name] || '';
      }
    }
  };
}

test('loadRailCollapsed defaults to expanded when nothing is stored', () => {
  const storage = {
    getItem() {
      return null;
    }
  };

  assert.equal(loadRailCollapsed(storage), false);
});

test('loadRailCollapsed restores a persisted collapsed state', () => {
  const storage = {
    getItem() {
      return 'true';
    }
  };

  assert.equal(loadRailCollapsed(storage), true);
});

test('loadRailCollapsed treats anything other than the string "true" as expanded', () => {
  const storage = {
    getItem() {
      return 'false';
    }
  };

  assert.equal(loadRailCollapsed(storage), false);
});

test('setRailCollapsed toggles the html state class, aria-pressed, and title/aria-label', () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;

  const classes = new Set();
  const toggle = createElement();

  global.document = {
    documentElement: createDocumentElement(classes)
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
      state: { railCollapsed: false, operatorRailWidth: 260 },
      dom: { railCollapseToggle: toggle }
    };

    setRailCollapsed(ctx, true);

    assert.equal(ctx.state.railCollapsed, true);
    assert.ok(classes.has('is-rail-collapsed'));
    assert.equal(toggle.attributes['aria-pressed'], 'true');
    assert.equal(toggle.attributes.title, 'Show labels');
    assert.equal(toggle.attributes['aria-label'], 'Show the control rail labels');
    assert.equal(storage.operatorRailCollapsed, 'true');

    setRailCollapsed(ctx, false);

    assert.equal(ctx.state.railCollapsed, false);
    assert.ok(!classes.has('is-rail-collapsed'));
    assert.equal(toggle.attributes['aria-pressed'], 'false');
    assert.equal(toggle.attributes.title, 'Hide labels');
    assert.equal(toggle.attributes['aria-label'], 'Collapse the control rail');
    assert.equal(storage.operatorRailCollapsed, 'false');
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  }
});

test('bindRailCollapse wires the toggle button to flip the collapsed state on click', () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;

  const classes = new Set();
  const toggle = createElement();

  global.document = {
    documentElement: createDocumentElement(classes)
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
      state: { railCollapsed: false, operatorRailWidth: 260 },
      dom: { railCollapseToggle: toggle }
    };

    bindRailCollapse(ctx);

    assert.ok(!classes.has('is-rail-collapsed'));

    toggle.handlers.click();

    assert.equal(ctx.state.railCollapsed, true);
    assert.ok(classes.has('is-rail-collapsed'));
    assert.equal(storage.operatorRailCollapsed, 'true');

    toggle.handlers.click();

    assert.equal(ctx.state.railCollapsed, false);
    assert.ok(!classes.has('is-rail-collapsed'));
    assert.equal(storage.operatorRailCollapsed, 'false');
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  }
});

test('bindRailCollapse applies the persisted collapsed state from ctx.state on load', () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;

  const classes = new Set();
  const toggle = createElement();

  global.document = {
    documentElement: createDocumentElement(classes)
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
      state: { railCollapsed: true },
      dom: { railCollapseToggle: toggle }
    };

    bindRailCollapse(ctx);

    assert.ok(classes.has('is-rail-collapsed'));
    assert.equal(toggle.attributes['aria-pressed'], 'true');
    assert.equal(toggle.attributes.title, 'Show labels');
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  }
});

test('bindRailCollapse does nothing when the toggle button is missing', () => {
  const ctx = {
    state: { railCollapsed: false },
    dom: {}
  };

  assert.doesNotThrow(() => bindRailCollapse(ctx));
});

test('dblclick on the resize handle toggles the collapsed state', () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;

  const classes = new Set();
  const toggle = createElement();
  const handle = createElement();

  global.document = {
    documentElement: createDocumentElement(classes)
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
      state: { railCollapsed: false, operatorRailWidth: 260 },
      dom: { railCollapseToggle: toggle, railResizeHandle: handle }
    };

    bindRailCollapse(ctx);

    assert.ok(!classes.has('is-rail-collapsed'));

    handle.handlers.dblclick({ preventDefault() {} });

    assert.equal(ctx.state.railCollapsed, true);
    assert.ok(classes.has('is-rail-collapsed'));
    assert.equal(storage.operatorRailCollapsed, 'true');

    handle.handlers.dblclick({ preventDefault() {} });

    assert.equal(ctx.state.railCollapsed, false);
    assert.ok(!classes.has('is-rail-collapsed'));
    assert.equal(storage.operatorRailCollapsed, 'false');
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  }
});

test('bindRailCollapse suppresses a multi-click pointerdown on the resize handle so a drag never starts', () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;

  const classes = new Set();
  const toggle = createElement();
  const handle = createElement();
  let resizeSawPointerdown = false;

  global.document = {
    documentElement: createDocumentElement(classes)
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
      state: { railCollapsed: false, operatorRailWidth: 260 },
      dom: { railCollapseToggle: toggle, railResizeHandle: handle }
    };

    bindRailCollapse(ctx);

    // Stand in for rail-resize.js's own pointerdown listener: it is
    // registered after rail-collapse.js's capture-phase guard, so the guard
    // must call stopImmediatePropagation to keep this from firing.
    handle.addEventListener('pointerdown', () => {
      resizeSawPointerdown = true;
    });

    const dispatchPointerdown = (event) => {
      handle.captureHandlers?.pointerdown?.(event);
      handle.handlers.pointerdown?.(event);
    };

    dispatchPointerdown({ detail: 1, stopImmediatePropagation() {} });
    assert.equal(resizeSawPointerdown, true);

    resizeSawPointerdown = false;
    dispatchPointerdown({
      detail: 2,
      stopImmediatePropagation() {
        handle.handlers.pointerdown = null;
      }
    });
    assert.equal(resizeSawPointerdown, false);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  }
});

test('expanding after a collapse restores the pre-collapse width instead of 64px', () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;

  const classes = new Set();
  const toggle = createElement();
  const documentElement = createDocumentElement(classes);

  global.document = { documentElement };

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
      state: { railCollapsed: false, operatorRailWidth: 260 },
      dom: { railCollapseToggle: toggle }
    };

    setRailCollapsed(ctx, true);

    // Collapsing must never rewrite the persisted rail width or storage key.
    assert.equal(ctx.state.operatorRailWidth, 260);
    assert.equal(storage.operatorRailWidth, undefined);

    setRailCollapsed(ctx, false);

    assert.equal(ctx.state.operatorRailWidth, 260);
    assert.equal(documentElement.style.getPropertyValue('--operator-rail-width'), '260px');
    assert.equal(storage.operatorRailWidth, undefined);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  }
});
