import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadTranscriptHeight,
  applyPersistedTranscriptHeight,
  bindTranscriptResize,
  clampTranscriptHeight,
  MIN_TRANSCRIPT_HEIGHT
} from '../../../public/controller/transcript-resize.js';

test('clampTranscriptHeight enforces the minimum and tolerates garbage', () => {
  assert.equal(clampTranscriptHeight(10, 400), MIN_TRANSCRIPT_HEIGHT);
  assert.equal(clampTranscriptHeight(250, 400), 250);
  assert.equal(clampTranscriptHeight(9999, 400), 400);
  assert.equal(clampTranscriptHeight('not-a-number', 400), null);
  assert.equal(clampTranscriptHeight(undefined, 400), null);
});

test('loadTranscriptHeight clamps stored values and tolerates absent/garbage storage', () => {
  assert.equal(loadTranscriptHeight({ getItem: () => null }), null);
  assert.equal(loadTranscriptHeight({ getItem: () => 'nonsense' }), null);
  assert.equal(loadTranscriptHeight({ getItem: () => '10' }), MIN_TRANSCRIPT_HEIGHT);
  assert.equal(loadTranscriptHeight({ getItem: () => '200' }), 200);
});

test('applyPersistedTranscriptHeight restores a saved height on desktop widths', () => {
  const originalLocalStorage = global.localStorage;
  const originalInnerWidth = global.innerWidth;

  global.innerWidth = 1440;
  const storage = { railTranscriptHeight: '260' };
  global.localStorage = {
    getItem: (key) => storage[key] ?? null,
    setItem: (key, value) => {
      storage[key] = String(value);
    }
  };

  try {
    const el = { style: {} };
    applyPersistedTranscriptHeight({ dom: { railTranscript: el } });
    assert.equal(el.style.height, '260px');
  } finally {
    global.localStorage = originalLocalStorage;
    global.innerWidth = originalInnerWidth;
  }
});

test('applyPersistedTranscriptHeight does nothing at mobile widths', () => {
  const originalLocalStorage = global.localStorage;
  const originalInnerWidth = global.innerWidth;

  global.innerWidth = 375;
  const storage = { railTranscriptHeight: '260' };
  global.localStorage = {
    getItem: (key) => storage[key] ?? null,
    setItem: (key, value) => {
      storage[key] = String(value);
    }
  };

  try {
    const el = { style: {} };
    applyPersistedTranscriptHeight({ dom: { railTranscript: el } });
    assert.equal(el.style.height, undefined);
  } finally {
    global.localStorage = originalLocalStorage;
    global.innerWidth = originalInnerWidth;
  }
});

test('bindTranscriptResize persists the observed height on desktop and skips storage when absent', () => {
  const originalLocalStorage = global.localStorage;
  const originalInnerWidth = global.innerWidth;
  const originalResizeObserver = global.ResizeObserver;

  global.innerWidth = 1440;
  const storage = {};
  global.localStorage = {
    getItem: (key) => storage[key] ?? null,
    setItem: (key, value) => {
      storage[key] = String(value);
    }
  };

  let observedCallback = null;
  global.ResizeObserver = class {
    constructor(callback) {
      observedCallback = callback;
    }

    observe() {}
  };

  try {
    const el = { style: {} };
    bindTranscriptResize({ dom: { railTranscript: el } });
    assert.ok(observedCallback);

    // The first observation is the one ResizeObserver fires on observe() with the current size.
    // Persisting it would overwrite a taller saved preference with whatever this window can render,
    // so it is deliberately ignored; only a real drag is stored.
    observedCallback([{ contentRect: { height: 120 } }]);
    assert.equal(storage.railTranscriptHeight, undefined);

    observedCallback([{ contentRect: { height: 300 } }]);
    assert.equal(storage.railTranscriptHeight, '300');
  } finally {
    global.localStorage = originalLocalStorage;
    global.innerWidth = originalInnerWidth;
    global.ResizeObserver = originalResizeObserver;
  }
});

test('bindTranscriptResize ignores observed changes at mobile widths', () => {
  const originalLocalStorage = global.localStorage;
  const originalInnerWidth = global.innerWidth;
  const originalResizeObserver = global.ResizeObserver;

  global.innerWidth = 375;
  const storage = {};
  global.localStorage = {
    getItem: (key) => storage[key] ?? null,
    setItem: (key, value) => {
      storage[key] = String(value);
    }
  };

  let observedCallback = null;
  global.ResizeObserver = class {
    constructor(callback) {
      observedCallback = callback;
    }

    observe() {}
  };

  try {
    const el = { style: {} };
    bindTranscriptResize({ dom: { railTranscript: el } });
    observedCallback([{ contentRect: { height: 300 } }]);
    assert.equal(storage.railTranscriptHeight, undefined);
  } finally {
    global.localStorage = originalLocalStorage;
    global.innerWidth = originalInnerWidth;
    global.ResizeObserver = originalResizeObserver;
  }
});
