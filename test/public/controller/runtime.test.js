import test from 'node:test';
import assert from 'node:assert/strict';

import { createElement, withRuntimeHarness } from './runtime-test-helpers.js';
import { updateStatus } from '../../../public/controller/view.js';

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

    assert.equal(elements.displayMarginInput.style.getPropertyValue('--slider-fill'), '50%');
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

test('stopping active transcription returns the rail indicator to manual', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
  }, async ({ elements, runtime }) => {
    await runtime.startListening();
    assert.equal(elements.railStatusDot.classList.contains('is-level-listening'), true);

    await runtime.stopListening();

    assert.equal(elements.railStatusDot.classList.contains('is-level-manual'), true);
    assert.equal(elements.railStatusWord.textContent, 'Manual');
  });
});

test('a fatal browser speech recognition error escalates the rail indicator to problem', async () => {
  let capturedOnStatus = null;
  const driver = {
    id: 'browser',
    label: 'Browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: (source, deps) => {
      capturedOnStatus = deps.onStatus;
      return driver;
    },
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
  }, async ({ elements, runtime }) => {
    await runtime.startListening();

    assert.equal(elements.railStatusDot.classList.contains('is-level-listening'), true);

    capturedOnStatus('Browser transcription stopped after speech recognition error: not-allowed');

    assert.equal(elements.status.textContent, 'Browser transcription stopped after speech recognition error: not-allowed');
    assert.equal(elements.railStatusDot.classList.contains('is-level-problem'), true);
    assert.equal(elements.railStatusWord.textContent, 'Problem');
  });
});

test('a driver that states its own status level is believed over the prose classifier', async () => {
  let capturedOnStatus = null;
  const driver = {
    id: 'openai',
    label: 'OpenAI',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: (source, deps) => {
      capturedOnStatus = deps.onStatus;
      return driver;
    },
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
  }, async ({ elements, runtime }) => {
    await runtime.startListening();

    // Dropping captured speech is serious, but says so in wording the classifier's regex
    // does not match -- without the stated level the rail would stay a calm green "Listening".
    const dropped = 'Falling behind live speech — skipping audio to catch back up.';
    capturedOnStatus(dropped, { level: 'problem' });

    assert.equal(elements.status.textContent, dropped);
    assert.equal(elements.railStatusDot.classList.contains('is-level-problem'), true);
    assert.equal(elements.railStatusWord.textContent, 'Problem');
  });
});

test('a transient no-speech recognition error does not escalate the rail indicator to problem', async () => {
  let capturedOnStatus = null;
  const driver = {
    id: 'browser',
    label: 'Browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: (source, deps) => {
      capturedOnStatus = deps.onStatus;
      return driver;
    },
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
  }, async ({ elements, runtime }) => {
    await runtime.startListening();

    assert.equal(elements.railStatusDot.classList.contains('is-level-listening'), true);

    // Non-fatal: the browser driver keeps listening through no-speech/aborted blips.
    capturedOnStatus('Speech recognition error: no-speech');

    assert.equal(elements.status.textContent, 'Speech recognition error: no-speech');
    assert.equal(elements.railStatusDot.classList.contains('is-level-problem'), false);
    assert.equal(elements.railStatusDot.classList.contains('is-level-listening'), true);
    assert.equal(elements.railStatusWord.textContent, 'Listening');
  });
});

test('pausing while listening is loud and honest about the microphone, resuming clears it', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ line: '' }) })
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();

    assert.equal(elements.railStatusDot.classList.contains('is-level-listening'), true);
    assert.equal(elements.railStatusWord.textContent, 'Listening');

    await runtime.togglePauseAi();

    assert.equal(ctx.state.paused, true);
    assert.equal(
      elements.status.textContent,
      'AI paused — microphone stopped. Manual lines still work.'
    );
    assert.equal(elements.pauseAi.classList.contains('is-paused'), true);
    assert.equal(elements.panel.classList.contains('is-paused'), true);
    assert.equal(elements.railStatusDot.classList.contains('is-level-paused'), true);
    assert.equal(elements.railStatusWord.textContent, 'Paused');

    await runtime.togglePauseAi();

    assert.equal(ctx.state.paused, false);
    assert.equal(elements.status.textContent, 'AI resumed — microphone listening again.');
    assert.equal(elements.pauseAi.classList.contains('is-paused'), false);
    assert.equal(elements.panel.classList.contains('is-paused'), false);
    assert.equal(elements.railStatusDot.classList.contains('is-level-listening'), true);
    assert.equal(elements.railStatusWord.textContent, 'Listening');
  });
});

test('pausing while not listening does not falsely claim the microphone stopped', async () => {
  await withRuntimeHarness({}, async ({ ctx, elements, runtime }) => {
    await runtime.togglePauseAi();

    assert.equal(ctx.state.paused, true);
    assert.equal(ctx.state.listening, false);
    assert.equal(elements.status.textContent, 'AI paused. Manual lines still work.');
    assert.equal(elements.pauseAi.classList.contains('is-paused'), true);
    assert.equal(elements.panel.classList.contains('is-paused'), true);
    assert.equal(elements.railStatusDot.classList.contains('is-level-paused'), true);
    assert.equal(elements.railStatusWord.textContent, 'Paused');

    await runtime.togglePauseAi();

    assert.equal(ctx.state.paused, false);
    assert.equal(elements.status.textContent, 'AI resumed. Microphone is still stopped.');
    assert.equal(elements.pauseAi.classList.contains('is-paused'), false);
    assert.equal(elements.panel.classList.contains('is-paused'), false);
    assert.equal(elements.railStatusDot.classList.contains('is-level-manual'), true);
    assert.equal(elements.railStatusWord.textContent, 'Manual');
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
    assert.equal(elements.railStatusDot.classList.contains('is-level-problem'), true);
    assert.equal(elements.railStatusWord.textContent, 'Problem');
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
    assert.equal(elements.railStatusDot.classList.contains('is-level-problem'), false);
    assert.equal(elements.railStatusDot.classList.contains('is-level-manual'), true);
    assert.equal(elements.railStatusWord.textContent, 'Manual');
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

test('a summarize success consumes complete sentences from the bucket and keeps the partial tail', async () => {
  const succeedingDriver = {
    id: 'openai',
    summarize: async () => ({ line: '' })
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      transcriptChunks: [
        { text: 'welcome everyone to the meeting', at: now - 30000 },
        { text: 'We sang hymn 152. And then the bishop', at: now - 1000 }
      ]
    }
  }, async ({ ctx, elements, runtime }) => {
    await runtime.summarizeCurrentText();

    assert.deepEqual(ctx.state.transcriptChunks.map((chunk) => chunk.text), ['And then the bishop']);
    // The rail preview still shows the in-flight partial (unaffected by the payload change).
    assert.equal(elements.railTranscript.textContent, 'And then the bishop');
    // The unfinished trailing sentence ("And then the bishop") must NOT be part of
    // what was sent to the summarizer -- only what was actually consumed.
    assert.equal(
      ctx.state.lastSentText,
      'welcome everyone to the meeting We sang hymn 152.'
    );
  });
});

test('the summarize payload excludes an unfinished trailing sentence', async () => {
  let sentText = null;
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript }) => {
      sentText = recentTranscript;
      return { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      transcriptChunks: [
        { text: 'There is a working bee at the hall this coming Saturday morning from nine, to tidy the garden beds and clear the gutters', at: now - 1000 }
      ],
      transcriptPreview: 'before winter'
    }
  }, async ({ runtime }) => {
    await runtime.summarizeCurrentText();

    // Nothing was complete (no terminal punctuation, not settled), so nothing
    // should have been sent at all -- not the fragment, and not the live preview.
    assert.equal(sentText, null);
  });
});

test('a tail survives in the bucket and is sent once it completes', async () => {
  let sentTexts = [];
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript }) => {
      sentTexts.push(recentTranscript);
      return { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      transcriptChunks: [
        { text: 'There is a working bee at the hall this coming Saturday morning from nine, to tidy the garden beds and clear the gutters before winter', at: now - 1000 }
      ]
    }
  }, async ({ ctx, runtime }) => {
    // First tick: the chunk has no terminal punctuation and hasn't settled, so
    // nothing is sent and the whole thing stays in the bucket.
    await runtime.summarizeCurrentText();
    assert.equal(sentTexts.length, 0);
    assert.equal(ctx.state.transcriptChunks.length, 1);

    // The speaker finishes the sentence in a later chunk; now the whole thing
    // is consumable and sent as one complete unit -- never split.
    ctx.state.transcriptChunks[0] = {
      ...ctx.state.transcriptChunks[0],
      text: `${ctx.state.transcriptChunks[0].text}.`
    };
    ctx.state.transcriptChunks.push({ text: 'Next topic starts here', at: now });
    await runtime.summarizeCurrentText();

    assert.equal(
      sentTexts[0],
      'There is a working bee at the hall this coming Saturday morning from nine, to tidy the garden beds and clear the gutters before winter.'
    );
  });
});

test('a summarize failure consumes nothing so the same text retries later', async () => {
  const failingDriver = {
    id: 'openai',
    summarize: async () => {
      throw new Error('network down');
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => failingDriver,
    stateOverrides: {
      transcriptChunks: [{ text: 'The closing hymn is number 152.', at: now - 5000 }]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();

    assert.equal(ctx.state.transcriptChunks.length, 1);
    assert.notEqual(ctx.state.lastSentText, 'The closing hymn is number 152.');

    // Retry is not blocked by the lastSentText guard after a failure.
    let secondAttemptText = null;
    failingDriver.summarize = async ({ recentTranscript }) => {
      secondAttemptText = recentTranscript;
      return { line: '' };
    };
    await runtime.summarizeCurrentText();
    assert.equal(secondAttemptText, 'The closing hymn is number 152.');
    assert.equal(ctx.state.transcriptChunks.length, 0);
  });
});

test('overlapping summarize calls are serialized by the in-flight guard', async () => {
  let resolveFirst;
  let calls = 0;
  const slowDriver = {
    id: 'openai',
    summarize: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveFirst = () => resolve({ line: '' });
      });
    }
  };

  await withRuntimeHarness({
    createSummarizationDriverFn: () => slowDriver,
    stateOverrides: {
      transcriptChunks: [{ text: 'An announcement about the picnic.', at: Date.now() - 5000 }]
    }
  }, async ({ runtime }) => {
    const first = runtime.summarizeCurrentText();
    await new Promise((resolve) => setImmediate(resolve));
    const second = runtime.summarizeCurrentText();
    await new Promise((resolve) => setImmediate(resolve));
    resolveFirst();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  });
});

test('arming clear and letting the timeout elapse reverts without clearing anything', async () => {
  let pendingTimer = null;

  await withRuntimeHarness({
    setTimeoutFn: (callback) => {
      pendingTimer = callback;
      return 1;
    },
    clearTimeoutFn: () => {
      pendingTimer = null;
    },
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }]
    }
  }, async ({ ctx, elements, runtime }) => {
    runtime.clearLines();

    assert.equal(ctx.state.clearArmed, true);
    assert.equal(ctx.state.transcriptItems.length, 2);
    assert.equal(elements.clearLabel.textContent, 'Confirm?');
    assert.equal(elements.clear.getAttribute('aria-label'), 'Confirm clear all lines');

    pendingTimer?.();

    assert.equal(ctx.state.clearArmed, false);
    assert.equal(ctx.state.transcriptItems.length, 2);
    assert.equal(elements.clearLabel.textContent, 'Clear');
    assert.equal(elements.clear.getAttribute('aria-label'), 'Clear all lines');
  });
});

test('confirming an armed clear wipes the transcript, snapshots it, and announces the result', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }]
    }
  }, async ({ ctx, elements, runtime }) => {
    runtime.clearLines();
    assert.equal(ctx.state.clearArmed, true);

    runtime.clearLines();

    assert.equal(ctx.state.clearArmed, false);
    assert.equal(ctx.state.transcriptItems.length, 0);
    assert.equal(ctx.state.lastClearedItems.length, 2);
    assert.equal(elements.status.textContent, 'Cleared 2 lines — press U or click Undo to bring them back.');
    assert.equal(elements.clearLabel.textContent, 'Clear');
  });
});

test('undo after a clear restores the whole snapshot exactly once', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }, { text: 'third line' }]
    }
  }, async ({ ctx, runtime }) => {
    runtime.clearLines();
    runtime.clearLines();
    assert.equal(ctx.state.transcriptItems.length, 0);

    runtime.undoLine();

    assert.equal(ctx.state.transcriptItems.length, 3);
    assert.equal(ctx.state.transcriptItems[0].text, 'first line');
    assert.equal(ctx.state.lastClearedItems, null);

    runtime.undoLine();

    assert.equal(ctx.state.transcriptItems.length, 2);
  });
});

test('normal undo still pops the last line when there is no pending clear snapshot', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }]
    }
  }, async ({ ctx, runtime }) => {
    runtime.undoLine();

    assert.equal(ctx.state.transcriptItems.length, 1);
    assert.equal(ctx.state.transcriptItems[0].text, 'first line');
    assert.equal(ctx.state.lastClearedItems, null);
  });
});

test('undo of a single line reports which line was removed', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }]
    }
  }, async ({ elements, runtime }) => {
    runtime.undoLine();

    assert.equal(elements.status.textContent, 'Removed: "second line"');
  });
});

test('undo status truncates long removed lines to about 40 characters', async () => {
  const longLine = 'This is a very long transcript line that goes on and on past forty characters';
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: longLine }]
    }
  }, async ({ elements, runtime }) => {
    runtime.undoLine();

    assert.equal(elements.status.textContent, `Removed: "${longLine.slice(0, 40)}…"`);
  });
});

test('undo after a clear restores the snapshot without overwriting its own status message', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }]
    }
  }, async ({ elements, runtime }) => {
    runtime.clearLines();
    runtime.clearLines();
    assert.equal(elements.status.textContent, 'Cleared 2 lines — press U or click Undo to bring them back.');

    runtime.undoLine();

    assert.equal(elements.status.textContent, 'Cleared 2 lines — press U or click Undo to bring them back.');
  });
});

test('arming clear does not clear anything on its own even if the transcript is empty', async () => {
  await withRuntimeHarness({}, async ({ ctx, runtime }) => {
    runtime.clearLines();

    assert.equal(ctx.state.clearArmed, true);
    assert.equal(ctx.state.transcriptItems.length, 0);
    assert.equal(ctx.state.lastClearedItems, null);
  });
});

test('cancelling an armed clear reverts the button state immediately', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }]
    }
  }, async ({ ctx, elements, runtime }) => {
    runtime.clearLines();
    assert.equal(ctx.state.clearArmed, true);

    runtime.cancelClearArm();

    assert.equal(ctx.state.clearArmed, false);
    assert.equal(ctx.state.transcriptItems.length, 1);
    assert.equal(elements.clearLabel.textContent, 'Clear');
  });
});

test('confirming an armed clear also flashes the always-visible rail note', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }]
    }
  }, async ({ elements, runtime }) => {
    runtime.clearLines();
    runtime.clearLines();

    assert.equal(elements.railNote.hidden, false);
    assert.equal(elements.railNote.textContent, 'Cleared 2 lines — press U or click Undo to bring them back.');
  });
});

test('undo of a single line also flashes the always-visible rail note', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }]
    }
  }, async ({ elements, runtime }) => {
    runtime.undoLine();

    assert.equal(elements.railNote.hidden, false);
    assert.equal(elements.railNote.textContent, 'Removed: "second line"');
  });
});

test('undo after a clear flashes a short restored-count rail note', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }, { text: 'third line' }]
    }
  }, async ({ elements, runtime }) => {
    runtime.clearLines();
    runtime.clearLines();

    runtime.undoLine();

    assert.equal(elements.railNote.hidden, false);
    assert.equal(elements.railNote.textContent, 'Restored 3 lines.');
  });
});

test('rapid clear-confirm and undo actions reset the rail note timer instead of flickering', async () => {
  const cleared = [];
  let nextId = 0;

  await withRuntimeHarness({
    setTimeoutFn: () => {
      nextId += 1;
      return nextId;
    },
    clearTimeoutFn: (id) => {
      cleared.push(id);
    },
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }]
    }
  }, async ({ ctx, elements, runtime }) => {
    runtime.clearLines();
    runtime.clearLines();
    const firstTimer = ctx.state.railNoteTimer;

    runtime.undoLine();

    assert.ok(cleared.includes(firstTimer));
    assert.equal(elements.railNote.textContent, 'Restored 2 lines.');
    assert.equal(elements.railNote.hidden, false);
  });
});

test('clearing an already-empty transcript does not overwrite the undo snapshot', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }, { text: 'second line' }]
    }
  }, async ({ ctx, elements, runtime }) => {
    runtime.clearLines();
    runtime.clearLines();
    assert.equal(ctx.state.transcriptItems.length, 0);
    assert.equal(ctx.state.lastClearedItems.length, 2);

    runtime.clearLines();
    runtime.clearLines();

    assert.equal(elements.status.textContent, 'Nothing to clear.');
    assert.equal(ctx.state.lastClearedItems.length, 2);

    runtime.undoLine();

    assert.equal(ctx.state.transcriptItems.length, 2);
    assert.equal(ctx.state.transcriptItems[0].text, 'first line');
    assert.equal(ctx.state.transcriptItems[1].text, 'second line');
  });
});

test('silence watchdog fires "Check mic" after 45s of no transcript events while listening', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  let currentTime = 1000;
  const nowFn = () => currentTime;
  const scheduled = [];
  const setTimeoutFn = (callback, delay) => {
    const id = { callback, delay };
    scheduled.push(id);
    return id;
  };
  const clearTimeoutFn = (id) => {
    const index = scheduled.indexOf(id);
    if (index !== -1) scheduled.splice(index, 1);
  };

  const runOnePendingCheck = () => {
    // Run exactly the one watchdog timer queued right now, letting it re-schedule its own next
    // check -- draining the whole queue here would loop forever, since each check always queues
    // exactly one more.
    const [next] = scheduled.splice(0, 1);
    next?.callback();
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    nowFn,
    setTimeoutFn,
    clearTimeoutFn
  }, async ({ elements, ctx, runtime }) => {
    await runtime.startListening();
    assert.equal(elements.railStatusDot.classList.contains('is-level-listening'), true);

    // Advance in 5s steps (the watchdog's own re-check cadence) to 40s -- still short of the 45s
    // threshold, so a normal pause in speech must not trip the alarm.
    for (let i = 0; i < 8; i += 1) {
      currentTime += 5000;
      runOnePendingCheck();
    }
    assert.equal(ctx.state.railStatusLevel, 'listening');
    assert.equal(elements.railStatusDot.classList.contains('is-level-silence'), false);

    // Cross the 45s threshold.
    currentTime += 5000;
    runOnePendingCheck();

    assert.equal(ctx.state.railStatusLevel, 'silence');
    assert.equal(elements.railStatusDot.classList.contains('is-level-silence'), true);
    assert.equal(elements.railStatusWord.textContent, 'Check mic');
    assert.match(elements.status.textContent, /No transcript activity for 45s/);
    assert.match(elements.status.textContent, /check the microphone|switch to manual/i);
    // A gentler, unconfirmed signal -- not styled or announced as a confirmed fatal problem.
    assert.equal(elements.railNote.classList.contains('is-problem'), false);
    assert.equal(elements.railNote.classList.contains('is-silence'), true);
    assert.equal(elements.railNote.attributes.role, 'status');

    // A new transcript event arriving recovers the rail back to plain "Listening".
    runtime.handleTranscriptEvent({ type: 'final', text: 'The mic is back.' });
    assert.equal(ctx.state.railStatusLevel, 'listening');
    assert.equal(elements.railStatusWord.textContent, 'Listening');
    assert.equal(elements.railNote.classList.contains('is-silence'), false);
  });
});

test('silence watchdog never fires while paused, stopped, or in manual mode', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  let currentTime = 0;
  const nowFn = () => currentTime;
  const scheduled = [];
  const setTimeoutFn = (callback) => {
    const id = { callback };
    scheduled.push(id);
    return id;
  };
  const clearTimeoutFn = (id) => {
    const index = scheduled.indexOf(id);
    if (index !== -1) scheduled.splice(index, 1);
  };
  const runOnePendingCheck = () => {
    const [next] = scheduled.splice(0, 1);
    next?.callback();
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    nowFn,
    setTimeoutFn,
    clearTimeoutFn
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();
    await runtime.togglePauseAi();

    currentTime += 120000;
    runOnePendingCheck();

    assert.notEqual(ctx.state.railStatusLevel, 'silence');
    assert.equal(elements.railStatusDot.classList.contains('is-level-silence'), false);
  });
});

test('the silence watchdog never clobbers a confirmed problem, even after 45s of no transcript events', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  let currentTime = 0;
  const nowFn = () => currentTime;
  const scheduled = [];
  const setTimeoutFn = (callback, delay) => {
    const id = { callback, delay };
    scheduled.push(id);
    return id;
  };
  const clearTimeoutFn = (id) => {
    const index = scheduled.indexOf(id);
    if (index !== -1) scheduled.splice(index, 1);
  };
  const runOnePendingCheck = () => {
    const [next] = scheduled.splice(0, 1);
    next?.callback();
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    nowFn,
    setTimeoutFn,
    clearTimeoutFn
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();

    // A confirmed problem is already showing -- e.g. the summarize-failure escalation, or any
    // other genuinely fatal condition (INV-10). Reproduced directly here rather than driving the
    // whole summarize-backoff path, which is owned elsewhere -- only the resulting
    // rail level matters to this test.
    updateStatus(
      ctx,
      'Falling behind live speech — some speech will be missing from the transcript',
      { level: 'problem' }
    );
    assert.equal(ctx.state.railStatusLevel, 'problem');

    // 45s pass with no transcript events -- precisely the case where audio is being shed or a
    // backoff has paused sends for up to 60s, i.e. the fault IS the server path, not the mic.
    for (let i = 0; i < 9; i += 1) {
      currentTime += 5000;
      runOnePendingCheck();
    }

    // The watchdog must not silently downgrade a confirmed problem into "Check mic" -- that would
    // send the operator to the microphone when the real fault is elsewhere.
    assert.equal(ctx.state.railStatusLevel, 'problem');
    assert.equal(elements.railStatusDot.classList.contains('is-level-problem'), true);
    assert.equal(elements.railStatusDot.classList.contains('is-level-silence'), false);
    assert.equal(elements.railNote.textContent, '⚠ Falling behind live speech — some speech will be missing from the transcript');

    // Recovery still works once the condition itself clears (not via the watchdog).
    runtime.handleTranscriptEvent({ type: 'final', text: 'The mic is back.' });
    updateStatus(ctx, 'Listening.', { level: 'listening' });
    assert.equal(ctx.state.railStatusLevel, 'listening');
    assert.equal(elements.railNote.textContent, '');
  });
});

test('a backgrounded tab regaining visibility resyncs the summarize loop and forgives the gap', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  let capturedHandler = null;
  const fakeDocument = {
    hidden: true,
    addEventListener(type, handler) {
      if (type === 'visibilitychange') capturedHandler = handler;
    }
  };

  let currentTime = 0;
  const nowFn = () => currentTime;

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    nowFn,
    documentImpl: fakeDocument
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    assert.equal(typeof capturedHandler, 'function');

    // The tab was backgrounded and throttled for a long stretch -- a real gap, but not a real
    // outage. lastTranscriptEventAt is left stale from startListening.
    currentTime = 90000;
    const loopHandleBeforeResync = ctx.state.loopHandle;

    fakeDocument.hidden = false;
    capturedHandler();

    // The watchdog's clock is reset rather than being left to fire the instant the tab wakes up.
    assert.equal(ctx.state.lastTranscriptEventAt, currentTime);
    // The summarize loop was restarted (resynced) rather than left at its throttled cadence.
    assert.notEqual(ctx.state.loopHandle, loopHandleBeforeResync);
  });
});
