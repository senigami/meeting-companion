import test from 'node:test';
import assert from 'node:assert/strict';

function createElement(initial = {}) {
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
    requestFullscreen() {},
    ...initial
  };
}

test('app bootstrap loads without module errors and shows runtime warning when OpenAI is missing', async () => {
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

    assert.equal(elements.apiWarning.hidden, false);
    assert.match(elements.apiWarning.textContent, /OpenAI key is missing/i);
    assert.match(elements.apiWarning.textContent, /Claude key is missing/i);
    assert.match(elements.status.textContent, /Browser transcription still works/i);
    assert.equal(elements.fontSizeValue.textContent, '84px');
    assert.equal(elements.displayMarginValue.textContent, '4.5%');
    assert.equal(elements.summaryIntervalValue.textContent, '5s');
    assert.equal(elements.settingsAlertBadge.hidden, false);
    assert.equal(elements.alertsSection.hidden, false);
    assert.match(elements.apiWarning.textContent, /OpenAI key is missing/i);
    assert.match(elements.status.textContent, /Browser transcription still works/i);
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
