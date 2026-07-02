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
    documentElement: {
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
      }
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
      state: { railCollapsed: false },
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
    documentElement: {
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
      }
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
      state: { railCollapsed: false },
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
    documentElement: {
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
      }
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
