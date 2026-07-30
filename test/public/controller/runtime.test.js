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
    assert.equal(summarizationButtons[0].dataset.configured, 'false');
    assert.equal(summarizationButtons[1].dataset.configured, 'true');

    // The fallback SUCCEEDED: summaries are running on Claude, which has a key. Nothing is wrong, so
    // nothing is alerted. This test previously required the opposite -- an "OpenAI key is missing"
    // warning about the provider the app had just correctly moved away from, which is a standing
    // alert the operator cannot clear and did not cause. The unconfigured state of OpenAI is still
    // visible where it belongs: summarizationButtons[0].dataset.configured is 'false' above.
    assert.equal(elements.settingsAlertBadge.hidden, true);
    assert.equal(elements.alertsSection.hidden, true);
    assert.equal(elements.apiWarning.textContent, '');
  });
});

test('fresh install with no provider keys defaults to demo summaries with no alert and no switch note', async () => {
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
  }, async ({ ctx, elements, runtime }) => {
    await runtime.loadRuntimeConfig();

    assert.equal(ctx.state.summarizationSource, 'demo');
    assert.equal(elements.settingsAlertBadge.hidden, true);
    assert.equal(elements.alertsSection.hidden, true);
    assert.equal(elements.apiWarning.textContent, '');
    // No keys is the expected first-run state, not a fallback the operator needs to be told about.
    assert.equal(elements.railNote.textContent, '');
    // Nothing recorded a choice. Falsy rather than literally false: start-app.js seeds this field
    // and the test harness does not, so an unseeded `undefined` is the real first-run shape here.
    assert.ok(!ctx.state.summarizationSourceChosen);
    // And the default must NOT be persisted. A stored 'demo' has to keep meaning "the operator chose
    // this"; once the app writes the same value to mean "I picked this for you", the next boot cannot
    // tell them apart. The regression test below is what that actually caused.
    assert.notEqual(localStorage.getItem('summarizationSource'), 'demo');
  });
});

// REGRESSION (caught at the pre-commit gate, 2026-07-26). Demo went sticky: the keyless first run persisted
// summarizationSource='demo' without a chosen flag, so on the next boot WITH a real key the
// honour-demo rule fired on a choice nobody made. Result: rehearsal-script sentences on a live wall,
// no alert, in front of the one person who cannot hear the room to know the wall is wrong -- INV-13's
// exact failure, introduced by the same commit that added INV-13.
test('demo does not become sticky: a key appearing after a keyless run wins over an unchosen demo', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      summarizationSource: 'demo',
      summarizationSourceChosen: false
    },
    fetchConfig: {
      hasOpenAIKey: true,
      hasAnthropicKey: false,
      model: 'gpt-4o-mini',
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
  }, async ({ ctx, runtime }) => {
    await runtime.loadRuntimeConfig();

    assert.equal(ctx.state.summarizationSource, 'openai');
    assert.notEqual(ctx.state.summarizationSource, 'demo');
  });
});

test('an explicitly chosen demo IS honoured even when a real key is available', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      summarizationSource: 'demo',
      summarizationSourceChosen: true
    },
    fetchConfig: {
      hasOpenAIKey: true,
      hasAnthropicKey: false,
      model: 'gpt-4o-mini',
      sources: {
        transcription: [{ id: 'browser', label: 'Browser', description: 'Browser' }],
        summarization: [
          { id: 'openai', label: 'OpenAI', description: 'OpenAI' },
          { id: 'demo', label: 'Demo', description: 'Demo' }
        ]
      }
    }
  }, async ({ ctx, runtime }) => {
    await runtime.loadRuntimeConfig();

    // Rehearsing before a meeting with a key already configured is legitimate; the flag is what
    // separates it from the app choosing demo on the operator's behalf.
    assert.equal(ctx.state.summarizationSource, 'demo');
  });
});

// INV-13 note for this test: it also pins that the alert copy names REAL alternatives only. Offering
// Demo as the fix would be telling the operator to put rehearsal text on a live wall.
test('an operator who actively chose an unconfigured provider still gets the alert, naming only real alternatives', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      summarizationSourceChosen: true,
      summarizationSource: 'openai'
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
    assert.match(elements.apiWarning.textContent, /OpenAI is selected for summaries but has no key/i);
    assert.doesNotMatch(elements.apiWarning.textContent, /demo/i);
  });
});

test('unchosen with no OpenAI key but an Anthropic key falls back to Claude, not demo, and still flashes the switch note', async () => {
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
  }, async ({ ctx, elements, runtime }) => {
    await runtime.loadRuntimeConfig();

    assert.equal(ctx.state.summarizationSource, 'claude');
    assert.match(elements.railNote.textContent, /Summaries switched to Claude \(previous source unavailable\)\./);
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

test('starting to listen begins the live-transcript progress bar sweep for the configured interval', async () => {
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    stateOverrides: { summaryIntervalSeconds: 5 }
  }, async ({ elements, runtime }) => {
    await runtime.startListening();

    assert.equal(elements.railTranscriptProgress.dataset.state, 'running');
    assert.equal(elements.railTranscriptProgressFill.style.width, '100%');
    assert.equal(elements.railTranscriptProgressFill.style.transitionDuration, '5s');
  });
});

test('changing the update interval mid-session re-syncs the progress bar to the new duration', async () => {
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    stateOverrides: { summaryIntervalSeconds: 5 }
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();
    assert.equal(elements.railTranscriptProgressFill.style.transitionDuration, '5s');

    runtime.setSummaryInterval(9);

    // A bar still counting down to the OLD duration after the operator moved the slider would be a
    // lie about the cadence actually in effect -- this must reflect the new interval immediately.
    assert.equal(ctx.state.summaryIntervalSeconds, 9);
    assert.equal(elements.railTranscriptProgressFill.style.transitionDuration, '9s');
    assert.equal(elements.railTranscriptProgress.dataset.state, 'running');
  });
});

test('pausing AI stops the progress bar sweep honestly instead of leaving it running', async () => {
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    stateOverrides: { summaryIntervalSeconds: 5 }
  }, async ({ elements, runtime }) => {
    await runtime.startListening();
    assert.equal(elements.railTranscriptProgress.dataset.state, 'running');

    await runtime.togglePauseAi();

    assert.equal(elements.railTranscriptProgress.dataset.state, 'idle');
    assert.equal(elements.railTranscriptProgressFill.style.width, '0%');

    await runtime.togglePauseAi();
    assert.equal(elements.railTranscriptProgress.dataset.state, 'running');
  });
});

test('stopping listening idles the progress bar', async () => {
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
  }, async ({ elements, runtime }) => {
    await runtime.startListening();
    assert.equal(elements.railTranscriptProgress.dataset.state, 'running');

    await runtime.stopListening();

    assert.equal(elements.railTranscriptProgress.dataset.state, 'idle');
  });
});

test('a scheduled tick that finds the previous summarize call still in flight freezes the progress bar instead of restarting a fresh sweep', async () => {
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  // Capture the actual callback runtime.js hands to the real setInterval, so the tick can be fired
  // synchronously without waiting on a real timer.
  const originalSetInterval = global.setInterval;
  let capturedTick = null;
  global.setInterval = (fn, ms) => {
    capturedTick = fn;
    return originalSetInterval(() => {}, ms);
  };

  try {
    await withRuntimeHarness({
      createTranscriptionDriverFn: () => driver,
      createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
    }, async ({ ctx, elements, runtime }) => {
      await runtime.startListening();
      assert.equal(elements.railTranscriptProgress.dataset.state, 'running');
      assert.equal(typeof capturedTick, 'function');

      // Simulate the in-flight guard: a slow summarize call is still running when the next tick fires.
      ctx.state.summarizeInFlight = true;
      capturedTick();

      assert.equal(elements.railTranscriptProgress.dataset.state, 'overrun');
      assert.equal(elements.railTranscriptProgressFill.style.width, '100%');

      clearInterval(ctx.state.loopHandle);
    });
  } finally {
    global.setInterval = originalSetInterval;
  }
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

test('buildTranscriptionDriver passes the nine ctx.state.audio* values through as audioSettings', async () => {
  let capturedDeps = null;
  const driver = {
    id: 'openai',
    label: 'OpenAI',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    stateOverrides: {
      transcriptionSource: 'openai',
      openAiReady: true,
      audioProcessingPreset: 'normal',
      audioHighPassEnabled: false,
      audioHighPassHz: 120,
      audioCompressorEnabled: false,
      audioLimiterEnabled: false,
      audioBrowserAgc: false,
      audioBrowserNoiseSuppression: true,
      audioBrowserEchoCancel: true,
      audioConditioningEnabled: true,
      audioDeviceId: 'mic-1'
    },
    createTranscriptionDriverFn: (source, deps) => {
      capturedDeps = deps;
      return driver;
    },
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
  }, async ({ runtime }) => {
    await runtime.startListening();

    assert.deepEqual(capturedDeps.audioSettings, {
      audioProcessingPreset: 'normal',
      audioHighPassEnabled: false,
      audioHighPassHz: 120,
      audioCompressorEnabled: false,
      audioLimiterEnabled: false,
      audioBrowserAgc: false,
      audioBrowserNoiseSuppression: true,
      audioBrowserEchoCancel: true,
      audioConditioningEnabled: true,
      audioDeviceId: 'mic-1'
    });
    assert.equal(typeof capturedDeps.onAudioDiagnostics, 'function');
  });
});

test('the once-per-start microphone-constraints diagnostic reaches #status without touching the rail; other diagnostics do not', async () => {
  let capturedDeps = null;
  const driver = {
    id: 'openai',
    label: 'OpenAI',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    stateOverrides: { transcriptionSource: 'openai', openAiReady: true },
    createTranscriptionDriverFn: (source, deps) => {
      capturedDeps = deps;
      return driver;
    },
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
  }, async ({ elements, runtime }) => {
    await runtime.startListening();

    const priorLevel = elements.railStatusWord.textContent;
    // A diagnostic reaches the status line when the PRODUCER marks it notable, not when the consumer
    // recognises its opening words. The prose-prefix version of this check sent "the chosen microphone
    // was unavailable" to the console alone, which meant the app silently overrode a device the
    // operator had picked on purpose.
    capturedDeps.onAudioDiagnostics({ message: 'Microphone constraints granted: autoGainControl=true', notable: true });
    assert.equal(elements.status.textContent, 'Microphone constraints granted: autoGainControl=true');
    assert.equal(elements.railStatusWord.textContent, priorLevel, 'a diagnostic must not raise the rail level');

    // Recurring, unmarked diagnostics stay in the console: on the rail they would fire every ~500ms
    // and bury everything else.
    capturedDeps.onAudioDiagnostics({ message: 'Level measurement failed (x); AGC paused, capture continues.' });
    assert.equal(elements.status.textContent, 'Microphone constraints granted: autoGainControl=true');

    // The regression this change exists for.
    capturedDeps.onAudioDiagnostics({
      message: 'The chosen microphone was unavailable; using the system default instead.',
      notable: true
    });
    assert.equal(
      elements.status.textContent,
      'The chosen microphone was unavailable; using the system default instead.'
    );
  });
});

test('the transcription driver is given a mode setter it can use to change the active summarization mode', async () => {
  let capturedOnModeChange = null;
  const driver = {
    id: 'demo',
    label: 'Demo',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: (source, deps) => {
      capturedOnModeChange = deps.onModeChange;
      return driver;
    },
    createSummarizationDriverFn: () => ({ id: 'demo', summarize: async () => ({ line: '' }) })
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();

    assert.equal(typeof capturedOnModeChange, 'function');
    assert.equal(ctx.state.mode, 'speaker');

    capturedOnModeChange('information');
    assert.equal(ctx.state.mode, 'information');

    capturedOnModeChange('song');
    assert.equal(ctx.state.mode, 'song');
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

test('runtime falls back to demo when persisted source is stale, unchosen, and no keys are configured', async () => {
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

    // Nothing was ever actively chosen and no keys are configured, so this is the expected
    // first-run state (demo), not an error -- regardless of what stale value happened to be
    // stored under the old default.
    assert.equal(ctx.state.summarizationSource, 'demo');
    assert.equal(elements.settingsAlertBadge.hidden, true);
    assert.equal(elements.alertsSection.hidden, true);
    assert.equal(elements.apiWarning.textContent, '');
  });
});

test('runtime falls back to an unconfigured but chosen source and alerts, when a stale source was chosen and no keys exist', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      summarizationSourceChosen: true
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
    assert.match(elements.apiWarning.textContent, /OpenAI is selected for summaries but has no key/i);
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

// Minimal DOM stand-in for the in-flight dimming tests below: showRecentTranscript builds
// spans/text nodes directly via documentImpl.createElement/createTextNode rather than assigning
// textContent, so exercising that path needs a container that actually accepts appendChild and
// element nodes that record their own className/textContent (a flat string via `elements.*
// .textContent`, as the other tests use, can't distinguish "dimmed" from "not dimmed").
function fakeRailDom() {
  function makeContainer() {
    let children = [];
    return {
      // Real DOM semantics: assigning .textContent replaces all children with a single text
      // node (or none, for ''). showRecentTranscript relies on this to clear stale spans before
      // re-rendering -- a stub that only recorded the string without also dropping `children`
      // would leave previous renders' dimmed spans behind and fail every un-dim assertion below.
      get textContent() {
        return children.map((c) => c.textContent).join('');
      },
      set textContent(value) {
        children = value ? [{ nodeType: 3, textContent: value }] : [];
      },
      scrollTop: 0,
      scrollHeight: 0,
      get children() {
        return children;
      },
      appendChild(node) {
        children.push(node);
      }
    };
  }
  const documentImpl = {
    createElement(tag) {
      return { tag, className: '', textContent: '', children: [], appendChild(node) { this.children.push(node); } };
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: text };
    }
  };
  return { documentImpl, container: makeContainer() };
}

// Flattens the rendered rail-transcript node tree into [{ text, dimmed }] segments in order, so
// tests can assert both the visible text and which parts of it are dimmed without depending on
// the internal DOM shape.
function readRailSegments(container) {
  return container.children
    .filter((node) => node.textContent.trim() !== '')
    .map((node) => ({
      text: node.textContent.trim(),
      dimmed: node.className === 'transcriptChunk--inFlight'
    }));
}

// Flushes the microtask queue enough times for `await ensureSummarizationDriver()` and the
// subsequent `await driver.summarize(...)` call to actually reach the driver -- summarizeCurrentText
// awaits before ever calling into the stalling driver below, so asserting the in-flight/dimmed
// state right after calling it (with no await at all) would run before the driver's promise
// executor has even been invoked.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('in-flight text (sent to the summarizer, not yet consumed) is dimmed on the rail the moment the call goes out', async () => {
  let resolveSummarize;
  const stallingDriver = {
    id: 'openai',
    summarize: () => new Promise((resolve) => { resolveSummarize = resolve; })
  };
  const now = Date.now();
  const { documentImpl, container } = fakeRailDom();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => stallingDriver,
    documentImpl,
    elementOverrides: { railTranscript: container },
    stateOverrides: {
      transcriptChunks: [{ text: 'welcome everyone to the meeting.', at: now, mode: 'speaker' }]
    }
  }, async ({ ctx, runtime }) => {
    const pending = runtime.summarizeCurrentText();
    await flushMicrotasks();

    // Dimmed the moment the call is sent -- before the response comes back.
    assert.equal(ctx.state.inFlightChunks.length, 1);
    const segments = readRailSegments(container);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].dimmed, true);
    assert.equal(segments[0].text, 'welcome everyone to the meeting.');

    resolveSummarize({ line: '' });
    await pending;
    // Success: the bucket drained it, so it is gone entirely -- not merely un-dimmed.
    assert.equal(ctx.state.inFlightChunks.length, 0);
    assert.equal(ctx.state.transcriptChunks.length, 0);
    assert.equal(readRailSegments(container).length, 0);
  });
});

test('in-flight text un-dims (stays visible, not removed) when the summarize call fails', async () => {
  let rejectSummarize;
  const failingDriver = {
    id: 'openai',
    summarize: () => new Promise((_resolve, reject) => { rejectSummarize = reject; })
  };
  const now = Date.now();
  const { documentImpl, container } = fakeRailDom();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => failingDriver,
    documentImpl,
    elementOverrides: { railTranscript: container },
    stateOverrides: {
      transcriptChunks: [{ text: 'welcome everyone to the meeting.', at: now, mode: 'speaker' }]
    }
  }, async ({ ctx, runtime }) => {
    const pending = runtime.summarizeCurrentText();
    await flushMicrotasks();
    assert.equal(readRailSegments(container)[0].dimmed, true);

    rejectSummarize(new Error('network down'));
    await pending;

    // Never consumed (INV-11) -- still fully present, and no longer dimmed, proving the text
    // that was "in flight" is the same text that comes back, not a promise taken on faith.
    assert.equal(ctx.state.inFlightChunks.length, 0);
    assert.deepEqual(ctx.state.transcriptChunks.map((c) => c.text), ['welcome everyone to the meeting.']);
    const segments = readRailSegments(container);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].dimmed, false);
    assert.equal(segments[0].text, 'welcome everyone to the meeting.');
  });
});

test('in-flight text un-dims when paused mid-flight, before the (too-late) response arrives', async () => {
  let resolveSummarize;
  const stallingDriver = {
    id: 'openai',
    summarize: () => new Promise((resolve) => { resolveSummarize = resolve; })
  };
  const now = Date.now();
  const { documentImpl, container } = fakeRailDom();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => stallingDriver,
    documentImpl,
    elementOverrides: { railTranscript: container },
    stateOverrides: {
      transcriptChunks: [{ text: 'welcome everyone to the meeting.', at: now, mode: 'speaker' }]
    }
  }, async ({ ctx, runtime }) => {
    const pending = runtime.summarizeCurrentText();
    await flushMicrotasks();
    assert.equal(readRailSegments(container)[0].dimmed, true);

    ctx.state.paused = true;
    resolveSummarize({ line: '' });
    await pending;

    // Paused before the response landed -- the early `if (ctx.state.paused) return;` guard means
    // this was never consumed either, so it must read exactly like the failure case above.
    assert.equal(ctx.state.inFlightChunks.length, 0);
    assert.deepEqual(ctx.state.transcriptChunks.map((c) => c.text), ['welcome everyone to the meeting.']);
    assert.equal(readRailSegments(container)[0].dimmed, false);
  });
});

test('only the in-flight (oldest mode run) portion dims -- a later chunk in a different mode is held back and stays undimmed', async () => {
  let resolveSummarize;
  const stallingDriver = {
    id: 'openai',
    summarize: () => new Promise((resolve) => { resolveSummarize = resolve; })
  };
  const now = Date.now();
  const { documentImpl, container } = fakeRailDom();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => stallingDriver,
    documentImpl,
    elementOverrides: { railTranscript: container },
    stateOverrides: {
      // A mode boundary ends the oldest run early (takeOldestModeRun) -- only the leading
      // 'speaker' chunk is sent; the 'information' chunk after it is never part of this call.
      transcriptChunks: [
        { text: 'welcome everyone to the meeting.', at: now - 30000, mode: 'speaker' },
        { text: 'The potluck is Saturday.', at: now, mode: 'information' }
      ]
    }
  }, async ({ ctx, runtime }) => {
    const pending = runtime.summarizeCurrentText();
    await flushMicrotasks();

    assert.deepEqual(ctx.state.inFlightChunks.map((c) => c.text), ['welcome everyone to the meeting.']);
    const segments = readRailSegments(container);
    assert.equal(segments.length, 2);
    assert.equal(segments[0].text, 'welcome everyone to the meeting.');
    assert.equal(segments[0].dimmed, true);
    assert.equal(segments[1].text, 'The potluck is Saturday.');
    assert.equal(segments[1].dimmed, false, 'a chunk in a different mode was never sent, so it must not dim');

    resolveSummarize({ line: '' });
    await pending;
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

test('a backlog well over 1000 characters is sent and consumed as one card, with nothing dropped from the head', async () => {
  let sentText = null;
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript }) => {
      sentText = recentTranscript;
      return { line: '' };
    }
  };
  const now = Date.now();
  const chunkA = `A speaker gives a very long announcement about the schedule for next week. ${'word '.repeat(120)}.`.trim();
  const chunkB = `A second complete sentence continues the announcement with more detail. ${'more '.repeat(120)}.`.trim();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      transcriptChunks: [
        { text: chunkA, at: now - 5000, mode: 'speaker' },
        { text: chunkB, at: now - 1000, mode: 'speaker' }
      ]
    }
  }, async ({ ctx, runtime }) => {
    assert.ok(chunkA.length + chunkB.length > 1000, 'fixture must exceed the old 1000-char send cap');

    await runtime.summarizeCurrentText();

    // Sent-set equals consumed-set, asserted on the actual strings: everything pending went out in
    // one call, and everything that went out is exactly what got consumed -- nothing left over
    // pretending to be "not yet sent," and no silent slicing of the head.
    assert.equal(sentText, `${chunkA} ${chunkB}`);
    assert.equal(ctx.state.transcriptChunks.length, 0);
    assert.equal(ctx.state.lastSentText, sentText);
  });
});

test('lag stays bounded at one card across several ticks of a fast speaker, not a growing backlog', async () => {
  const succeedingDriver = {
    id: 'openai',
    summarize: async () => ({ line: '' })
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      transcriptChunks: [
        { text: 'First utterance of the meeting is complete.', at: now - 9000, mode: 'speaker' },
        { text: 'Second utterance also lands before the first tick.', at: now - 6000, mode: 'speaker' }
      ]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();
    assert.equal(ctx.state.transcriptChunks.length, 0);

    // More speech arrives after the drain, at the volume a fast speaker produces between ticks.
    ctx.state.transcriptChunks.push(
      { text: 'Third utterance arrives after the first tick drained everything.', at: now - 3000, mode: 'speaker' },
      { text: 'Fourth utterance keeps the bucket from ever emptying on its own.', at: now - 1000, mode: 'speaker' }
    );
    ctx.state.lastSentText = null;
    await runtime.summarizeCurrentText();

    // The whole pending run drained again in one card -- the bucket never accumulates a queue.
    assert.equal(ctx.state.transcriptChunks.length, 0);
  });
});

test('a chunk captured before a mode change is summarized under, and labelled with, its own mode', async () => {
  let sentMode = null;
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ mode }) => {
      sentMode = mode;
      return { line: 'Info announcement summarized correctly.' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      // The chunk was captured while mode was 'information'; the operator has since switched to
      // 'speaker', which is what ctx.state.mode reads now. The card must still be summarized and
      // labelled 'information' -- the mode active when the words were said, not read at drain time.
      mode: 'speaker',
      transcriptChunks: [{ text: 'A brief information announcement.', at: now - 1000, mode: 'information' }]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();

    assert.equal(sentMode, 'information');
    assert.equal(ctx.state.transcriptItems.at(-1).mode, 'information');
    assert.equal(ctx.state.mode, 'speaker');
  });
});

test('one summarize call never receives text spanning two modes', async () => {
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
        { text: 'First speaker sentence.', at: now - 3000, mode: 'speaker' },
        { text: 'Second speaker sentence.', at: now - 2000, mode: 'speaker' },
        { text: 'An information announcement.', at: now - 1000, mode: 'information' }
      ]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();

    assert.equal(sentText, 'First speaker sentence. Second speaker sentence.');
    // The later mode's chunk is untouched, ready for its own call next tick.
    assert.deepEqual(ctx.state.transcriptChunks.map((chunk) => chunk.text), ['An information announcement.']);
  });
});

test('the rolling window sends A, then A+B, then B+C, then C+D across four ticks, on the actual strings', async () => {
  const seen = [];
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript, previousBlock }) => {
      seen.push({ recentTranscript, previousBlock });
      return { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: { transcriptChunks: [] }
  }, async ({ ctx, runtime }) => {
    const ticks = ['A.', 'B.', 'C.', 'D.'];
    for (const text of ticks) {
      ctx.state.transcriptChunks.push({ text, at: now, mode: 'speaker' });
      ctx.state.lastSentText = null;
      await runtime.summarizeCurrentText();
    }

    assert.deepEqual(seen, [
      { recentTranscript: 'A.', previousBlock: '' },
      { recentTranscript: 'B.', previousBlock: 'A.' },
      { recentTranscript: 'C.', previousBlock: 'B.' },
      { recentTranscript: 'D.', previousBlock: 'C.' }
    ]);
  });
});

test('a mode change omits the previous block entirely', async () => {
  const seen = [];
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript, previousBlock }) => {
      seen.push({ recentTranscript, previousBlock });
      return { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      mode: 'speaker',
      transcriptChunks: [{ text: 'A speaker sentence.', at: now, mode: 'speaker' }]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();
    assert.equal(seen[0].previousBlock, '');

    ctx.state.mode = 'information';
    ctx.state.transcriptChunks.push({ text: 'An information announcement.', at: now, mode: 'information' });
    ctx.state.lastSentText = null;
    await runtime.summarizeCurrentText();

    // The previous block was sent under 'speaker'; this call's mode is 'information', so the
    // previous block must be omitted rather than carried across the mode boundary as context.
    assert.equal(seen[1].recentTranscript, 'An information announcement.');
    assert.equal(seen[1].previousBlock, '');
  });
});

test('a failed call does not advance the previous-block slot and consumes nothing', async () => {
  let shouldFail = true;
  const flakyDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript, previousBlock }) => {
      if (shouldFail) throw new Error('network down');
      return { line: '', recentTranscript, previousBlock };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => flakyDriver,
    stateOverrides: {
      transcriptChunks: [{ text: 'First block.', at: now, mode: 'speaker' }]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();
    // Failed: nothing consumed, slot never set.
    assert.equal(ctx.state.transcriptChunks.length, 1);
    assert.ok(!ctx.state.lastSentBlock);

    shouldFail = false;
    let capturedPreviousBlock = 'not set';
    flakyDriver.summarize = async ({ recentTranscript, previousBlock }) => {
      capturedPreviousBlock = previousBlock;
      return { line: '' };
    };
    await runtime.summarizeCurrentText();

    // Retry succeeds: the same text that failed before is what finally goes out, with no
    // previous block (there was never a successful prior send to remember).
    assert.equal(capturedPreviousBlock, '');
    assert.equal(ctx.state.transcriptChunks.length, 0);
    assert.deepEqual(ctx.state.lastSentBlock, { text: 'First block.', mode: 'speaker' });
  });
});

test('nothing is consumed twice across the four-tick rolling sequence', async () => {
  const consumedTotals = [];
  const succeedingDriver = {
    id: 'openai',
    summarize: async () => ({ line: '' })
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: { transcriptChunks: [] }
  }, async ({ ctx, runtime }) => {
    const ticks = ['A.', 'B.', 'C.', 'D.'];
    for (const text of ticks) {
      ctx.state.transcriptChunks.push({ text, at: now, mode: 'speaker' });
      ctx.state.lastSentText = null;
      await runtime.summarizeCurrentText();
      consumedTotals.push(ctx.state.transcriptChunks.length);
    }

    // Each tick's newly pushed chunk is fully drained by the end of that same tick -- nothing
    // accumulates, and nothing is left behind to be consumed again on a later tick.
    assert.deepEqual(consumedTotals, [0, 0, 0, 0]);
  });
});

test('visible lines carries the last ten summaries, not five', async () => {
  let seenVisibleLines = null;
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ visibleLines }) => {
      seenVisibleLines = visibleLines;
      return { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      transcriptItems: Array.from({ length: 12 }, (_, i) => ({ text: `Line ${i}`, mode: 'speaker', source: 'ai' })),
      transcriptChunks: [{ text: 'New block.', at: now, mode: 'speaker' }]
    }
  }, async ({ runtime }) => {
    await runtime.summarizeCurrentText();
    assert.equal(seenVisibleLines.length, 10);
    assert.deepEqual(seenVisibleLines, Array.from({ length: 10 }, (_, i) => `Line ${i + 2}`));
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

test('a bucket trim during a sustained outage marks the rail "Speech dropped", and a later successful summarize clears it', async () => {
  const succeedingDriver = { id: 'openai', summarize: async () => ({ line: '' }) };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      listening: true,
      // Two chunks totalling just over BUCKET_MAX_CHARS (8000): trimBucket must drop the oldest
      // one to get back under the cap -- the only way this repo ever loses speech (INV-13). The
      // newest chunk ends with terminal punctuation so partitionBucket treats it as consumable
      // immediately (otherwise, as the newest and still-unsettled chunk, it would sit in the
      // unconsumable remainder and the summarize call below would have nothing to send).
      transcriptChunks: [
        { text: 'a'.repeat(5000), at: now - 20000 },
        { text: `${'b'.repeat(4999)}.`, at: now - 1000 }
      ]
    }
  }, async ({ ctx, elements, runtime }) => {
    runtime.showRecentTranscript();

    assert.equal(ctx.state.transcriptChunks.length, 1);
    assert.equal(ctx.state.railStatusLevel, 'dropped');
    assert.equal(elements.railStatusDot.classList.contains('is-level-dropped'), true);
    assert.equal(elements.railStatusWord.textContent, 'Speech dropped');
    assert.match(elements.railNote.textContent, /✂/);
    assert.match(elements.railNote.textContent, /Speech dropped/);
    assert.match(elements.railNote.textContent, /oldest 1 chunk/);

    // The trim condition genuinely ends only once the summarizer is confirmed working again --
    // never merely because the bucket happens to sit under the cap for one tick.
    await runtime.summarizeCurrentText();

    assert.equal(ctx.state.railStatusLevel, 'listening');
    assert.equal(elements.railStatusDot.classList.contains('is-level-dropped'), false);
    assert.equal(elements.railStatusWord.textContent, 'Listening');
    assert.equal(elements.railNote.textContent, '');
  });
});

test('a bucket trim never clobbers a confirmed problem already showing on the rail', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      listening: true,
      transcriptChunks: [
        { text: 'a'.repeat(5000), at: Date.now() - 20000 },
        { text: 'b'.repeat(5000), at: Date.now() - 1000 }
      ]
    }
  }, async ({ ctx, elements, runtime }) => {
    updateStatus(ctx, 'Microphone stopped. Switch to manual lines.', { level: 'problem' });
    assert.equal(elements.railStatusWord.textContent, 'Problem');

    runtime.showRecentTranscript();

    // The trim still happened (the data really was dropped from the bucket), but a confirmed
    // fatal condition (INV-10) outranks an unconfirmed-by-comparison data-loss note on the
    // single-slot rail display -- see LEVEL_RANK in view.js.
    assert.equal(ctx.state.transcriptChunks.length, 1);
    assert.equal(ctx.state.railStatusLevel, 'problem');
    assert.equal(elements.railStatusWord.textContent, 'Problem');
  });
});

test('a summarize call running longer than the update interval marks the rail "Running behind", and a later completed tick clears it', async () => {
  let resolveFirst;
  let calls = 0;
  const driver = {
    id: 'openai',
    summarize: () => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({ line: '' });
        });
      }
      return Promise.resolve({ line: '' });
    }
  };

  await withRuntimeHarness({
    createSummarizationDriverFn: () => driver,
    stateOverrides: { listening: true }
  }, async ({ ctx, elements, runtime }) => {
    const first = runtime.summarizeCurrentText('first pass');
    await new Promise((resolve) => setImmediate(resolve));

    // Tick 2: the previous call is still in flight -- one skip, not yet sticky-worthy (mirrors
    // SILENCE_WATCHDOG_MS's "don't cry wolf on a single blip" reasoning).
    await runtime.summarizeCurrentText('tick two');
    assert.notEqual(ctx.state.railStatusLevel, 'behind');

    // Tick 3: a second consecutive skip -- the wall is now more than one full interval behind.
    await runtime.summarizeCurrentText('tick three');
    assert.equal(ctx.state.railStatusLevel, 'behind');
    assert.equal(elements.railStatusDot.classList.contains('is-level-behind'), true);
    assert.equal(elements.railStatusWord.textContent, 'Running behind');
    assert.match(elements.railNote.textContent, /⏳/);
    assert.match(elements.railNote.textContent, /Running behind/);

    // The stalled call finally resolving successfully is the confirmed proof the wall has caught
    // up -- clearing here, not merely because a later tick started, is the honest version: a call
    // that starts late and then FAILS must leave "Running behind" exactly as it was (see the next
    // test), so recovery has to be gated on success, not on attempt.
    resolveFirst();
    await first;
    assert.equal(calls, 1);
    assert.equal(ctx.state.railStatusLevel, 'listening');
    assert.equal(elements.railStatusDot.classList.contains('is-level-behind'), false);
    assert.equal(elements.railStatusWord.textContent, 'Listening');
    assert.equal(elements.railNote.textContent, '');
  });
});

test('a "Running behind" note is NOT cleared by a late attempt that goes on to fail -- only by one that succeeds', async () => {
  let resolveFirst;
  let rejectSecond;
  let calls = 0;
  const driver = {
    id: 'openai',
    summarize: () => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({ line: '' });
        });
      }
      return new Promise((_resolve, reject) => {
        rejectSecond = () => reject(new Error('provider still unhappy'));
      });
    }
  };

  await withRuntimeHarness({
    createSummarizationDriverFn: () => driver,
    stateOverrides: { listening: true }
  }, async ({ ctx, runtime }) => {
    const first = runtime.summarizeCurrentText('first pass');
    await new Promise((resolve) => setImmediate(resolve));
    await runtime.summarizeCurrentText('tick two');
    await runtime.summarizeCurrentText('tick three');
    assert.equal(ctx.state.railStatusLevel, 'behind');

    resolveFirst();
    await first;
    assert.equal(ctx.state.railStatusLevel, 'listening', 'the stalled call succeeded, so this clears normally');

    // Now force a fresh, genuinely late-and-failing attempt: two skipped ticks re-arm "behind",
    // then the attempt that finally gets to run fails instead of succeeding.
    const second = runtime.summarizeCurrentText('tick four');
    await new Promise((resolve) => setImmediate(resolve));
    await runtime.summarizeCurrentText('tick five');
    await runtime.summarizeCurrentText('tick six');
    assert.equal(ctx.state.railStatusLevel, 'behind');

    rejectSecond();
    await second;
    assert.equal(calls, 2);
    // The attempt started (proving the loop wasn't permanently stuck) but then FAILED, so the
    // wall really is still behind -- the note must still be showing, not optimistically cleared.
    assert.equal(ctx.state.railStatusLevel, 'behind');
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

// --- Mic device selection + level test (docs/backlog.md item 1) -----------

test('populateAudioDeviceOptions fills the select from listAudioInputs and resolves a saved id', async () => {
  const mediaDevicesImpl = {
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'mic-1', label: 'USB Interface' },
      { kind: 'audioinput', deviceId: 'mic-2', label: 'Built-in Mic' }
    ]
  };

  await withRuntimeHarness({
    stateOverrides: { audioDeviceId: 'mic-2' },
    mediaDevicesImpl
  }, async ({ ctx, runtime }) => {
    await runtime.populateAudioDeviceOptions();
    const select = ctx.dom.audioDeviceSelect;
    // default option + the two real devices
    assert.equal(select.children.length, 3);
    assert.equal(select.children[0].value, '');
    assert.equal(select.children[1].value, 'mic-1');
    assert.equal(select.children[2].value, 'mic-2');
    assert.equal(select.value, 'mic-2');
    assert.equal(ctx.state.audioDeviceId, 'mic-2', 'a still-valid saved id is left untouched');
  });
});

test('populateAudioDeviceOptions falls back to system default and persists the correction when the saved device has been unplugged', async () => {
  const mediaDevicesImpl = {
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'USB Interface' }]
  };

  await withRuntimeHarness({
    stateOverrides: { audioDeviceId: 'mic-unplugged' },
    mediaDevicesImpl
  }, async ({ ctx, runtime }) => {
    await runtime.populateAudioDeviceOptions();
    assert.equal(ctx.dom.audioDeviceSelect.value, '');
    assert.equal(ctx.state.audioDeviceId, '', 'the stale saved id must be corrected, not silently kept');
  });
});

test('setAudioDeviceId persists the choice and updates state', async () => {
  await withRuntimeHarness({}, async ({ ctx, runtime }) => {
    runtime.setAudioDeviceId('mic-9');
    assert.equal(ctx.state.audioDeviceId, 'mic-9');
  });
});

test('toggleAudioLevelTest starts the probe, drives the meter from describeLevels(), and reflects failure honestly', async () => {
  let started = false;
  let stopped = false;
  const fakeProbe = {
    async start() {
      started = true;
      return { ok: true };
    },
    readLevels() {
      return { rms_dbfs: -20, peak_dbfs: -10, gain_db: 0, clipCount: 0, classification: 'GOOD', speaking: true };
    },
    stop() {
      stopped = true;
    }
  };

  await withRuntimeHarness({
    createMicProbeFn: () => fakeProbe,
    mediaDevicesImpl: { enumerateDevices: async () => [] }
  }, async ({ ctx, runtime }) => {
    await runtime.toggleAudioLevelTest();
    assert.equal(started, true);
    assert.equal(ctx.dom.audioLevelTestButton.textContent, 'Stop test');

    // Force a synchronous meter read instead of waiting on the real ~20Hz interval.
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(ctx.dom.audioLevelText.textContent, 'Good');
    assert.ok(Number(ctx.dom.audioLevelBar.style.width.replace('%', '')) > 0);

    runtime.stopAudioLevelTest();
    assert.equal(stopped, true);
    assert.equal(ctx.dom.audioLevelTestButton.textContent, 'Test');
    assert.equal(ctx.dom.audioLevelText.textContent, 'Not measuring', 'INV-10: a stopped probe must read as not-measuring, never as silence');
  });
});

test('toggleAudioLevelTest surfaces a probe failure through the readout instead of throwing', async () => {
  const fakeProbe = {
    async start() {
      return { ok: false, error: 'Permission denied' };
    },
    readLevels() { return null; },
    stop() {}
  };

  await withRuntimeHarness({
    createMicProbeFn: () => fakeProbe
  }, async ({ ctx, runtime }) => {
    await assert.doesNotReject(runtime.toggleAudioLevelTest());
    assert.equal(ctx.dom.audioLevelText.textContent, 'Permission denied');
    assert.equal(ctx.dom.audioLevelTestButton.textContent, 'Test', 'a failed start must not leave the button reading "Stop test"');
  });
});

test('stopListening also stops an active mic level test, releasing the probe', async () => {
  let stopped = false;
  const fakeProbe = {
    async start() { return { ok: true }; },
    readLevels() { return null; },
    stop() { stopped = true; }
  };
  const driver = {
    id: 'browser',
    label: 'Browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createMicProbeFn: () => fakeProbe
  }, async ({ runtime }) => {
    await runtime.toggleAudioLevelTest();
    await runtime.startListening();
    await runtime.stopListening();
    assert.equal(stopped, true);
  });
});

test('closing the settings panel stops an active mic level test', async () => {
  let stopped = false;
  const fakeProbe = {
    async start() { return { ok: true }; },
    readLevels() { return null; },
    stop() { stopped = true; }
  };

  await withRuntimeHarness({
    createMicProbeFn: () => fakeProbe
  }, async ({ runtime }) => {
    await runtime.toggleAudioLevelTest();
    runtime.setSettingsOpen(false);
    assert.equal(stopped, true);
  });
});
