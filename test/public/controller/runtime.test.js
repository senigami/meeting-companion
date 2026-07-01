import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuntime } from '../../../public/controller/runtime.js';

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
    ...initial
  };
}

test('runtime falls back to Claude summarization when OpenAI is unavailable', async () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  const originalFetch = global.fetch;

  const elements = {
    apiWarning: createElement({ hidden: true }),
    status: createElement({ textContent: '' }),
    display: createElement(),
    panel: createElement(),
    manualInput: createElement(),
    liveTranscript: createElement(),
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

  const transcriptionButtons = [
    createElement({ dataset: { kind: 'transcription', source: 'browser' } }),
    createElement({ dataset: { kind: 'transcription', source: 'openai' } })
  ];
  const summarizationButtons = [
    createElement({ dataset: { kind: 'summarization', source: 'openai' } }),
    createElement({ dataset: { kind: 'summarization', source: 'claude' } })
  ];

  global.localStorage = {
    getItem() {
      return null;
    },
    setItem() {}
  };

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      hasOpenAIKey: false,
      hasAnthropicKey: true,
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

  global.document = {
    documentElement: { style: { setProperty() {} }, requestFullscreen() {} },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-kind="transcription"]') return transcriptionButtons;
      if (selector === '[data-kind="summarization"]') return summarizationButtons;
      if (selector === '.mode') return [];
      return [];
    },
    addEventListener() {}
  };

  try {
    const ctx = {
      state: {
        transcriptItems: [],
        mode: 'speaker',
        paused: false,
        fontSize: 84,
        displayMargin: 4.5,
        summaryIntervalSeconds: 5,
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
        anthropicReady: false
      },
      dom: {
        ...elements,
        modeButtons: [],
        transcriptionButtons,
        summarizationButtons,
      }
    };

    const runtime = createRuntime(ctx);
    await runtime.loadRuntimeConfig();

    assert.equal(ctx.state.summarizationSource, 'claude');
    assert.equal(elements.alertButton.hidden, false);
    assert.equal(elements.alertsSection.hidden, false);
    assert.equal(summarizationButtons[0].dataset.configured, 'false');
    assert.equal(summarizationButtons[1].dataset.configured, 'true');
    assert.match(elements.apiWarning.textContent, /OpenAI key is missing/i);
    assert.match(elements.apiWarning.textContent, /Claude summaries remain available/i);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
    global.fetch = originalFetch;
  }
});

test('runtime treats browser speech recognition as available without microphone capture', async () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  const originalWindow = global.window;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');

  const browserButton = createElement({ dataset: { kind: 'transcription', source: 'browser' } });

  global.localStorage = {
    getItem() {
      return null;
    },
    setItem() {}
  };

  class FakeSpeechRecognition {
    start() {}
    stop() {}
  }

  global.window = { SpeechRecognition: FakeSpeechRecognition };
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {},
    writable: true
  });

  global.document = {
    documentElement: { style: { setProperty() {} }, requestFullscreen() {} },
    getElementById(id) {
      if (id === 'transcriptionBrowser') return browserButton;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-kind="transcription"]') return [browserButton];
      if (selector === '[data-kind="summarization"]') return [];
      if (selector === '.mode') return [];
      return [];
    },
    addEventListener() {}
  };

  try {
    const ctx = {
      state: {
        transcriptItems: [],
        mode: 'speaker',
        paused: false,
        fontSize: 84,
        displayMargin: 4.5,
        summaryIntervalSeconds: 5,
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
        anthropicReady: false
      },
      dom: {
        transcriptionButtons: [browserButton],
        summarizationButtons: [],
        modeButtons: [],
        transcriptionBrowser: browserButton
      }
    };

    const runtime = createRuntime(ctx);

    assert.equal(runtime.isSourceConfigured('transcription', 'browser'), true);
    runtime.updateSourceButtons();
    assert.equal(browserButton.disabled, false);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
    global.window = originalWindow;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
    } else {
      delete global.navigator;
    }
  }
});

test('runtime pauses and resumes the active transcription driver', async () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;

  const elements = {
    apiWarning: createElement({ hidden: true }),
    status: createElement({ textContent: '' }),
    display: createElement(),
    panel: createElement(),
    manualInput: createElement(),
    liveTranscript: createElement(),
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

  const driver = {
    id: 'browser',
    label: 'Browser',
    startCount: 0,
    stopCount: 0,
    modeHistory: [],
    async start({ currentMode } = {}) {
      this.startCount += 1;
      this.lastStartMode = currentMode;
      return undefined;
    },
    async stop() {
      this.stopCount += 1;
    },
    setMode(mode) {
      this.modeHistory.push(mode);
    }
  };

  global.localStorage = {
    getItem() {
      return null;
    },
    setItem() {}
  };

  global.document = {
    documentElement: { style: { setProperty() {} }, requestFullscreen() {} },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-kind="transcription"]') return [createElement({ dataset: { kind: 'transcription', source: 'browser' } })];
      if (selector === '[data-kind="summarization"]') return [createElement({ dataset: { kind: 'summarization', source: 'openai' } })];
      if (selector === '.mode') return [];
      return [];
    },
    addEventListener() {}
  };

  try {
    const ctx = {
      state: {
        transcriptItems: [],
        mode: 'speaker',
        paused: false,
        fontSize: 84,
        displayMargin: 4.5,
        summaryIntervalSeconds: 5,
        transcriptChunks: [],
        transcriptPreview: '',
        listening: false,
        loopHandle: null,
        lastSentText: '',
        settingsOpen: false,
        panelOpen: false,
        transcriptionSource: 'browser',
        summarizationSource: 'openai',
        openAiReady: true,
        anthropicReady: false
      },
      dom: {
        ...elements,
        modeButtons: [],
        transcriptionButtons: [],
        summarizationButtons: [],
      }
    };

    const runtime = createRuntime(ctx, {
      createTranscriptionDriverFn: () => driver,
      createSummarizationDriverFn: () => ({ id: 'openai', label: 'OpenAI', summarize: async () => ({ line: '' }) }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ line: '' }) })
    });

    await runtime.startListening();
    runtime.setMode('information');
    await runtime.togglePauseAi();
    await runtime.togglePauseAi();

    assert.equal(driver.startCount, 2);
    assert.equal(driver.stopCount, 1);
    assert.deepEqual(driver.modeHistory, ['speaker', 'information', 'information']);
    assert.equal(driver.lastStartMode, 'information');
    assert.equal(ctx.state.paused, false);
    assert.equal(ctx.state.listening, true);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  }
});

test('settings open state keeps alert and settings buttons in sync', async () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;

  const elements = {
    status: createElement({ textContent: '' }),
    display: createElement(),
    panel: createElement(),
    manualInput: createElement(),
    liveTranscript: createElement(),
    fontSizeInput: createElement({ value: '84' }),
    fontSizeValue: createElement({ textContent: '' }),
    displayMarginInput: createElement({ value: '4.5' }),
    displayMarginValue: createElement({ textContent: '' }),
    summaryIntervalInput: createElement({ value: '1' }),
    summaryIntervalValue: createElement({ textContent: '' }),
    settingsPanel: createElement({ hidden: true }),
    settingsBackdrop: createElement({ hidden: true }),
    alertsSection: createElement({ hidden: true }),
    apiWarning: createElement({ hidden: true }),
    alertButton: createElement({ hidden: true }),
    settingsButton: createElement({ hidden: true }),
    closeSettings: createElement(),
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    transcriptViewport: createElement({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 }),
    transcriptStack: createElement()
  };

  global.localStorage = {
    getItem() {
      return null;
    },
    setItem() {}
  };

  global.document = {
    documentElement: { style: { setProperty() {} }, requestFullscreen() {} },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-kind="transcription"]') return [];
      if (selector === '[data-kind="summarization"]') return [];
      if (selector === '.mode') return [];
      return [];
    },
    addEventListener() {}
  };

  try {
    const ctx = {
      state: {
        transcriptItems: [],
        mode: 'speaker',
        paused: false,
        fontSize: 84,
        displayMargin: 4.5,
        summaryIntervalSeconds: 5,
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
        anthropicReady: false
      },
      dom: {
        ...elements,
        modeButtons: [],
        transcriptionButtons: [],
        summarizationButtons: []
      }
    };

    const runtime = createRuntime(ctx);
    runtime.setSettingsOpen(true);

    assert.equal(elements.settingsButton.attributes['aria-expanded'], 'true');
    assert.equal(elements.alertButton.attributes['aria-expanded'], 'true');

    runtime.setSettingsOpen(false);

    assert.equal(elements.settingsButton.attributes['aria-expanded'], 'false');
    assert.equal(elements.alertButton.attributes['aria-expanded'], 'false');
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  }
});

test('runtime falls back to a valid summarization source when persisted source is stale', async () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  const originalFetch = global.fetch;

  const elements = {
    apiWarning: createElement({ hidden: true }),
    status: createElement({ textContent: '' }),
    display: createElement(),
    panel: createElement(),
    manualInput: createElement(),
    liveTranscript: createElement(),
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

  global.localStorage = {
    getItem() {
      return 'stale-source';
    },
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

  global.document = {
    documentElement: { style: { setProperty() {} }, requestFullscreen() {} },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-kind="transcription"]') return [];
      if (selector === '[data-kind="summarization"]') return [];
      if (selector === '.mode') return [];
      return [];
    },
    addEventListener() {}
  };

  try {
    const ctx = {
      state: {
        transcriptItems: [],
        mode: 'speaker',
        paused: false,
        fontSize: 84,
        displayMargin: 4.5,
        summaryIntervalSeconds: 5,
        transcriptChunks: [],
        transcriptPreview: '',
        listening: false,
        loopHandle: null,
        lastSentText: '',
        settingsOpen: false,
        panelOpen: false,
        transcriptionSource: 'browser',
        summarizationSource: 'stale-source',
        openAiReady: false,
        anthropicReady: false
      },
      dom: {
        ...elements,
        modeButtons: [],
        transcriptionButtons: [],
        summarizationButtons: [],
      }
    };

    const runtime = createRuntime(ctx);
    await runtime.loadRuntimeConfig();

    assert.equal(ctx.state.summarizationSource, 'openai');
    assert.equal(elements.alertButton.hidden, false);
    assert.equal(elements.alertsSection.hidden, false);
    assert.match(elements.apiWarning.textContent, /OpenAI key is missing/i);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
    global.fetch = originalFetch;
  }
});

test('runtime collapses only the secondary controls when extras are hidden', async () => {
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;

  const elements = {
    apiWarning: createElement({ hidden: true }),
    status: createElement({ textContent: '' }),
    display: createElement(),
    panel: createElement(),
    manualInput: createElement(),
    liveTranscript: createElement(),
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
    transcriptStack: createElement(),
  };

  global.localStorage = {
    getItem() {
      return null;
    },
    setItem() {}
  };

  global.document = {
    documentElement: { style: { setProperty() {} }, requestFullscreen() {} },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-kind="transcription"]') return [];
      if (selector === '[data-kind="summarization"]') return [];
      if (selector === '.mode') return [];
      return [];
    },
    addEventListener() {}
  };

  try {
    const ctx = {
      state: {
        transcriptItems: [],
        mode: 'speaker',
        paused: false,
        fontSize: 84,
        displayMargin: 4.5,
        summaryIntervalSeconds: 5,
        transcriptChunks: [],
        transcriptPreview: '',
        listening: false,
        loopHandle: null,
        lastSentText: '',
        settingsOpen: false,
        panelOpen: false,
        transcriptionSource: 'browser',
        summarizationSource: 'openai',
        openAiReady: true,
        anthropicReady: false
      },
      dom: {
        ...elements,
        modeButtons: [],
        transcriptionButtons: [],
        summarizationButtons: []
      }
    };

    const runtime = createRuntime(ctx, {
      createTranscriptionDriverFn: () => ({ id: 'browser', start: async () => {}, stop: async () => {} }),
      createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
      fetchImpl: async () => ({ ok: true, json: async () => ({}) })
    });

    runtime.setSettingsOpen(false);

    assert.equal(elements.settingsPanel.hidden, true);
    assert.equal(elements.panel.hidden, false);
    assert.equal(elements.settingsButton.attributes['aria-expanded'], 'false');
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  }
});
