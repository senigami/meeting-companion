import test from 'node:test';
import assert from 'node:assert/strict';

import { createElement, withRuntimeHarness } from './runtime-test-helpers.js';

test('runtime falls back to Claude summarization when OpenAI is unavailable', async () => {
  await withRuntimeHarness({
    fetchConfig: {
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
    }
  }, async ({ ctx, elements, summarizationButtons, runtime }) => {
    await runtime.loadRuntimeConfig();

    assert.equal(ctx.state.summarizationSource, 'claude');
    assert.equal(elements.alertButton.hidden, false);
    assert.equal(elements.alertsSection.hidden, false);
    assert.equal(summarizationButtons[0].dataset.configured, 'false');
    assert.equal(summarizationButtons[1].dataset.configured, 'true');
    assert.match(elements.apiWarning.textContent, /OpenAI key is missing/i);
    assert.match(elements.apiWarning.textContent, /Claude summaries remain available/i);
  });
});

test('display margin guides only appear while the margin slider is being adjusted', async () => {
  let pendingTimer = null;

  await withRuntimeHarness({
    setTimeoutFn: (callback) => {
      pendingTimer = callback;
      return 1;
    },
    clearTimeoutFn: () => {
      pendingTimer = null;
    }
  }, async ({ elements, runtime }) => {
    runtime.setDisplayMargin(6);

    assert.equal(elements.display.dataset.marginGuides, 'true');

    pendingTimer?.();

    assert.equal(elements.display.dataset.marginGuides, 'false');
  });
});

test('runtime treats browser speech recognition as available without microphone capture', async () => {
  const browserButton = createElement({ dataset: { kind: 'transcription', source: 'browser' } });

  class FakeSpeechRecognition {
    start() {}
    stop() {}
  }

  await withRuntimeHarness({
    transcriptionButtons: [browserButton],
    windowValue: { SpeechRecognition: FakeSpeechRecognition },
    navigatorValue: {}
  }, async ({ runtime }) => {
    assert.equal(runtime.isSourceConfigured('transcription', 'browser'), true);
    runtime.updateSourceButtons();
    assert.equal(browserButton.disabled, false);
  });
});

test('runtime pauses and resumes the active transcription driver', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    startCount: 0,
    stopCount: 0,
    modeHistory: [],
    async start({ currentMode } = {}) {
      this.startCount += 1;
      this.lastStartMode = currentMode;
    },
    async stop() {
      this.stopCount += 1;
    },
    setMode(mode) {
      this.modeHistory.push(mode);
    }
  };

  await withRuntimeHarness({
    stateOverrides: {
      openAiReady: true
    },
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ line: '' }) })
  }, async ({ ctx, runtime }) => {
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
  });
});

test('settings open state keeps alert and settings buttons in sync', async () => {
  await withRuntimeHarness({}, async ({ elements, runtime }) => {
    runtime.setSettingsOpen(true);
    assert.equal(elements.settingsButton.attributes['aria-expanded'], 'true');
    assert.equal(elements.alertButton.attributes['aria-expanded'], 'true');

    runtime.setSettingsOpen(false);
    assert.equal(elements.settingsButton.attributes['aria-expanded'], 'false');
    assert.equal(elements.alertButton.attributes['aria-expanded'], 'false');
  });
});

test('runtime falls back to a valid summarization source when persisted source is stale', async () => {
  await withRuntimeHarness({
    localStorageValues: {
      summarizationSource: 'stale-source'
    },
    fetchConfig: {
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
    }
  }, async ({ ctx, elements, runtime }) => {
    await runtime.loadRuntimeConfig();

    assert.equal(ctx.state.summarizationSource, 'openai');
    assert.equal(elements.alertButton.hidden, false);
    assert.equal(elements.alertsSection.hidden, false);
    assert.match(elements.apiWarning.textContent, /OpenAI key is missing/i);
  });
});

test('runtime collapses only the secondary controls when extras are hidden', async () => {
  await withRuntimeHarness({}, async ({ elements, runtime }) => {
    runtime.setSettingsOpen(false);

    assert.equal(elements.settingsPanel.hidden, true);
    assert.equal(elements.panel.hidden, false);
    assert.equal(elements.settingsButton.attributes['aria-expanded'], 'false');
  });
});
