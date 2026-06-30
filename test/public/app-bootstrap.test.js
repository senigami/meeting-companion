import test from 'node:test';
import assert from 'node:assert/strict';

function createElement(initial = {}) {
  return {
    textContent: initial.textContent || '',
    hidden: Boolean(initial.hidden),
    value: initial.value || '',
    disabled: Boolean(initial.disabled),
    dataset: initial.dataset || {},
    children: initial.children || [],
    classList: {
      toggle() {}
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    setAttribute() {},
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
    manualInput: createElement({ value: '' }),
    pasteTranscript: createElement({ value: '' }),
    status: createElement({ textContent: '' }),
    liveTranscript: createElement({ textContent: '' }),
    transcriptViewport: createElement({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 }),
    transcriptStack: createElement(),
    fontSize: createElement({ value: '84' }),
    fontSizeValue: createElement({ textContent: '' }),
    displayMargin: createElement({ value: '4.5' }),
    displayMarginValue: createElement({ textContent: '' }),
    summaryInterval: createElement({ value: '1' }),
    summaryIntervalValue: createElement({ textContent: '' }),
    secondaryControls: createElement(),
    addManual: createElement(),
    summarizeOnce: createElement(),
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    undo: createElement(),
    clear: createElement(),
    fullscreen: createElement(),
    hidePanel: createElement(),
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
    await import('../../public/app.js?bootstrap-test=' + Date.now());
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(elements.apiWarning.hidden, false);
    assert.match(elements.apiWarning.textContent, /OPENAI_API_KEY is missing/i);
    assert.match(elements.status.textContent, /Browser transcription still works/i);
    assert.equal(elements.fontSizeValue.textContent, '84px');
    assert.equal(elements.displayMarginValue.textContent, '4.5vw');
    assert.equal(elements.summaryIntervalValue.textContent, '5s');
    assert.equal(elements.hidePanel.textContent, 'Hide extras');
    assert.equal(summarizationButtons[1].disabled, true);
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
