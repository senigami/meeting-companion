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
    classList: {
      toggle() {}
    },
    setAttribute() {},
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
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    line1: createElement(),
    line2: createElement(),
    line3: createElement(),
    line4: createElement(),
    line5: createElement()
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
      if (selector === '[data-interval]') return [];
      if (selector === '.mode') return [];
      return [];
    },
    addEventListener() {}
  };

  try {
    const ctx = {
      state: {
        lines: [],
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
        panelOpen: true,
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
        intervalButtons: []
      }
    };

    const runtime = createRuntime(ctx);
    await runtime.loadRuntimeConfig();

    assert.equal(ctx.state.summarizationSource, 'claude');
    assert.equal(summarizationButtons[0].disabled, true);
    assert.equal(summarizationButtons[1].disabled, false);
    assert.equal(elements.apiWarning.hidden, false);
    assert.match(elements.apiWarning.textContent, /OPENAI_API_KEY is missing/i);
    assert.match(elements.apiWarning.textContent, /Claude summaries are available/i);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
    global.fetch = originalFetch;
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
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    line1: createElement(),
    line2: createElement(),
    line3: createElement(),
    line4: createElement(),
    line5: createElement()
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
      if (selector === '[data-interval]') return [];
      if (selector === '.mode') return [];
      return [];
    },
    addEventListener() {}
  };

  try {
    const ctx = {
      state: {
        lines: [],
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
        panelOpen: true,
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
        intervalButtons: []
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
    startListening: createElement(),
    stopListening: createElement({ disabled: true }),
    pauseAi: createElement(),
    line1: createElement(),
    line2: createElement(),
    line3: createElement(),
    line4: createElement(),
    line5: createElement()
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
      if (selector === '[data-interval]') return [];
      if (selector === '.mode') return [];
      return [];
    },
    addEventListener() {}
  };

  try {
    const ctx = {
      state: {
        lines: [],
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
        panelOpen: true,
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
        intervalButtons: []
      }
    };

    const runtime = createRuntime(ctx);
    await runtime.loadRuntimeConfig();

    assert.equal(ctx.state.summarizationSource, 'openai');
    assert.equal(elements.apiWarning.hidden, false);
    assert.match(elements.apiWarning.textContent, /OPENAI_API_KEY is missing/i);
  } finally {
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
    global.fetch = originalFetch;
  }
});
