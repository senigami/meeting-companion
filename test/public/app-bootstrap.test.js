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
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener() {},
    focus() {},
    requestFullscreen() {},
    ...initial
  };
}

function createClickable(initial = {}) {
  const element = createElement(initial);
  element.handlers = {};
  element.addEventListener = function addEventListener(type, handler) {
    this.handlers[type] = handler;
  };
  element.click = function click() {
    this.handlers.click?.({ preventDefault() {} });
  };
  return element;
}

test('app bootstrap loads without module errors and starts keyless on the unready OpenAI default, alerting that a key is needed', async () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  const originalFetch = global.fetch;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');

  const elements = {
    display: createElement({ focus() {} }),
    panel: createElement(),
    apiWarning: createElement({ hidden: true }),
    manualInput: createElement({
      value: '',
      focusCount: 0,
      focus() {
        this.focusCount += 1;
      }
    }),
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
    serviceRegistrationCard: createElement(),
    serviceRegistrationKeyInput: createElement({ value: '' }),
    serviceRegistrationSave: createElement(),
    serviceRegistrationTest: createElement(),
    serviceRegistrationDelete: createElement(),
    serviceRegistrationOpenAi: createElement({ dataset: { registerProvider: 'openai' } }),
    serviceRegistrationClaude: createElement({ dataset: { registerProvider: 'claude' } }),
    addManual: createElement(),
    summarizeOnce: createElement(),
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    undo: createElement(),
    clear: createElement(),
    clearLabel: createElement({ textContent: 'Clear' }),
    fullscreen: {
      ...createElement(),
      handlers: {},
      addEventListener(type, handler) {
        this.handlers[type] = handler;
      },
      click() {
        this.handlers.click?.({ preventDefault() {} });
      }
    },
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

  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    writable: true
  });
  global.document = {
    fullscreenElement: null,
    documentElement: {
      style: { setProperty() {} },
      requestFullscreen() {
        global.document.fullscreenElement = global.document.documentElement;
        global.document.handlers?.fullscreenchange?.();
      }
    },
    exitFullscreen() {
      global.document.fullscreenElement = null;
      global.document.handlers?.fullscreenchange?.();
    },
    handlers: {},
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '.mode') return modeButtons;
      if (selector === '[data-kind="transcription"]') return transcriptionButtons;
      if (selector === '[data-kind="summarization"]') return summarizationButtons;
      if (selector === '[data-register-provider]') {
        return [
          elements.serviceRegistrationOpenAi,
          elements.serviceRegistrationClaude
        ];
      }
      return [];
    },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    }
  };

  delete global.window;

  try {
    await import('../../public/app.js?bootstrap-test=' + Date.now());
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 2026-08-09 reversal (Steve): a fresh install with no provider keys no longer defaults to
    // demo, so it lands on the unready OpenAI default and buildAlerts correctly surfaces that a key
    // is needed -- this is now the honest state, not a false alarm to suppress.
    assert.equal(elements.apiWarning.hidden, false);
    assert.match(elements.apiWarning.textContent, /OpenAI is selected for summaries but has no key/i);
    assert.match(elements.status.textContent, /Browser transcription works with no key/i);
    assert.equal(elements.fontSizeValue.textContent, '84px');
    assert.equal(elements.displayMarginValue.textContent, '4.5%');
    // #56: words-per-card is now the PRIMARY, persisted setting, and the interval is DERIVED from it.
    // With no stored value (localStorage.getItem returns null here), the default resolves to 14
    // words -- comfortably clear of USABLE_CARD_WORDS_FLOOR, not sitting on it -- so a first-time
    // reader's very first card isn't already at the marginal boundary. At the app's default assumed
    // pace of 30 wpm that derives a 28s interval (14 words / 30 wpm * 60).
    assert.equal(elements.summaryIntervalValue.textContent, '28s');
    // The FIRST FRAME's reading budget, before any profile apply or words-per-card drag. 14 words
    // clears MARGINAL_CARD_WORDS_CEILING, so no "only just enough" qualifier -- #56 made every
    // reachable position on this control usable by construction, so belowFloor can no longer occur
    // on the first frame or any other.
    assert.equal(elements.summaryMaxWordsValue.textContent, '14 words');
    assert.equal(elements.settingsAlertBadge.hidden, false);
    assert.equal(elements.alertsSection.hidden, false);
    assert.match(elements.status.textContent, /Browser transcription works with no key/i);
    assert.equal(elements.settingsButton.getAttribute?.('aria-expanded') || 'false', 'false');
    assert.equal(elements.settingsPanel.hidden, true);
    assert.equal(summarizationButtons[1].disabled, false);
    elements.fullscreen.click();
    assert.equal(global.document.fullscreenElement, global.document.documentElement);
    assert.equal(elements.fullscreen.getAttribute('aria-label'), 'Exit fullscreen');
    elements.fullscreen.click();
    assert.equal(global.document.fullscreenElement, null);
    assert.equal(elements.fullscreen.getAttribute('aria-label'), 'Enter fullscreen');

    elements.transcriptStack.children = [{ text: 'still here' }];
    global.document.handlers.keydown?.({
      key: 'c',
      target: { tagName: 'BODY' },
      preventDefault() {}
    });
    assert.equal(elements.clearLabel.textContent, 'Clear');
    assert.equal(elements.clear.getAttribute('aria-label'), undefined);

    let slashPrevented = false;
    global.document.handlers.keydown?.({
      key: '/',
      target: { tagName: 'BODY' },
      preventDefault() {
        slashPrevented = true;
      }
    });
    assert.equal(slashPrevented, true);
    assert.equal(elements.manualInput.focusCount, 1);

    global.document.handlers.keydown?.({
      key: '/',
      target: { tagName: 'INPUT' },
      preventDefault() {
        throw new Error('should not preventDefault while typing');
      }
    });
    assert.equal(elements.manualInput.focusCount, 1);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
    global.fetch = originalFetch;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
    } else {
      delete global.navigator;
    }
  }
});

test('ready check test button calls testProviderKey and the sample button closes settings and opens the view drawer', async () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  const originalFetch = global.fetch;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');

  const testCalls = [];

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
    serviceRegistrationCard: createElement(),
    serviceRegistrationKeyInput: createElement({ value: '' }),
    serviceRegistrationSave: createElement(),
    serviceRegistrationTest: createElement(),
    serviceRegistrationDelete: createElement(),
    serviceRegistrationOpenAi: createElement({ dataset: { registerProvider: 'openai' } }),
    serviceRegistrationClaude: createElement({ dataset: { registerProvider: 'claude' } }),
    addManual: createElement(),
    summarizeOnce: createElement(),
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    undo: createElement(),
    clear: createElement(),
    clearLabel: createElement({ textContent: 'Clear' }),
    fullscreen: createClickable(),
    readyCheckMicDot: createElement(),
    readyCheckMicFix: createElement(),
    readyCheckAiDot: createElement(),
    readyCheckAiFix: createElement(),
    readyCheckAiTest: createClickable(),
    readyCheckDisplayDot: createElement(),
    readyCheckDisplayFix: createElement(),
    readyCheckDisplaySample: createClickable()
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

  global.localStorage = {
    getItem() { return null; },
    setItem() {}
  };

  global.fetch = async (url) => {
    if (url === '/api/provider/test') {
      testCalls.push(url);
      return { ok: true, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => ({
        hasOpenAIKey: true,
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
    };
  };

  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    writable: true
  });
  global.document = {
    fullscreenElement: null,
    documentElement: {
      style: { setProperty() {} },
      requestFullscreen() {}
    },
    exitFullscreen() {},
    handlers: {},
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '.mode') return modeButtons;
      if (selector === '[data-kind="transcription"]') return transcriptionButtons;
      if (selector === '[data-kind="summarization"]') return summarizationButtons;
      if (selector === '[data-register-provider]') {
        return [
          elements.serviceRegistrationOpenAi,
          elements.serviceRegistrationClaude
        ];
      }
      return [];
    },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    }
  };

  delete global.window;

  try {
    await import('../../public/app.js?bootstrap-test=' + Date.now());
    await new Promise((resolve) => setTimeout(resolve, 0));

    elements.readyCheckAiTest.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(testCalls.length, 1);
    assert.match(elements.status.textContent, /openai/i);

    elements.settingsPanel.hidden = false;
    elements.readyCheckDisplaySample.click();
    assert.equal(elements.settingsPanel.hidden, true);
    assert.equal(elements.viewPanel.hidden, false);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
    global.fetch = originalFetch;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
    } else {
      delete global.navigator;
    }
  }
});
