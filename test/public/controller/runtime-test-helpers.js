import { createRuntime } from '../../../public/controller/runtime.js';

export function createElement(initial = {}) {
  return {
    textContent: initial.textContent || '',
    hidden: Boolean(initial.hidden),
    value: initial.value || '',
    disabled: Boolean(initial.disabled),
    dataset: initial.dataset || {},
    attributes: initial.attributes || {},
    children: initial.children || [],
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
    ...initial
  };
}

function createDefaultElements() {
  return {
    apiWarning: createElement({ hidden: true }),
    status: createElement({ textContent: '' }),
    display: createElement(),
    panel: createElement(),
    manualInput: createElement(),
    liveTranscript: createElement(),
    railTranscript: createElement(),
    fontSizeInput: createElement({ value: '84' }),
    fontSizeValue: createElement({ textContent: '' }),
    displayMarginInput: createElement({ value: '4.5' }),
    displayMarginValue: createElement({ textContent: '' }),
    summaryIntervalInput: createElement({ value: '1' }),
    summaryIntervalValue: createElement({ textContent: '' }),
    settingsPanel: createElement({ hidden: true }),
    settingsBackdrop: createElement({ hidden: true }),
    alertsSection: createElement({ hidden: true }),
    alertButton: createElement({ hidden: true }),
    settingsButton: createElement(),
    closeSettings: createElement(),
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    transcriptViewport: createElement({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 }),
    transcriptStack: createElement()
  };
}

function createDefaultButtons(kind, sources) {
  return sources.map((source) => createElement({ dataset: { kind, source } }));
}

export function createRuntimeHarness({
  fetchConfig = null,
  fetchImpl = null,
  createTranscriptionDriverFn,
  createSummarizationDriverFn,
  setTimeoutFn,
  clearTimeoutFn,
  localStorageValues = {},
  stateOverrides = {},
  elementOverrides = {},
  transcriptionButtons = createDefaultButtons('transcription', ['browser', 'openai']),
  summarizationButtons = createDefaultButtons('summarization', ['openai', 'claude']),
  modeButtons = [],
  windowValue = undefined,
  navigatorValue = undefined
} = {}) {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');

  const elements = {
    ...createDefaultElements(),
    ...elementOverrides
  };

  const storage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(localStorageValues, key)
        ? localStorageValues[key]
        : null;
    },
    setItem() {}
  };

  const configFetch = fetchImpl || (fetchConfig
    ? async () => ({ ok: true, json: async () => fetchConfig })
    : async () => ({ ok: true, json: async () => ({}) }));

  global.localStorage = storage;
  global.fetch = configFetch;

  if (typeof windowValue !== 'undefined') {
    global.window = windowValue;
  }

  if (typeof navigatorValue !== 'undefined') {
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: navigatorValue,
      writable: true
    });
  }

  global.document = {
    documentElement: { style: { setProperty() {} }, requestFullscreen() {} },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-kind="transcription"]') return transcriptionButtons;
      if (selector === '[data-kind="summarization"]') return summarizationButtons;
      if (selector === '.mode') return modeButtons;
      return [];
    },
    addEventListener() {}
  };

  const ctx = {
    state: {
      transcriptItems: [],
      mode: 'speaker',
      paused: false,
      fontSize: 84,
      displayMargin: 4.5,
      summaryIntervalSeconds: 5,
      displayMarginGuidesVisible: false,
      transcriptChunks: [],
      transcriptPreview: '',
      listening: false,
      loopHandle: null,
      lastSentText: '',
      settingsOpen: false,
      panelOpen: false,
      transcriptionSource: 'browser',
      summarizationSource: 'openai',
      openAiReady: false,
      anthropicReady: false,
      ...stateOverrides
    },
    dom: {
      ...elements,
      modeButtons,
      transcriptionButtons,
      summarizationButtons
    }
  };

  const runtime = createRuntime(ctx, {
    fetchImpl: configFetch,
    ...(createTranscriptionDriverFn ? { createTranscriptionDriverFn } : {}),
    ...(createSummarizationDriverFn ? { createSummarizationDriverFn } : {}),
    ...(setTimeoutFn ? { setTimeoutFn } : {}),
    ...(clearTimeoutFn ? { clearTimeoutFn } : {})
  });

  return {
    ctx,
    elements,
    runtime,
    transcriptionButtons,
    summarizationButtons,
    restore() {
      global.document = originalDocument;
      global.localStorage = originalLocalStorage;
      global.fetch = originalFetch;
      global.window = originalWindow;
      if (originalNavigatorDescriptor) {
        Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
      } else {
        delete global.navigator;
      }
    }
  };
}

export async function withRuntimeHarness(options, callback) {
  const harness = createRuntimeHarness(options);
  try {
    return await callback(harness);
  } finally {
    harness.restore();
  }
}
