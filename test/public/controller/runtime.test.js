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
    assert.equal(elements.settingsAlertBadge.hidden, false);
    assert.equal(elements.alertsSection.hidden, false);
    assert.equal(summarizationButtons[0].dataset.configured, 'false');
    assert.equal(summarizationButtons[1].dataset.configured, 'true');
    assert.match(elements.apiWarning.textContent, /OpenAI key is missing/i);
    assert.match(elements.apiWarning.textContent, /Claude summaries remain available/i);
  });
});

test('manual addLine reports success only when a line is added', async () => {
  await withRuntimeHarness({}, async ({ ctx, runtime }) => {
    assert.equal(runtime.addLine('   '), false);
    assert.equal(ctx.state.transcriptItems.length, 0);

    assert.equal(runtime.addLine('Please stand for the next song.'), true);
    assert.equal(ctx.state.transcriptItems.length, 1);
    assert.equal(ctx.state.transcriptItems[0].text, 'Please stand for the next song.');
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

test('display margin adjustment start and end do not throw and keep guides in sync', async () => {
  await withRuntimeHarness({}, async ({ ctx, elements, runtime }) => {
    runtime.beginDisplayMarginAdjustment();

    assert.equal(ctx.state.displayMarginAdjusting, true);
    assert.equal(elements.display.dataset.marginGuides, 'true');

    runtime.endDisplayMarginAdjustment();

    assert.equal(ctx.state.displayMarginAdjusting, false);
    assert.equal(elements.display.dataset.marginGuides, 'false');
  });
});

test('display margin clamps up to forty percent', async () => {
  await withRuntimeHarness({}, async ({ elements, runtime }) => {
    runtime.setDisplayMargin(40);

    assert.equal(elements.displayMarginInput.value, '40');
    assert.equal(elements.displayMarginValue.textContent, '40.0%');
    assert.equal(globalThis.document.documentElement.style.getPropertyValue('--display-margin'), '40%');
  });
});

test('display margin visual thumb maps across the full forty percent range', async () => {
  await withRuntimeHarness({}, async ({ elements, runtime }) => {
    runtime.setDisplayMargin(20);

    assert.equal(elements.displayMarginInput.parentElement?.style?.getPropertyValue('--slider-value'), '50');
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
    assert.equal(elements.settingsAlertBadge.hidden, true);

    runtime.setSettingsOpen(false);
    assert.equal(elements.settingsButton.attributes['aria-expanded'], 'false');
    assert.equal(elements.settingsAlertBadge.hidden, true);
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
    assert.equal(elements.settingsAlertBadge.hidden, false);
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

test('runtime hides unavailable transcription sources until a service is registered', async () => {
  await withRuntimeHarness({
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
  }, async ({ elements, runtime, transcriptionButtons, summarizationButtons }) => {
    await runtime.loadRuntimeConfig();

    assert.equal(transcriptionButtons[0].hidden, false);
    assert.equal(transcriptionButtons[1].hidden, true);
    assert.equal(elements.serviceRegistrationOpenAi.attributes['aria-pressed'], 'true');
  });
});

test('runtime registers a service and reveals it in the available source lists', async () => {
  let providerKeys = {};
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/api/config')) {
      return {
        ok: true,
        json: async () => ({
          hasOpenAIKey: false,
          hasAnthropicKey: false,
          model: null,
          providerKeys,
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
    }

    if (String(url).endsWith('/api/provider/key') && options.method === 'POST') {
      providerKeys = {
        ...providerKeys,
        openai: {
          configured: true,
          origin: 'local',
          label: 'Configured locally',
          masked: 'sk-••••••••••••abcd'
        }
      };
      return {
        ok: true,
        json: async () => ({
          ok: true,
          provider: 'openai',
          providerKeys
        })
      };
    }

    return {
      ok: true,
      json: async () => ({})
    };
  };

  await withRuntimeHarness({
    fetchImpl
  }, async ({ elements, runtime, transcriptionButtons, summarizationButtons }) => {
    await runtime.loadRuntimeConfig();
    await runtime.saveProviderKey('openai', 'sk-test-1234567890abcd');

    assert.equal(transcriptionButtons[1].hidden, false);
    assert.equal(summarizationButtons[0].hidden, false);
    assert.equal(elements.serviceRegistrationOpenAi.attributes['aria-pressed'], 'true');
    assert.match(elements.serviceRegistrationKeyInput.value, /^$/);
  });
});

test('three consecutive summarize failures escalate the alert surface and double the effective interval', async () => {
  const failingDriver = {
    id: 'openai',
    summarize: async () => {
      throw new Error('rate limited');
    }
  };

  await withRuntimeHarness({
    createSummarizationDriverFn: () => failingDriver,
    stateOverrides: {
      summaryIntervalSeconds: 5,
      transcriptChunks: [{ text: 'a very important announcement', at: Date.now() }]
    }
  }, async ({ ctx, elements, runtime }) => {
    await runtime.summarizeCurrentText('first failure text');
    assert.equal(ctx.state.summarizeFailureCount, 1);
    assert.equal(elements.alertsSection.hidden, true);

    await runtime.summarizeCurrentText('second failure text');
    assert.equal(ctx.state.summarizeFailureCount, 2);
    assert.equal(elements.alertsSection.hidden, true);

    await runtime.summarizeCurrentText('third failure text');
    assert.equal(ctx.state.summarizeFailureCount, 3);
    assert.equal(elements.alertsSection.hidden, false);
    assert.equal(elements.settingsAlertBadge.hidden, false);
    assert.equal(elements.apiWarning.hidden, false);
    assert.match(elements.apiWarning.textContent, /AI summaries are failing\. Manual lines still work\./);
    assert.equal(ctx.state.effectiveIntervalSeconds, 10);
  });
});

test('a summarize success after failures clears the alert, resets the counter, and restores the interval', async () => {
  let callCount = 0;
  const flakyDriver = {
    id: 'openai',
    summarize: async () => {
      callCount += 1;
      if (callCount <= 3) {
        throw new Error('rate limited');
      }
      return { line: '' };
    }
  };

  await withRuntimeHarness({
    createSummarizationDriverFn: () => flakyDriver,
    stateOverrides: {
      summaryIntervalSeconds: 5,
      transcriptChunks: [{ text: 'a very important announcement', at: Date.now() }]
    }
  }, async ({ ctx, elements, runtime }) => {
    await runtime.summarizeCurrentText('failure one');
    await runtime.summarizeCurrentText('failure two');
    await runtime.summarizeCurrentText('failure three');

    assert.equal(ctx.state.summarizeFailureCount, 3);
    assert.equal(elements.alertsSection.hidden, false);
    assert.equal(ctx.state.effectiveIntervalSeconds, 10);

    await runtime.summarizeCurrentText('now it works');

    assert.equal(ctx.state.summarizeFailureCount, 0);
    assert.equal(ctx.state.effectiveIntervalSeconds, null);
    assert.equal(elements.alertsSection.hidden, true);
    assert.equal(elements.settingsAlertBadge.hidden, true);
    assert.equal(elements.apiWarning.hidden, true);
    assert.equal(elements.apiWarning.textContent, '');
  });
});

test('a summarize success without prior failures does not touch the alert surface', async () => {
  const succeedingDriver = {
    id: 'openai',
    summarize: async () => ({ line: '' })
  };

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      summaryIntervalSeconds: 5,
      transcriptChunks: [{ text: 'a very important announcement', at: Date.now() }]
    }
  }, async ({ ctx, elements, runtime }) => {
    await runtime.summarizeCurrentText('all good');

    assert.equal(ctx.state.summarizeFailureCount, 0);
    assert.equal(elements.alertsSection.hidden, true);
    assert.equal(elements.settingsAlertBadge.hidden, true);
  });
});
