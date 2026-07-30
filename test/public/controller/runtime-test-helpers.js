import { createRuntime } from '../../../public/controller/runtime.js';

export function createElement(initial = {}) {
  const classes = new Set(initial.classes || []);
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
      toggle(name, force) {
        const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldAdd) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return shouldAdd;
      },
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
  // Native range inputs carry their own --slider-fill directly on
  // .style (see updateSliderFill in controller/view.js) -- no separate
  // host/thumb wrapper needed now that there's no hand-rolled slider.
  const fontSizeInput = createElement({ value: '84', min: '24', max: '144' });
  const displayMarginInput = createElement({ value: '4.5', min: '0', max: '40' });
  const summaryIntervalInput = createElement({ value: '1', min: '0', max: '3' });

  return {
    apiWarning: createElement({ hidden: true }),
    status: createElement({ textContent: '' }),
    railStatus: createElement(),
    railStatusDot: createElement(),
    railStatusWord: createElement({ textContent: '' }),
    // #railNote is a live region mounted in the a11y tree from page load (not `hidden`-toggled);
    // visibility when empty is a CSS :empty concern, not a JS/DOM one. See view.js.
    railNote: createElement(),
    display: createElement(),
    panel: createElement(),
    manualInput: createElement(),
    liveTranscript: createElement(),
    railTranscript: createElement(),
    railTranscriptProgress: createElement({ dataset: { state: 'idle' } }),
    railTranscriptProgressFill: createElement(),
    fontSizeInput,
    fontSizeValue: createElement({ textContent: '' }),
    displayMarginInput,
    displayMarginValue: createElement({ textContent: '' }),
    summaryIntervalInput,
    summaryIntervalValue: createElement({ textContent: '' }),
    viewPanel: createElement({ hidden: true }),
    viewButton: createElement(),
    closeViewPanel: createElement(),
    settingsPanel: createElement({ hidden: true }),
    settingsBackdrop: createElement({ hidden: true }),
    alertsSection: createElement({ hidden: true }),
    settingsAlertBadge: createElement({ hidden: true }),
    settingsButton: createElement(),
    closeSettings: createElement(),
    serviceRegistrationCard: createElement(),
    serviceRegistrationKeyInput: createElement({ value: '' }),
    serviceRegistrationSave: createElement(),
    serviceRegistrationTest: createElement(),
    serviceRegistrationDelete: createElement(),
    serviceRegistrationOpenAi: createElement({ dataset: { registerProvider: 'openai' } }),
    serviceRegistrationClaude: createElement({ dataset: { registerProvider: 'claude' } }),
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    undo: createElement(),
    clear: createElement(),
    clearLabel: createElement({ textContent: 'Clear' }),
    transcriptViewport: createElement({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 }),
    transcriptStack: createElement(),
    audioDeviceSelect: createFakeSelect(),
    audioLevelTestButton: createElement({ textContent: 'Test' }),
    audioLevelBar: createElement(),
    audioLevelPeak: createElement(),
    audioLevelText: createElement({ textContent: 'Not measuring' })
  };
}

// A minimal fake <select> -- createElement() above models generic elements, but the mic picker
// needs innerHTML/appendChild/options semantics that real <option> population relies on.
function createFakeSelect() {
  const el = createElement({ value: '' });
  el.children = [];
  el.appendChild = (option) => { el.children.push(option); };
  Object.defineProperty(el, 'innerHTML', {
    set() { el.children = []; },
    get() { return ''; }
  });
  return el;
}

function createFakeOptionElement() {
  return { value: '', textContent: '' };
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
  nowFn,
  documentImpl,
  createMicProbeFn,
  mediaDevicesImpl,
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
    // Writes land back in localStorageValues so a "this must NOT be persisted" assertion can
    // actually fail. While this was a no-op, the keyless-first-run test asserting demo is not stored
    // passed whether the code persisted it or not -- it pinned nothing, which is how demo went
    // sticky in the first place.
    setItem(key, value) {
      localStorageValues[key] = String(value);
    }
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
    documentElement: {
      style: {
        setProperty(name, value) {
          this[name] = String(value);
        },
        getPropertyValue(name) {
          return this[name] || '';
        }
      },
      requestFullscreen() {}
    },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-kind="transcription"]') return transcriptionButtons;
      if (selector === '[data-kind="summarization"]') return summarizationButtons;
      if (selector === '.mode') return modeButtons;
      if (selector === '[data-register-provider]') {
        return [
          elements.serviceRegistrationOpenAi,
          elements.serviceRegistrationClaude
        ];
      }
      return [];
    },
    addEventListener() {}
  };

  const ctx = {
    state: {
      transcriptItems: [],
      clearArmed: false,
      lastClearedItems: null,
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
      registrationProvider: 'openai',
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
    ...(clearTimeoutFn ? { clearTimeoutFn } : {}),
    ...(nowFn ? { nowFn } : {}),
    ...(typeof documentImpl !== 'undefined' ? { documentImpl } : {}),
    // Deliberately separate from `documentImpl` above: several other tests rely on the shared fake
    // `global.document` NOT exposing createElement (it is used elsewhere as a feature-detection
    // flag -- `documentImpl?.createElement && ...` in renderRailTranscript). The mic picker's
    // option creation gets its own narrow dependency instead of widening that flag's meaning.
    createOptionElementFn: () => createFakeOptionElement(),
    ...(createMicProbeFn ? { createMicProbeFn } : {}),
    ...(typeof mediaDevicesImpl !== 'undefined' ? { mediaDevicesImpl } : {})
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
