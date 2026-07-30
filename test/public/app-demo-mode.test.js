import test from 'node:test';
import assert from 'node:assert/strict';

function createElement(initial = {}) {
  const styleProps = {};
  return {
    textContent: initial.textContent || '',
    hidden: Boolean(initial.hidden),
    value: initial.value || '',
    disabled: Boolean(initial.disabled),
    dataset: initial.dataset || {},
    attributes: initial.attributes || {},
    children: initial.children || [],
    style: {
      setProperty(name, value) {
        styleProps[name] = String(value);
      },
      getPropertyValue(name) {
        return styleProps[name] || '';
      }
    },
    classList: {
      toggle() {}
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    addEventListener() {},
    focus() {},
    select() {},
    requestFullscreen() {},
    ...initial
  };
}

test('bootstrap starts the demo feed when requested in the query string', async () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  const originalFetch = global.fetch;
  const originalLocation = global.location;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');

  const elements = {
    display: createElement({ focus() {} }),
    panel: createElement(),
    apiWarning: createElement({ hidden: true }),
    manualInput: createElement({ value: '' }),
    pasteTranscript: createElement({ value: '' }),
    status: createElement({ textContent: '' }),
    liveTranscript: createElement({ textContent: '' }),
    railTranscript: createElement({ textContent: '' }),
    transcriptViewport: createElement({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 }),
    transcriptStack: createElement(),
    fontSize: createElement({ value: '84' }),
    fontSizeValue: createElement({ textContent: '' }),
    displayMargin: createElement({ value: '4.5' }),
    displayMarginValue: createElement({ textContent: '' }),
    summaryInterval: createElement({ value: '1' }),
    summaryIntervalValue: createElement({ textContent: '' }),
    summaryMaxWords: createElement({ value: '2' }),
    summaryMaxWordsValue: createElement({ textContent: '' }),
    viewPanel: createElement({ hidden: true }),
    viewButton: createElement(),
    closeViewPanel: createElement(),
    settingsPanel: createElement({ hidden: true }),
    settingsBackdrop: createElement({ hidden: true }),
    alertsSection: createElement({ hidden: true }),
    settingsAlertBadge: createElement({ hidden: true }),
    settingsButton: createElement({}),
    closeSettings: createElement(),
    addManual: createElement(),
    summarizeOnce: createElement(),
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    undo: createElement(),
    clear: createElement(),
    fullscreen: createElement()
  };

  const modeButtons = [
    createElement({ dataset: { mode: 'speaker' } }),
    createElement({ dataset: { mode: 'information' } }),
    createElement({ dataset: { mode: 'song' } }),
    createElement({ dataset: { mode: 'prayer' } })
  ];

  const transcriptionButtons = [
    createElement({ dataset: { kind: 'transcription', source: 'browser' } }),
    createElement({ dataset: { kind: 'transcription', source: 'openai' } })
  ];

  const summarizationButtons = [
    createElement({ dataset: { kind: 'summarization', source: 'openai' } }),
    createElement({ dataset: { kind: 'summarization', source: 'claude' } })
  ];

  const scheduled = [];

  global.localStorage = {
    getItem() { return null; },
    setItem() {}
  };

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      hasOpenAIKey: false,
      hasAnthropicKey: false,
      model: null,
      sources: {
        transcription: [
          { id: 'browser', label: 'Browser', description: 'Browser' },
          { id: 'openai', label: 'OpenAI', description: 'OpenAI' }
        ],
        summarization: [
          { id: 'openai', label: 'OpenAI', description: 'OpenAI' },
          { id: 'claude', label: 'Claude', description: 'Claude' }
        ]
      }
    })
  });

  global.location = { search: '?demo=1' };
  global.setTimeout = (fn, delay) => {
    scheduled.push({ fn, delay });
    return scheduled.length;
  };
  global.clearTimeout = () => {};

  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    writable: true
  });

  global.document = {
    documentElement: { style: { setProperty() {} }, requestFullscreen() {} },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '.mode') return modeButtons;
      if (selector === '[data-kind="transcription"]') return transcriptionButtons;
      if (selector === '[data-kind="summarization"]') return summarizationButtons;
      return [];
    },
    addEventListener() {}
  };

  delete global.window;

  try {
    await import('../../public/app.js?demo-mode-test=' + Date.now());

    // Wait for the demo feed to actually be scheduled rather than for a fixed number of microtask
    // hops. A single `await Promise.resolve()` here was counting the hops inside
    // loadRuntimeConfig(), so adding one legitimate `await`/`.catch()` anywhere on the boot path
    // failed this test while nothing was actually broken -- and, worse, pushed the boot path to be
    // shaped around the hop count. setTimeout is stubbed above, so this drains promise jobs only
    // and stays deterministic.
    for (let hop = 0; hop < 50 && scheduled.length < 4; hop += 1) {
      await Promise.resolve();
    }

    assert.equal(scheduled.length >= 4, true);
    while (scheduled.length) {
      scheduled.shift().fn();
    }
    assert.equal(elements.transcriptStack.children.length > 0, true);
    assert.match(elements.transcriptStack.children[0].children[1].textContent, /family pace|Tuesday|Fellowship Hall|Hymn 198/i);
    assert.match(elements.railTranscript.textContent, /family pace|Tuesday|Fellowship Hall|Hymn 198/i);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
    global.fetch = originalFetch;
    global.location = originalLocation;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
    } else {
      delete global.navigator;
    }
  }
});
