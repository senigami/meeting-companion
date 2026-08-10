import test from 'node:test';
import assert from 'node:assert/strict';

import { createElement, withRuntimeHarness } from './runtime-test-helpers.js';
import { updateStatus } from '../../../public/controller/view.js';
import { SENTENCE_END_SILENCE_MS } from '../../../public/controller/runtime.js';

// Filler text of an exact character length that still clears hasSubstantiveContent's 3-token gate
// -- 'a'.repeat(n) is a single giant token, not real words, and got blocked outright once that gate
// arrived. 'word '.repeat(...) keeps real word boundaries while padding to the same length these
// bucket-overflow tests rely on (BUCKET_MAX_CHARS trimming).
function fillerOfLength(length) {
  return 'word '.repeat(Math.ceil(length / 5)).slice(0, length);
}

test('a mode press waits out a call already in flight before draining, so the outgoing speaker is not merged into the next', async () => {
  // The drain is skippable: summarizeCurrentText returns early while summarizeInFlight is set.
  // Without waiting, a mode press during a call clears the history but leaves the outgoing tail in
  // the bucket, and since testimony meeting never leaves speaker mode, takeOldestModeRun merges
  // that tail with the next speaker's opening into one card, in first person. Nobody in the room
  // could detect it.
  const seen = [];
  let releaseInFlight;
  const inFlight = new Promise((resolve) => { releaseInFlight = resolve; });
  const driver = {
    id: 'openai',
    summarize: async ({ recentTranscript }) => { seen.push(recentTranscript); return { line: 'card' }; }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => driver,
    stateOverrides: {
      mode: 'speaker',
      summarizeCallPromise: inFlight,
      transcriptChunks: [{ text: 'The outgoing speaker finished saying this.', at: now - 30000 }]
    }
  }, async ({ ctx, runtime }) => {
    const pressed = runtime.setMode('speaker') ?? Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(seen, [], 'must not drain while a call is still in flight');

    releaseInFlight();
    await pressed;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(seen, ['The outgoing speaker finished saying this.'],
      'the outgoing tail must be summarized once the in-flight call clears');
    assert.deepEqual(ctx.state.summaryHistory, [], 'and only then is the history dropped');
  });
});

test('a tick skipped by the in-flight guard does not become the promise the drain waits on', async () => {
  // #76. Every call used to overwrite summarizeCallPromise, including the ones that returned
  // immediately at the guard. A mode press then awaited an already-resolved no-op, its own forced
  // settleMs: 0 drain was skipped by the same guard, and the outgoing speaker's tail stayed in the
  // bucket to be merged into the next speaker's first card in first person.
  const seen = [];
  let releaseFirst;
  const firstCallGate = new Promise((resolve) => { releaseFirst = resolve; });
  const driver = {
    id: 'openai',
    summarize: async ({ recentTranscript }) => {
      seen.push(recentTranscript);
      if (seen.length === 1) await firstCallGate;
      return { line: 'card' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => driver,
    stateOverrides: {
      mode: 'speaker',
      transcriptChunks: [{ text: 'The outgoing speaker finished saying this.', at: now - 30000 }]
    }
  }, async ({ ctx, runtime }) => {
    // Passing text explicitly leaves the bucket alone, so the tail is still there to be lost.
    const realCall = runtime.summarizeCurrentText('a call that is genuinely running');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ctx.state.summarizeInFlight, true, 'the first call must still be running');

    const skipped = runtime.summarizeCurrentText('a tick that the guard turns away');
    assert.equal(ctx.state.summarizeCallPromise, realCall,
      'a skipped tick must leave the in-flight call as the promise the drain waits on');
    await skipped;

    const pressed = runtime.setMode('speaker') ?? Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(seen, ['a call that is genuinely running'],
      'the drain must wait for the real call, not for the skipped tick');

    releaseFirst();
    await realCall;
    await pressed;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(seen, ['a call that is genuinely running', 'The outgoing speaker finished saying this.'],
      'the outgoing tail must be drained before the history is cleared');
  });
});

test('pressing a mode button clears the conversational history, even when the mode does not change', async () => {
  // Steve's control. During testimony meeting he never leaves speaker mode, so a reset that only
  // fired on a CHANGE would never fire at all. Pressing the mode you are already on is the gesture.
  await withRuntimeHarness({
    stateOverrides: { mode: 'speaker', summaryHistory: [{ spoken: 'a', shown: 'A' }, { spoken: 'b', shown: 'B' }] }
  }, async ({ ctx, runtime }) => {
    await runtime.setMode('speaker');
    assert.deepEqual(ctx.state.summaryHistory, [], 'pressing the current mode must still start fresh');
  });
});

test('the speaker-name FIELD clears on every mode press, same-mode or not (2026-08-09)', async () => {
  // Every mode press clears the field, including a same-mode re-press -- that press is the "new
  // speaker in testimony meeting" gesture (same reason summaryHistory resets unconditionally too),
  // and a name typed for whoever was talking before must never survive onto whoever comes next.
  // This is the FIELD only; the CARD label (view.js) is a separate, persistent per-card nameplate
  // that just stops appearing on new cards once the field it copies from is empty.
  await withRuntimeHarness({
    stateOverrides: { mode: 'speaker', speakerName: 'Bro. Ashcroft' }
  }, async ({ ctx, runtime }) => {
    await runtime.setMode('speaker');
    assert.equal(ctx.state.speakerName, '', 'a same-mode press clears the field too');

    ctx.state.speakerName = 'Sister Droubal';
    await runtime.setMode('information');
    assert.equal(ctx.state.speakerName, '', 'an actual mode change clears the field');
  });
});

test('pressing a mode button says so on a surface visible with the settings panel closed', async () => {
  // The message used to go only to #status, which lives inside the closed settings dialog. Pressing
  // the mode you are already on is the gesture during testimony meeting, and it changes nothing else
  // on screen -- so the operator got no confirmation at all that the clear had happened.
  await withRuntimeHarness({
    stateOverrides: { mode: 'speaker' }
  }, async ({ ctx, runtime }) => {
    await runtime.setMode('speaker');
    assert.match(ctx.dom.railNote.textContent, /starting fresh/i,
      'the rail note is the only feedback surface readable with the panel closed');
  });
});

test('changing mode clears the history, so one speaker does not become context for a prayer', async () => {
  // This was a real bug: the old rolling-window previousBlock was mode-guarded, but summaryHistory
  // was not, so switching from speaker to prayer carried the outgoing speaker's testimony in as
  // conversational context. previousBlock is gone entirely now (#66); summaryHistory is the only
  // context mechanism left, so it is the only thing this guards.
  await withRuntimeHarness({
    stateOverrides: { mode: 'speaker', summaryHistory: [{ spoken: 'a testimony', shown: 'A testimony' }] }
  }, async ({ ctx, runtime }) => {
    await runtime.setMode('prayer');
    assert.equal(ctx.state.mode, 'prayer');
    assert.deepEqual(ctx.state.summaryHistory, []);
  });
});

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

test('fresh install with no provider keys stays on the unready default, never demo, with no alert or switch note', async () => {
  // 2026-08-09 reversal (Steve): a real incident showed the cost of demo ever being reachable by
  // anything other than an explicit click -- see resolveAvailableSummarizationSource's own comment.
  // A fresh install with no keys now stays on the ordinary 'openai' default, unready, which renders
  // as "no key configured, manual mode still works" rather than fabricated content that looks real.
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

    assert.equal(ctx.state.summarizationSource, 'openai');
    // OpenAI selected, unready: buildAlerts correctly surfaces this now that demo cannot silently
    // absorb it -- an honest "add a key" alert, not the false alarm the old alert model used to raise.
    assert.equal(elements.settingsAlertBadge.hidden, false);
    assert.equal(elements.alertsSection.hidden, false);
    assert.match(elements.apiWarning.textContent, /has no key/i);
    // The initial state (start-app.js) and the resolved default agree, so nothing "switched" --
    // no note, same as before this reversal.
    assert.equal(elements.railNote.textContent, '');
    // Nothing recorded a choice. Falsy rather than literally false: start-app.js seeds this field
    // and the test harness does not, so an unseeded `undefined` is the real first-run shape here.
    assert.ok(!ctx.state.summarizationSourceChosen);
    // demo must never be reachable here at all now, chosen flag or not.
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

// REGRESSION (found in the wild, 2026-07-30). Re-picking the source that is already selected is how an
// operator CONFIRMS a default, and it is the commonest way the chosen flag ever gets set. The old order
// wrote the flag, then returned early on the no-op before writing the source -- leaving chosen=true with
// no stored source at all. INV-13 reads those two values together, so a stored half of the pair asserts
// "the operator decided" while losing what they decided, and the source then quietly comes from the
// load-time default instead. Steve's own browser was in exactly this state.
test('confirming the already-selected source persists the source, not just the chosen flag', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      summarizationSource: 'openai',
      summarizationSourceChosen: false
    }
  }, async ({ ctx, runtime }) => {
    runtime.setSummarizationSource('openai');

    assert.equal(ctx.state.summarizationSourceChosen, true);
    assert.equal(localStorage.getItem('summarizationSourceChosen'), 'true');
    // The half that used to go missing. Asserting the flag alone would have stayed green through the bug.
    assert.equal(localStorage.getItem('summarizationSource'), 'openai');
  });
});

// REGRESSION (found in the wild, 2026-07-31). The Test button under AI summaries fell back to
// ctx.state.providerKeys[provider] when no key was typed. That is not a key string: everywhere else it is
// the descriptor object from /api/config ({configured, origin, label, masked}). normalizeText stringified
// it to "[object Object]" and sent THAT as the API key, so the provider rejected it and Test failed for
// anyone whose provider was actually configured, which is the only person who would press it. The
// function had no test at all, which is how it shipped. Assert the bytes on the wire, not that a
// function was called -- the old code called fetch perfectly happily.
test('testing a configured provider sends no key, so the server tests its own', async () => {
  const posted = [];
  await withRuntimeHarness({
    stateOverrides: {
      providerKeys: {
        openai: { configured: true, origin: 'server', label: 'Configured on server', masked: '' }
      }
    },
    fetchImpl: async (url, options = {}) => {
      posted.push({ url, body: JSON.parse(options.body || '{}') });
      return { ok: true, json: async () => ({ ok: true, provider: 'openai' }) };
    }
  }, async ({ runtime }) => {
    await runtime.testProviderKey('openai');

    const call = posted.find((entry) => String(entry.url).includes('/api/provider/test'));
    assert.ok(call, 'the test button should call /api/provider/test');
    assert.equal(call.body.apiKey, '');
    assert.notEqual(call.body.apiKey, '[object Object]');
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
    await runtime.setMode('information');
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

test('switching to song mode auto-pauses listening, and switching away auto-resumes it', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    startCount: 0,
    stopCount: 0,
    async start() { this.startCount += 1; },
    async stop() { this.stopCount += 1; },
    setMode() {}
  };

  await withRuntimeHarness({
    stateOverrides: { openAiReady: true },
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ line: '' }) })
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    await runtime.setMode('song');

    assert.equal(ctx.state.paused, true, 'entering song mode pauses');
    assert.equal(driver.stopCount, 1);

    await runtime.setMode('speaker');

    assert.equal(ctx.state.paused, false, 'leaving song mode resumes what it auto-paused');
    assert.equal(driver.startCount, 2);
  });
});

test('a manual pause press while in song mode is not overridden when leaving song mode', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    startCount: 0,
    stopCount: 0,
    async start() { this.startCount += 1; },
    async stop() { this.stopCount += 1; },
    setMode() {}
  };

  await withRuntimeHarness({
    stateOverrides: { openAiReady: true },
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ line: '' }) })
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    await runtime.setMode('song');
    assert.equal(ctx.state.paused, true);

    // The operator's own call: manually resume while still in song mode.
    await runtime.togglePauseAi();
    assert.equal(ctx.state.paused, false);
    assert.equal(ctx.state.songAutoPaused, false, 'a manual press clears the auto-pause marker');

    // Leaving song mode must not re-pause on top of the operator's explicit resume.
    await runtime.setMode('speaker');
    assert.equal(ctx.state.paused, false);
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

test('summaryHistory is cleared when listening stops', async () => {
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    ctx.state.summaryHistory = [{ spoken: 'x', shown: 'y' }];

    await runtime.stopListening();

    assert.deepEqual(ctx.state.summaryHistory, []);
  });
});

test('the speaker-name field clears on a genuine Start press and on Stop, but not on an internal resume (2026-08-09)', async () => {
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) })
  }, async ({ ctx, runtime }) => {
    ctx.state.speakerName = 'Bro. Ashcroft';
    await runtime.startListening();
    assert.equal(ctx.state.speakerName, '', 'a genuine Start press clears the field');

    ctx.state.speakerName = 'Sister Droubal';
    await runtime.startListening({ force: true });
    assert.equal(ctx.state.speakerName, 'Sister Droubal', 'an internal force resume is not a new speaker');

    await runtime.stopListening();
    assert.equal(ctx.state.speakerName, '', 'Stop clears the field');
  });
});

test('stopping active transcription returns the rail indicator to manual', async () => {
  const driver = {
    id: 'browser',
    label: 'Browser',
    isLive: true,
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
    isLive: true,
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
    isLive: true,
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
    isLive: true,
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

test('runtime falls back to the unready default, never demo, when persisted source is stale, unchosen, and no keys are configured', async () => {
  // 2026-08-09 reversal (Steve): demo must never be reachable except by an explicit choice, so a
  // stale/unchosen persisted value falls through to the ordinary unready 'openai' default (same as
  // the never-configured case), not to demo.
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
    assert.match(elements.apiWarning.textContent, /has no key/i);
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
      // A key IS configured here (unlike the escalation test above) -- this scenario is a
      // recovering rate limit/outage, not a missing key, so buildAlerts' separate "no key
      // configured" alert must not still be lit once the summarize-failure alert clears below.
      openAiReady: true,
      transcriptChunks: [{ text: 'a very important announcement', at: Date.now() }]
    }
  }, async ({ ctx, elements, runtime }) => {
    await runtime.summarizeCurrentText('First real failure.');
    await runtime.summarizeCurrentText('Second real failure.');
    await runtime.summarizeCurrentText('Third real failure.');

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

test('clearing a summarize-failure alert must not blank an unrelated still-live "no key configured" alert (regression)', async () => {
  // Before the fix, clearSummarizeFailureAlert blanked apiWarning/alertsSection unconditionally
  // on a successful summarize, destroying any other alert buildAlerts still had reason to show.
  // Here openAiReady defaults to false (see runtime-test-helpers.js), so a "no key configured"
  // alert is live independently of the summarize failures. If a successful summarize after prior
  // failures silently cleared that warning, an operator would believe summaries are fine when
  // OpenAI has no key and summaries are actually dead.
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
  }, async ({ runtime, elements }) => {
    await runtime.summarizeCurrentText('First real failure.');
    await runtime.summarizeCurrentText('Second real failure.');
    await runtime.summarizeCurrentText('Third real failure.');
    await runtime.summarizeCurrentText('now it works');

    assert.equal(elements.alertsSection.hidden, false);
    assert.equal(elements.apiWarning.hidden, false);
    assert.match(elements.apiWarning.textContent, /no key/);
  });
});

test('the settings alert badge never disagrees with the alerts section after Settings is reopened (regression)', async () => {
  // In production, #alertsSection carries data-settings-section="alerts" and is one of the nodes
  // ctx.dom.settingsSections loops over (see start-app.js); the default test harness omits that
  // wiring, so it must be modeled explicitly here or this exact regression goes untested. Before
  // the fix, opening Settings ran setSettingsSection, which hid this same node using buildAlerts
  // alone -- a real, escalated summarize-failure alert (case (a): a genuine condition, just not
  // counted by that check) would vanish from the visible alerts area while the badge, written by a
  // separate direct DOM assignment, stayed lit.
  const alertsSectionNode = createElement({ hidden: true, dataset: { settingsSection: 'alerts' } });
  const failingDriver = {
    id: 'openai',
    summarize: async () => { throw new Error('rate limited'); }
  };

  await withRuntimeHarness({
    createSummarizationDriverFn: () => failingDriver,
    elementOverrides: {
      alertsSection: alertsSectionNode,
      settingsSections: [alertsSectionNode]
    },
    stateOverrides: {
      summaryIntervalSeconds: 5,
      openAiReady: true,
      transcriptChunks: [{ text: 'a very important announcement', at: Date.now() }]
    }
  }, async ({ elements, runtime }) => {
    await runtime.summarizeCurrentText('First real failure.');
    await runtime.summarizeCurrentText('Second real failure.');
    await runtime.summarizeCurrentText('Third real failure.');

    assert.equal(elements.settingsAlertBadge.hidden, false);
    assert.equal(elements.alertsSection.hidden, false);

    // Opening (and closing) Settings must never let the badge and the visible alerts area
    // disagree, no matter how many times setSettingsSection recomputes the section's own
    // visibility from buildAlerts.
    runtime.setSettingsOpen(true);
    assert.equal(elements.settingsAlertBadge.hidden, elements.alertsSection.hidden);
    assert.equal(elements.settingsAlertBadge.hidden, false);

    runtime.setSettingsOpen(false);
    assert.equal(elements.settingsAlertBadge.hidden, elements.alertsSection.hidden);
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
    await runtime.summarizeCurrentText('all is good');

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
  let calls = 0;
  const stallingDriver = {
    id: 'openai',
    // Only the FIRST call stalls (what this test inspects mid-flight). The second chunk here is
    // genuinely complete and in a different mode, so #54's same-tick drain loop correctly comes
    // back for it once the first call resolves -- resolve that one immediately since this test's
    // assertions are all about the first call's in-flight dim state, not the second run.
    summarize: () => {
      calls += 1;
      if (calls > 1) return Promise.resolve({ line: '' });
      return new Promise((resolve) => { resolveSummarize = resolve; });
    }
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

test('#54 regression: a bucket fault (oversized run) is still counted and reported, not swallowed by the same-tick drain peek', async () => {
  // takeOldestModeRun throws when a run's joined text exceeds BUCKET_MAX_CHARS
  // (transcript-bucket.js:109). Before #54's same-tick drain loop, that throw was hit
  // unconditionally inside runSummarizeCurrentText's own try/catch every tick, so it was counted
  // in summarizeFailureCount and escalated at 3 like any other failure (INV-10). The loop added a
  // peek (hasCompleteModeRun) ahead of the real call to decide whether to keep draining; a peek
  // that swallows this same throw and reports "nothing to drain" would starve the real call
  // entirely -- the fault would never be counted, the bucket would never be flagged, and the rail
  // would keep reading a healthy status while no card is ever produced again.
  const now = Date.now();
  const oversizedRun = `${'word '.repeat(2000)}.`; // well over BUCKET_MAX_CHARS (8000 chars)

  await withRuntimeHarness({
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: 'x' }) }),
    stateOverrides: {
      mode: 'speaker',
      transcriptChunks: [{ text: oversizedRun, at: now - 30000, mode: 'speaker', speaker: 'Alice' }]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();

    assert.equal(ctx.state.summarizeFailureCount, 1, 'a bucket fault must count as a failure, exactly as before #54');
    assert.match(ctx.dom.status.textContent, /Could not prepare the transcript/);
    // The oversized run is never discarded to "recover" -- it stays in the bucket and will fault
    // (and count) again next tick, same as before this loop existed.
    assert.equal(ctx.state.transcriptChunks.length, 1);
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

// Issue #40: a paced AI card must carry the speaker who was actually talking when the chunk was
// captured, exactly the same precedent as mode above -- reading current state at release time
// would mislabel every card after the operator retypes the name field while a card is still queued.
test('a chunk captured under one speaker is summarized under, and labelled with, its own speaker', async () => {
  const succeedingDriver = {
    id: 'openai',
    summarize: async () => ({ line: 'A line from the earlier speaker.' })
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      // The chunk was captured while the operator had typed "Alpha"; they have since retyped the
      // field to "Beta", which is what ctx.state.speakerName reads now. The resulting card must
      // still carry "Alpha" -- the speaker active when the words were said, not read at drain time.
      speakerName: 'Beta',
      transcriptChunks: [{ text: 'A line from the earlier speaker.', at: now - 1000, mode: 'speaker', speaker: 'Alpha' }]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();

    assert.equal(ctx.state.transcriptItems.at(-1).speaker, 'Alpha');
    assert.equal(ctx.state.speakerName, 'Beta');
  });
});

test('one summarize call never receives text spanning two modes', async () => {
  const sentTexts = [];
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
        { text: 'First speaker sentence.', at: now - 3000, mode: 'speaker' },
        { text: 'Second speaker sentence.', at: now - 2000, mode: 'speaker' },
        { text: 'An information announcement.', at: now - 1000, mode: 'information' }
      ]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();

    // 2026-08-09 reversal of #54's same-tick catch-up (Steve): a backlog of several complete runs
    // now drains ONE run per tick, at the ordinary interval cadence, instead of bursting through
    // every run it can find the moment it gets the chance -- a real session measured ~20 card pairs
    // landing under a second apart from exactly this burst. Only the oldest run goes out; the rest
    // stay in the bucket for later ticks.
    assert.deepEqual(sentTexts, ['First speaker sentence. Second speaker sentence.']);
    assert.deepEqual(ctx.state.transcriptChunks, [{ text: 'An information announcement.', at: now - 1000, mode: 'information' }]);
  });
});

test('a second speaker landing in the same tick still waits for the next tick, not a same-tick catch-up', async () => {
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript }) => ({ line: `Card for: ${recentTranscript}` })
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      mode: 'speaker',
      transcriptChunks: [
        { text: 'First speaker said this.', at: now - 30000, mode: 'speaker', speaker: 'Alice' },
        { text: 'Second speaker said this.', at: now - 30000, mode: 'speaker', speaker: 'Bob' }
      ]
    }
  }, async ({ ctx, runtime }) => {
    // One tick, one call to summarizeCurrentText -- exactly what the interval fires.
    await runtime.summarizeCurrentText();

    // 2026-08-09 reversal of #54 (Steve, "eliminate the need for catch up"): with every call now
    // capped to exactly one card, there is no burst left to protect the reader from by draining
    // faster than the interval -- so this drains at most one run per tick, same as any other tick.
    assert.deepEqual(
      ctx.state.summaryHistory.map((turn) => turn.shown),
      ['Card for: First speaker said this.'],
      'only the oldest run drains this tick; the second speaker waits for the next one'
    );
    assert.equal(ctx.state.transcriptChunks.length, 1, 'the second run is still in the bucket for the next tick');
  });
});

test('the drain loop is capped at one run per tick, and a remaining backlog is observable', async () => {
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript }) => ({ line: `Card for: ${recentTranscript}` })
  };
  const now = Date.now();
  // Seven distinct one-chunk runs (each its own speaker breaks the run), all already settled and
  // punctuated so every one of them is a complete, drainable run on the very first check.
  const transcriptChunks = Array.from({ length: 7 }, (_, i) => ({
    text: `Speaker ${i} said this.`,
    at: now - 30000,
    mode: 'speaker',
    speaker: `Speaker${i}`
  }));

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: { mode: 'speaker', transcriptChunks }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();

    // 2026-08-09 (Steve, "eliminate the need for catch up"): MAX_DRAIN_RUNS_PER_TICK dropped from
    // 5 to 1, so exactly one run drains per tick and the other six stay queued.
    assert.equal(ctx.state.summaryHistory.length, 1, 'the drain loop must stop after one run per tick');
    assert.equal(ctx.state.transcriptChunks.length, 6, 'runs left over after the cap stay in the bucket for the next tick');
    assert.equal(ctx.state.summarizeDrainCapHits, 1, 'hitting the cap must be observable, not silent');
  });
});

test('previousBlock is never sent across four ticks, and each tick still carries its own text', async () => {
  // The old rolling-window mechanism (previousBlock) is gone entirely (#66) -- nothing ever reads
  // it, so the driver call must never carry the key at all, on any tick.
  const seen = [];
  const succeedingDriver = {
    id: 'openai',
    summarize: async (options) => {
      seen.push(options);
      return { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: { transcriptChunks: [] }
  }, async ({ ctx, runtime }) => {
    const ticks = ['Tick one happened.', 'Tick two happened.', 'Tick three happened.', 'Tick four happened.'];
    for (const text of ticks) {
      ctx.state.transcriptChunks.push({ text, at: now, mode: 'speaker' });
      ctx.state.lastSentText = null;
      await runtime.summarizeCurrentText();
    }

    assert.deepEqual(seen.map((options) => options.recentTranscript), ticks);
    assert.ok(seen.every((options) => !('previousBlock' in options)),
      'no call may carry previousBlock, regardless of tick');
  });
});

test('a mode change still never sends previousBlock', async () => {
  const seen = [];
  const succeedingDriver = {
    id: 'openai',
    summarize: async (options) => {
      seen.push(options);
      return { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      mode: 'speaker',
      transcriptChunks: [{ text: 'A real speaker sentence.', at: now, mode: 'speaker' }]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();
    assert.ok(!('previousBlock' in seen[0]));

    ctx.state.mode = 'information';
    ctx.state.transcriptChunks.push({ text: 'An information announcement.', at: now, mode: 'information' });
    ctx.state.lastSentText = null;
    await runtime.summarizeCurrentText();

    assert.equal(seen[1].recentTranscript, 'An information announcement.');
    assert.ok(!('previousBlock' in seen[1]));
  });
});

test('a failed call consumes nothing, and never sent previousBlock either way', async () => {
  let shouldFail = true;
  const flakyDriver = {
    id: 'openai',
    summarize: async (options) => {
      if (shouldFail) throw new Error('network down');
      return { line: '', ...options };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => flakyDriver,
    stateOverrides: {
      transcriptChunks: [{ text: 'First real block.', at: now, mode: 'speaker' }]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();
    // Failed: nothing consumed.
    assert.equal(ctx.state.transcriptChunks.length, 1);

    shouldFail = false;
    let capturedOptions = null;
    flakyDriver.summarize = async (options) => {
      capturedOptions = options;
      return { line: '' };
    };
    await runtime.summarizeCurrentText();

    // Retry succeeds: the same text that failed before is what finally goes out, still with no
    // previousBlock key at all.
    assert.ok(!('previousBlock' in capturedOptions));
    assert.equal(ctx.state.transcriptChunks.length, 0);
  });
});

test('a successful summarize with a non-empty line appends {spoken, shown} to summaryHistory', async () => {
  const driver = { id: 'openai', summarize: async () => ({ line: 'A card.' }) };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => driver,
    stateOverrides: { transcriptChunks: [{ text: 'Some real speech.', at: now, mode: 'speaker' }] }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();
    assert.equal(ctx.state.summaryHistory.length, 1);
    const { spoken, shown } = ctx.state.summaryHistory[0];
    assert.equal(spoken, 'Some real speech.');
    assert.equal(shown, 'A card.');
    assert.equal(typeof ctx.state.summaryHistory[0].at, 'number');
  });
});

test('summaryHistory is not appended to when the summarizer returns an empty line', async () => {
  const driver = { id: 'openai', summarize: async () => ({ line: '' }) };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => driver,
    stateOverrides: { transcriptChunks: [{ text: 'Some speech.', at: now, mode: 'speaker' }] }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();
    assert.deepEqual(ctx.state.summaryHistory, []);
  });
});

test('summaryHistory is capped at the most recent 30 entries', async () => {
  let n = 0;
  const driver = { id: 'openai', summarize: async () => ({ line: `Card ${n}.` }) };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => driver,
    stateOverrides: { transcriptChunks: [] }
  }, async ({ ctx, runtime }) => {
    for (n = 0; n < 32; n += 1) {
      // A word for the number, not a digit: single-digit numbers ("0".."9") are one character and
      // fail hasSubstantiveContent's 3-token gate on their own, which pairs adjacent single-digit
      // chunks into one bucket run and desyncs this test's per-tick expectations from n.
      ctx.state.transcriptChunks.push({ text: `Speech number word${n}.`, at: now, mode: 'speaker' });
      ctx.state.lastSentText = null;
      await runtime.summarizeCurrentText();
    }

    assert.equal(ctx.state.summaryHistory.length, 30);
    assert.equal(ctx.state.summaryHistory[0].spoken, 'Speech number word2.');
    assert.equal(ctx.state.summaryHistory[0].shown, 'Card 2.');
    assert.equal(ctx.state.summaryHistory[29].spoken, 'Speech number word31.');
    assert.equal(ctx.state.summaryHistory[29].shown, 'Card 31.');
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
    const ticks = ['Tick one happened.', 'Tick two happened.', 'Tick three happened.', 'Tick four happened.'];
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

test('visible lines includes the cards still waiting in the release queue', async () => {
  // #61. Cards release one at a time, so a card the summarizer has already produced is not in
  // transcriptItems for several seconds. It is still going on screen, so the model has to be told
  // about it or it can restate it, and cleanModelLines cannot catch that either since it dedupes
  // against this same list.
  const seen = [];
  let call = 0;
  const driver = {
    id: 'openai',
    summarize: async ({ visibleLines }) => {
      seen.push(visibleLines);
      call += 1;
      return call === 1 ? { line: 'The picnic is Saturday.\nBring a chair.\nSign up at the door.' } : { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createSummarizationDriverFn: () => driver,
    stateOverrides: {
      transcriptChunks: [{ text: 'An announcement about the picnic.', at: now - 30000, mode: 'information' }],
      mode: 'information'
    }
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Only the first of the three has been released, so the other two are invisible to
    // transcriptItems and were invisible to the dedupe window before this fix.
    assert.equal(ctx.state.transcriptItems.length, 1);

    ctx.state.transcriptChunks.push({ text: 'A real second announcement.', at: now - 20000, mode: 'information' });
    await runtime.summarizeCurrentText();

    assert.deepEqual(seen[1], [
      'The picnic is Saturday.',
      'Bring a chair.',
      'Sign up at the door.'
    ], 'the queued cards must be named to the model, not just the one already on screen');
  });
});

test('visible lines carries at least as many cards as one call can produce', async () => {
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
      transcriptItems: Array.from({ length: 14 }, (_, i) => ({ text: `Line ${i}`, mode: 'speaker', source: 'ai' })),
      transcriptChunks: [{ text: 'A new real block.', at: now, mode: 'speaker' }]
    }
  }, async ({ runtime }) => {
    // 12 is the literal runaway guard from #49, not a value read back out of the code under test:
    // a window smaller than one call's own output drops a card before the next call is made. If
    // this fails after somebody moves the guard, that number is Ansel's (see line-guard.test.js),
    // so it is a conversation with him rather than a number to follow along here.
    await runtime.summarizeCurrentText();
    assert.equal(seenVisibleLines.length, 12);
    assert.deepEqual(seenVisibleLines, Array.from({ length: 12 }, (_, i) => `Line ${i + 2}`));
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
  const liveDriver = { id: 'browser', isLive: true, async start() {}, async stop() {}, setMode() {} };
  const now = Date.now();

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => liveDriver,
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      // Two chunks totalling just over BUCKET_MAX_CHARS (8000): trimBucket must drop the oldest
      // one to get back under the cap -- the only way this repo ever loses speech (INV-13). The
      // newest chunk ends with terminal punctuation so partitionBucket treats it as consumable
      // immediately (otherwise, as the newest and still-unsettled chunk, it would sit in the
      // unconsumable remainder and the summarize call below would have nothing to send).
      transcriptChunks: [
        { text: fillerOfLength(5000), at: now - 20000 },
        { text: `${fillerOfLength(4999)}.`, at: now - 1000 }
      ]
    }
  }, async ({ ctx, elements, runtime }) => {
    // A real driver, actually started, rather than a `listening: true` shortcut -- the recovered
    // level below depends on the driver's own `isLive`, which only exists once one is built.
    await runtime.startListening();
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

// clearSpeechDroppedAlert() runs from inside resetSummarizeBackoff(), which fires BEFORE
// summarizeCurrentText's own second `if (ctx.state.paused) return;` guard further down (the FIRST
// one, at the top of the function, would make the whole call a no-op if paused before it even
// starts -- so paused has to flip mid-flight, after the call is already past that first guard).
// While paused this way, clearSpeechDroppedAlert's own recovered status is the one left standing,
// not immediately overwritten by the correct recoveredLevel computed further down the unpaused
// path -- the only way to observe this function's own output rather than a later, already-correct
// overwrite masking it (confirmed by mutation: reverting clearSpeechDroppedAlert to source its
// level from ctx.state.listening does NOT fail an unpaused version of this test, only this one).
test('a bucket trim during replay recovers to "Manual mode", not "Listening", while paused', async () => {
  let resolveSummarize;
  const inFlightDriver = {
    id: 'openai',
    summarize: () => new Promise((resolve) => {
      resolveSummarize = () => resolve({ line: '' });
    })
  };
  const replayDriver = { id: 'replay', isLive: false, async start() {}, async stop() {}, setMode() {} };
  const now = Date.now();

  await withRuntimeHarness({
    stateOverrides: {
      transcriptionSource: 'replay',
      // Same overflow setup as the live-driver version of this test: two chunks totalling just
      // over BUCKET_MAX_CHARS (8000), forcing trimBucket to drop the oldest one.
      transcriptChunks: [
        { text: fillerOfLength(5000), at: now - 20000 },
        { text: `${fillerOfLength(4999)}.`, at: now - 1000 }
      ]
    },
    createTranscriptionDriverFn: () => replayDriver,
    createSummarizationDriverFn: () => inFlightDriver
  }, async ({ ctx, elements, runtime }) => {
    // A real (replay) driver, actually started, so clearSpeechDroppedAlert's recovered level is
    // read from the driver's own isLive rather than ctx.state.listening (which stays true here --
    // pausing does not stop the driver via ctx.state.listening's own definition).
    await runtime.startListening();
    runtime.showRecentTranscript();

    assert.equal(ctx.state.railStatusLevel, 'dropped');

    const pending = runtime.summarizeCurrentText();
    await new Promise((resolve) => setImmediate(resolve));

    // Flip paused directly (not via togglePauseAi, which would itself overwrite the rail with a
    // 'paused' status and short-circuit the very path this test needs to exercise) only once the
    // call is already past the entry guard and awaiting the summarize provider.
    ctx.state.paused = true;
    resolveSummarize();
    await pending;

    // The recovered rail must be honest about replay having no microphone -- "Manual mode", not
    // "Listening", even though a driver is running (ctx.state.listening is true throughout).
    assert.equal(ctx.state.railStatusLevel, 'manual');
    assert.equal(elements.railStatusWord.textContent, 'Manual');
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
  const liveDriver = { id: 'browser', isLive: true, async start() {}, async stop() {}, setMode() {} };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => liveDriver,
    createSummarizationDriverFn: () => driver
  }, async ({ ctx, elements, runtime }) => {
    // A real driver, actually started, rather than a `listening: true` shortcut -- the recovered
    // level below depends on the driver's own `isLive`, which only exists once one is built.
    await runtime.startListening();
    const first = runtime.summarizeCurrentText('first pass now');
    await new Promise((resolve) => setImmediate(resolve));

    // Tick 2: the previous call is still in flight -- one skip, not yet sticky-worthy (mirrors
    // SILENCE_WATCHDOG_MS's "don't cry wolf on a single blip" reasoning).
    await runtime.summarizeCurrentText('tick two now');
    assert.notEqual(ctx.state.railStatusLevel, 'behind');

    // Tick 3: a second consecutive skip -- the wall is now more than one full interval behind.
    await runtime.summarizeCurrentText('tick three now');
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

// Same reasoning as the bucket-trim version above: clearWallBehindAlert() runs from inside
// resetSummarizeBackoff(), before summarizeCurrentText's own `if (ctx.state.paused) return;`
// guard, so pausing first is the only way to observe ITS recovered level rather than a later,
// already-correct overwrite masking it (confirmed by mutation: reverting clearWallBehindAlert to
// source its level from ctx.state.listening does NOT fail the non-paused version of this test).
test('a "Running behind" note during replay recovers to "Manual mode", not "Listening", while paused', async () => {
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
  const replayDriver = { id: 'replay', isLive: false, async start() {}, async stop() {}, setMode() {} };

  await withRuntimeHarness({
    stateOverrides: { transcriptionSource: 'replay' },
    createTranscriptionDriverFn: () => replayDriver,
    createSummarizationDriverFn: () => driver
  }, async ({ ctx, elements, runtime }) => {
    // A real (replay) driver, actually started, so clearWallBehindAlert's recovered level is
    // read from the driver's own isLive rather than ctx.state.listening (which stays true here).
    await runtime.startListening();
    const first = runtime.summarizeCurrentText('first pass now');
    await new Promise((resolve) => setImmediate(resolve));

    await runtime.summarizeCurrentText('tick two now');
    await runtime.summarizeCurrentText('tick three now');
    assert.equal(ctx.state.railStatusLevel, 'behind');

    // Flip paused directly (not via togglePauseAi, which would itself overwrite the rail with a
    // 'paused' status and short-circuit the very path this test needs to exercise).
    ctx.state.paused = true;
    resolveFirst();
    await first;

    // The recovered rail must be honest about replay having no microphone -- "Manual mode", not
    // "Listening", even though a driver is running (ctx.state.listening is true throughout).
    assert.equal(ctx.state.railStatusLevel, 'manual');
    assert.equal(elements.railStatusWord.textContent, 'Manual');
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
  const liveDriver = { id: 'browser', isLive: true, async start() {}, async stop() {}, setMode() {} };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => liveDriver,
    createSummarizationDriverFn: () => driver
  }, async ({ ctx, runtime }) => {
    // A real driver, actually started, rather than a `listening: true` shortcut -- the recovered
    // level below depends on the driver's own `isLive`, which only exists once one is built.
    await runtime.startListening();
    const first = runtime.summarizeCurrentText('first pass now');
    await new Promise((resolve) => setImmediate(resolve));
    await runtime.summarizeCurrentText('tick two now');
    await runtime.summarizeCurrentText('tick three now');
    assert.equal(ctx.state.railStatusLevel, 'behind');

    resolveFirst();
    await first;
    assert.equal(ctx.state.railStatusLevel, 'listening', 'the stalled call succeeded, so this clears normally');

    // Now force a fresh, genuinely late-and-failing attempt: two skipped ticks re-arm "behind",
    // then the attempt that finally gets to run fails instead of succeeding.
    const second = runtime.summarizeCurrentText('tick four now');
    await new Promise((resolve) => setImmediate(resolve));
    await runtime.summarizeCurrentText('tick five now');
    await runtime.summarizeCurrentText('tick six now');
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

test('confirming an armed clear also clears summaryHistory', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      transcriptItems: [{ text: 'first line' }],
      summaryHistory: [{ spoken: 'x', shown: 'y' }]
    }
  }, async ({ ctx, runtime }) => {
    runtime.clearLines();
    runtime.clearLines();

    assert.deepEqual(ctx.state.summaryHistory, []);
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
    isLive: true,
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
    isLive: true,
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
    isLive: true,
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
    isLive: true,
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

test('a live CLIPPING reading always reaches the operator even when the device is calibrated too-noisy (sign-off blocker, 2026-07-30)', async () => {
  // Regression guard for the withheld fix: calibrationText used to unconditionally beat display.text
  // (`calibrationText || display.text`), so a too-noisy verdict permanently hid every real "Too loud"
  // warning for that device. A meter that can suppress the worst reading it can produce is worse than
  // one that shows nothing, because the operator believes what it says.
  const fakeProbe = {
    async start() {
      return { ok: true, calibration: { tooNoisy: true, gateDbfs: null, ambientFloorDbfs: -30, measuredAt: Date.now() } };
    },
    readLevels() {
      return { rms_dbfs: -2, peak_dbfs: -1, gain_db: 0, clipCount: 3, classification: 'CLIPPING', speaking: true };
    },
    stop() {}
  };

  await withRuntimeHarness({
    createMicProbeFn: () => fakeProbe,
    mediaDevicesImpl: { enumerateDevices: async () => [] }
  }, async ({ ctx, runtime }) => {
    await runtime.toggleAudioLevelTest();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(ctx.dom.audioLevelText.textContent, 'Too loud', 'the CLIPPING warning must survive the too-noisy calibration advisory');
    assert.ok(ctx.dom.audioLevelBar.classList.contains('clipping'));

    // Required, not tidiness: startAudioLevelTest leaves a setInterval running, so a test that never
    // stops the probe keeps the event loop alive and `node --test` never exits. Omitting this hung
    // the whole suite rather than failing it.
    runtime.stopAudioLevelTest();
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
    isLive: true,
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

// Replay is a recorded session, not a live feed (GitHub issue #3). The driver states its own
// honest level, but startListening() used to overwrite that with "Listening." at rail level
// `listening` for every driver alike -- so the rail read "Listening" while a recording played, and
// a real problem the driver had just reported (recording missing, or holding no lines) was wiped
// by it. The driver's own unit tests could not see this: the lie is added a layer above them.
test('starting replay never claims a live feed on the rail, and never overwrites the driver status', async () => {
  const driver = {
    id: 'replay',
    async start() {
      this.onStatusText = 'Replaying a recorded session — not live.';
    },
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    stateOverrides: { transcriptionSource: 'replay' },
    createTranscriptionDriverFn: () => driver
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();

    assert.equal(ctx.state.listening, true);
    assert.notEqual(elements.railStatusWord.textContent, 'Listening');
    assert.notEqual(ctx.state.railStatusLevel, 'listening');
    assert.notEqual(elements.status.textContent, 'Listening.');
    // No silence watchdog either: a gap in a recording is not a dead microphone.
    assert.ok(!ctx.state.silenceWatchdogTimer);
  });
});

test('resuming replay after a pause does not announce the microphone listening again', async () => {
  const driver = {
    id: 'replay',
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    stateOverrides: { transcriptionSource: 'replay' },
    createTranscriptionDriverFn: () => driver
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();
    await runtime.togglePauseAi();
    await runtime.togglePauseAi();

    assert.notEqual(elements.railStatusWord.textContent, 'Listening');
    assert.notEqual(ctx.state.railStatusLevel, 'listening');
    assert.notEqual(elements.status.textContent, 'AI resumed — microphone listening again.');
  });
});

// togglePauseAi() used to source its wording from ctx.state.listening ("is a driver running"),
// not from the driver's own liveness -- so pausing during replay claimed a microphone had
// stopped when there never was one. wasLiveCapture now comes from
// activeTranscriptionStatusLevel() instead; these three tests cover the case it used to
// conflate (replay) against the two it must not regress (a real live driver, and no driver at
// all).
test('pausing AI during replay reports the generic pause, not "microphone stopped"', async () => {
  const driver = {
    id: 'replay',
    isLive: false,
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    stateOverrides: { transcriptionSource: 'replay' },
    createTranscriptionDriverFn: () => driver
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();
    await runtime.togglePauseAi();

    assert.equal(elements.status.textContent, 'AI paused. Manual lines still work.');
    assert.equal(ctx.state.railStatusLevel, 'paused');
  });
});

test('pausing AI during a live browser session still reports "microphone stopped"', async () => {
  const driver = {
    id: 'browser',
    isLive: true,
    async start() {},
    async stop() {},
    setMode() {}
  };

  await withRuntimeHarness({
    stateOverrides: { transcriptionSource: 'browser' },
    createTranscriptionDriverFn: () => driver
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();
    await runtime.togglePauseAi();

    assert.equal(elements.status.textContent, 'AI paused — microphone stopped. Manual lines still work.');
    assert.equal(ctx.state.railStatusLevel, 'paused');
  });
});

test('pausing AI with no driver running at all reports the generic pause', async () => {
  await withRuntimeHarness({}, async ({ ctx, elements, runtime }) => {
    await runtime.togglePauseAi();

    assert.equal(elements.status.textContent, 'AI paused. Manual lines still work.');
    assert.equal(ctx.state.railStatusLevel, 'paused');
  });
});

// The third site the ad-hoc `driver.id !== 'replay'` gates missed: recovering from a
// backlogged mode-run derived its level from ctx.state.listening directly (true for every
// driver, live or not), so the rail read "Listening" once a replay session's `Added:` line
// landed. Only the driver's own `isLive` -- via activeTranscriptionStatusLevel() -- may say so.
test('a replay session summarized to a real line reports "manual", not "listening", on the rail', async () => {
  const driver = {
    id: 'replay',
    isLive: false,
    async start() {},
    async stop() {},
    setMode() {}
  };
  const succeedingDriver = {
    id: 'openai',
    summarize: async () => ({ line: 'a useful summary line' })
  };

  await withRuntimeHarness({
    stateOverrides: { transcriptionSource: 'replay' },
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => succeedingDriver
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();
    await runtime.summarizeCurrentText('some backlogged speech');

    assert.equal(elements.status.textContent, 'Added: a useful summary line');
    assert.notEqual(ctx.state.railStatusLevel, 'listening');
    assert.equal(ctx.state.railStatusLevel, 'manual');
    assert.notEqual(elements.railStatusWord.textContent, 'Listening');
  });
});

test('a live driver summarized to a real line still reports "listening" on the rail', async () => {
  const driver = {
    id: 'browser',
    isLive: true,
    async start() {},
    async stop() {},
    setMode() {}
  };
  const succeedingDriver = {
    id: 'openai',
    summarize: async () => ({ line: 'a useful summary line' })
  };

  await withRuntimeHarness({
    stateOverrides: { transcriptionSource: 'browser' },
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => succeedingDriver
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();
    await runtime.summarizeCurrentText('some backlogged speech');

    assert.equal(elements.status.textContent, 'Added: a useful summary line');
    assert.equal(ctx.state.railStatusLevel, 'listening');
  });
});

test('an openai driver summarized to a real line reports "listening" on the rail', async () => {
  const driver = {
    id: 'openai',
    isLive: true,
    async start() {},
    async stop() {},
    setMode() {}
  };
  const succeedingDriver = {
    id: 'openai',
    summarize: async () => ({ line: 'a useful summary line' })
  };

  await withRuntimeHarness({
    stateOverrides: { transcriptionSource: 'openai', openAiReady: true },
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => succeedingDriver
  }, async ({ ctx, elements, runtime }) => {
    await runtime.startListening();
    await runtime.summarizeCurrentText('some backlogged speech');

    assert.equal(elements.status.textContent, 'Added: a useful summary line');
    assert.equal(ctx.state.railStatusLevel, 'listening');
  });
});

// --- Real mic readiness for the Ready check row (2026-07-30 bug fix) -------

test('refreshMicReadiness marks the mic not-ready on denied permission', async () => {
  const permissionsImpl = { query: async () => ({ state: 'denied' }) };
  const mediaDevicesImpl = {
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'USB Mic' }]
  };

  await withRuntimeHarness({ permissionsImpl, mediaDevicesImpl }, async ({ ctx, runtime }) => {
    await runtime.refreshMicReadiness();
    assert.equal(ctx.state.micReady, false);
    assert.equal(ctx.state.micReadyReason, 'denied');
  });
});

test('refreshMicReadiness marks the mic not-ready on an empty device list', async () => {
  const permissionsImpl = { query: async () => ({ state: 'granted' }) };
  const mediaDevicesImpl = { enumerateDevices: async () => [] };

  await withRuntimeHarness({ permissionsImpl, mediaDevicesImpl }, async ({ ctx, runtime }) => {
    await runtime.refreshMicReadiness();
    assert.equal(ctx.state.micReady, false);
    assert.equal(ctx.state.micReadyReason, 'no-device');
  });
});

test('refreshMicReadiness marks the mic not-ready when only the pre-permission blank-id placeholder is listed', async () => {
  const permissionsImpl = { query: async () => ({ state: 'prompt' }) };
  const mediaDevicesImpl = {
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: '', label: '' }]
  };

  await withRuntimeHarness({ permissionsImpl, mediaDevicesImpl }, async ({ ctx, runtime }) => {
    await runtime.refreshMicReadiness();
    assert.equal(ctx.state.micReady, false);
    assert.equal(ctx.state.micReadyReason, 'no-device');
  });
});

test('refreshMicReadiness marks the mic ready with granted permission and a real device', async () => {
  const permissionsImpl = { query: async () => ({ state: 'granted' }) };
  const mediaDevicesImpl = {
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'USB Mic' }]
  };

  await withRuntimeHarness({ permissionsImpl, mediaDevicesImpl }, async ({ ctx, runtime }) => {
    await runtime.refreshMicReadiness();
    assert.equal(ctx.state.micReady, true);
  });
});

test('refreshMicReadiness degrades defensibly (never throws) when permissions.query itself throws', async () => {
  const permissionsImpl = {
    query: async () => {
      throw new Error('unsupported permission name');
    }
  };
  const mediaDevicesImpl = {
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'USB Mic' }]
  };

  await withRuntimeHarness({ permissionsImpl, mediaDevicesImpl }, async ({ ctx, runtime }) => {
    await assert.doesNotReject(runtime.refreshMicReadiness());
    // Falls back to the device list alone: a real device is present, so this reads ready rather
    // than crashing the settings pane or refusing to render a verdict at all.
    assert.equal(ctx.state.micReady, true);
  });
});

test('stopping listening forces a final drain that consumes a stranded unpunctuated final chunk', async () => {
  let sentText = null;
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript }) => {
      sentText = recentTranscript;
      return { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      // No terminal punctuation and captured "now" -- normally held by partitionBucket's
      // BUCKET_SETTLE_MS hold as "the speaker may still be mid-sentence." Stop is the one moment
      // that assumption is known false.
      transcriptChunks: [{ text: 'and that concludes the closing announcements', at: now }]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    await runtime.stopListening();

    assert.equal(sentText, 'and that concludes the closing announcements');
    assert.equal(ctx.state.transcriptChunks.length, 0, 'the stranded chunk must be consumed, not left behind');
  });
});

test('stopping listening with an empty bucket fires no summarize call and does not error', async () => {
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };
  let called = false;
  const summarizeDriver = {
    id: 'openai',
    summarize: async () => {
      called = true;
      return { line: '' };
    }
  };

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => summarizeDriver,
    stateOverrides: { transcriptChunks: [] }
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    await assert.doesNotReject(runtime.stopListening());

    assert.equal(called, false, 'an empty bucket must not fire a pointless summarize call');
  });
});

test('stopping listening while a summarize call is already in flight does not double-send the final chunk', async () => {
  let resolveSummarize;
  const calls = [];
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };
  const stallingDriver = {
    id: 'openai',
    summarize: ({ recentTranscript }) => {
      calls.push(recentTranscript);
      return new Promise((resolve) => { resolveSummarize = resolve; });
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => stallingDriver,
    stateOverrides: {
      // First (punctuated, so eligible right away) chunk starts an in-flight call; the second
      // (unpunctuated, freshly captured) chunk is the one that only Stop's final drain can reach.
      transcriptChunks: [
        { text: 'Welcome everyone to the meeting.', at: now - 30000 },
        { text: 'and now for the closing prayer', at: now }
      ]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();

    // Kick off the in-flight call directly (mirrors the interval tick) before Stop is pressed.
    const inFlight = runtime.summarizeCurrentText();
    await flushMicrotasks();
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'Welcome everyone to the meeting.');
    const resolveFirst = resolveSummarize;

    // stopListening must await that in-flight call before running its own final drain -- racing
    // the two would risk sending the second chunk twice or sending it while still uncorrelated.
    const stopping = runtime.stopListening();
    await flushMicrotasks();
    assert.equal(calls.length, 1, 'the final drain must not fire until the in-flight call has resolved');

    resolveFirst({ line: '' });
    await inFlight;
    await flushMicrotasks();
    assert.equal(calls.length, 2, 'the final drain must run exactly once, after the in-flight call resolves');
    assert.equal(calls[1], 'and now for the closing prayer');

    resolveSummarize({ line: '' });
    await stopping;

    assert.equal(ctx.state.transcriptChunks.length, 0);
  });
});

test('a final drain on Stop still ends a run at a mode boundary -- one summarize call never spans two modes', async () => {
  const calls = [];
  const driver = {
    id: 'browser',
    async start() {},
    async stop() {},
    setMode() {}
  };
  const succeedingDriver = {
    id: 'openai',
    summarize: async ({ recentTranscript, mode }) => {
      calls.push({ recentTranscript, mode });
      return { line: '' };
    }
  };
  const now = Date.now();

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => succeedingDriver,
    stateOverrides: {
      transcriptChunks: [
        { text: 'welcome everyone to the meeting', at: now - 1000, mode: 'speaker' },
        { text: 'the potluck is Saturday', at: now, mode: 'information' }
      ]
    }
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    await runtime.stopListening();

    // #54: the final drain now keeps pulling complete runs out in the same drain rather than
    // leaving the second speaker's/mode's words stuck in the bucket after Stop with nothing left
    // to ever pick them up again -- but still as two separate calls, one per mode, never one call
    // spanning both.
    assert.equal(calls.length, 2, 'each mode run is still its own call, even when both drain on Stop');
    assert.equal(calls[0].recentTranscript, 'welcome everyone to the meeting');
    assert.equal(calls[0].mode, 'speaker');
    assert.equal(calls[1].recentTranscript, 'the potluck is Saturday');
    assert.equal(calls[1].mode, 'information');
    assert.deepEqual(ctx.state.transcriptChunks, []);
  });
});

function createSentenceEndHarness() {
  const driver = {
    id: 'browser',
    label: 'Browser',
    isLive: true,
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
  const runNext = (delay) => {
    const index = scheduled.findIndex((item) => item.delay === delay);
    if (index === -1) return false;
    const [next] = scheduled.splice(index, 1);
    next.callback();
    return true;
  };
  const advance = (ms) => {
    currentTime += ms;
  };

  return { driver, nowFn, setTimeoutFn, clearTimeoutFn, runNext, advance, getTime: () => currentTime };
}

test('sentence-end-on-silence appends a period to the newest chunk after SENTENCE_END_SILENCE_MS of no recognition events', async () => {
  const { driver, nowFn, setTimeoutFn, clearTimeoutFn, runNext, advance } = createSentenceEndHarness();

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    nowFn,
    setTimeoutFn,
    clearTimeoutFn
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    runtime.handleTranscriptEvent({ type: 'final', text: 'the young man went away' });
    assert.equal(ctx.state.transcriptChunks.at(-1).text, 'the young man went away');

    // Advance in 500ms steps to one step short of the threshold.
    const stepsShortOfThreshold = SENTENCE_END_SILENCE_MS / 500 - 1;
    for (let i = 0; i < stepsShortOfThreshold; i += 1) {
      advance(500);
      runNext(500);
    }
    assert.equal(
      ctx.state.transcriptChunks.at(-1).text,
      'the young man went away',
      'must not punctuate before the threshold'
    );

    // Cross the threshold.
    advance(500);
    runNext(500);
    assert.equal(ctx.state.transcriptChunks.at(-1).text, 'the young man went away.');

    // Idempotence: further ticks must never append a second period.
    advance(500);
    runNext(500);
    advance(500);
    runNext(500);
    assert.equal(ctx.state.transcriptChunks.at(-1).text, 'the young man went away.');
  });
});

test('a partial arriving before the threshold resets the sentence-end clock', async () => {
  const { driver, nowFn, setTimeoutFn, clearTimeoutFn, runNext, advance } = createSentenceEndHarness();

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    nowFn,
    setTimeoutFn,
    clearTimeoutFn
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    runtime.handleTranscriptEvent({ type: 'final', text: 'we welcome our visitors' });

    // Just under the threshold -- not enough to end the sentence.
    advance(SENTENCE_END_SILENCE_MS - 100);
    runNext(500);
    assert.equal(ctx.state.transcriptChunks.at(-1).text, 'we welcome our visitors');

    // A partial arrives right before the threshold and resets the clock.
    runtime.handleTranscriptEvent({ type: 'partial', text: 'we welcome our visitors and' });
    advance(SENTENCE_END_SILENCE_MS - 100);
    runNext(500);
    assert.equal(
      ctx.state.transcriptChunks.at(-1).text,
      'we welcome our visitors',
      'the partial must have reset the clock, not merely delayed it'
    );

    // Now the full threshold has actually elapsed since the partial.
    advance(200);
    runNext(500);
    assert.equal(ctx.state.transcriptChunks.at(-1).text, 'we welcome our visitors.');
  });
});

test('sentence-end-on-silence never fires while paused or not listening', async () => {
  const { driver, nowFn, setTimeoutFn, clearTimeoutFn, runNext, advance } = createSentenceEndHarness();

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    nowFn,
    setTimeoutFn,
    clearTimeoutFn
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    runtime.handleTranscriptEvent({ type: 'final', text: 'a line still mid sentence' });
    await runtime.togglePauseAi();

    advance(SENTENCE_END_SILENCE_MS + 1000);
    // No sentence-end timer should even be scheduled once paused (stopSilenceWatchdog clears it).
    assert.equal(runNext(500), false);
    assert.equal(ctx.state.transcriptChunks.at(-1).text, 'a line still mid sentence');
  });
});

test('inferred sentence-end punctuation is recorded as a follow-up record sharing the spoken chunk\'s id, not a silent rewrite of it', async () => {
  const { driver, nowFn, setTimeoutFn, clearTimeoutFn, runNext, advance } = createSentenceEndHarness();

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    nowFn,
    setTimeoutFn,
    clearTimeoutFn,
    stateOverrides: { recordingEnabled: true, recordingQueue: [] }
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    runtime.handleTranscriptEvent({ type: 'final', text: 'the offering will be received' });

    const spokenRecord = ctx.state.recordingQueue.find((record) => record.t === 'chunk');
    assert.equal(spokenRecord.text, 'the offering will be received');
    assert.equal(spokenRecord.inferred, false);

    advance(SENTENCE_END_SILENCE_MS);
    runNext(500);

    const chunkRecords = ctx.state.recordingQueue.filter((record) => record.t === 'chunk');
    assert.equal(chunkRecords.length, 2, 'the original spoken record must stay, plus one inferred follow-up');
    assert.equal(chunkRecords[0].text, 'the offering will be received', 'the spoken record must never be rewritten');
    assert.equal(chunkRecords[1].id, chunkRecords[0].id, 'the follow-up shares the spoken chunk\'s id');
    assert.equal(chunkRecords[1].text, 'the offering will be received.');
    assert.equal(chunkRecords[1].inferred, true);
    assert.equal(ctx.state.transcriptChunks.at(-1).text, 'the offering will be received.');
  });
});

test('a header record is queued once, before any chunk or summary record, and carries no transcript text or key material (issue #4)', async () => {
  const { driver, nowFn, setTimeoutFn, clearTimeoutFn } = createSentenceEndHarness();

  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => ({ line: '' }) }),
    nowFn,
    setTimeoutFn,
    clearTimeoutFn,
    stateOverrides: {
      recordingEnabled: true,
      recordingQueue: [],
      appCommit: 'abc123',
      summaryMaxWords: 15,
      summaryIntervalSeconds: 5,
      summarizationSource: 'openai'
    }
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    runtime.handleTranscriptEvent({ type: 'final', text: 'a very secret thing was said here' });

    assert.equal(ctx.state.recordingQueue[0].t, 'header', 'the header must be the first record in the queue');
    const header = ctx.state.recordingQueue[0];
    assert.equal(header.appCommit, 'abc123');
    assert.equal(header.maxWords, 15);
    assert.equal(header.provider, 'openai');
    assert.equal(header.intervalSeconds, 5);
    assert.match(header.promptHash, /^[0-9a-f]{8}$/);

    // No field on the header may carry the words actually spoken.
    assert.ok(!JSON.stringify(header).includes('secret'), 'the header must never carry transcript text');

    // Only one header for the whole session, however many chunk records follow.
    runtime.handleTranscriptEvent({ type: 'final', text: 'a second thing was said' });
    const headerCount = ctx.state.recordingQueue.filter((record) => record.t === 'header').length;
    assert.equal(headerCount, 1, 'the header must be written exactly once per session');
  });
});

test('turning recording off before the header has been flushed does not leave the file headerless when it goes back on (issue #4)', async () => {
  await withRuntimeHarness({
    stateOverrides: {
      recordingEnabled: true,
      recordingQueue: [],
      appCommit: 'abc123',
      summaryMaxWords: 15,
      summaryIntervalSeconds: 5,
      summarizationSource: 'openai'
    }
  }, async ({ ctx, runtime }) => {
    runtime.handleTranscriptEvent({ type: 'final', text: 'first thing said' });
    assert.equal(ctx.state.recordingQueue[0].t, 'header');

    // Off before any flush: the queued header is discarded along with everything else.
    runtime.setRecordingEnabled(false);
    assert.equal(ctx.state.recordingQueue.length, 0);

    runtime.setRecordingEnabled(true);
    runtime.handleTranscriptEvent({ type: 'final', text: 'second thing said' });

    assert.equal(ctx.state.recordingQueue[0].t, 'header', 'the header must be re-queued, not lost with the discarded batch');
    assert.equal(ctx.state.recordingQueue.filter((record) => record.t === 'header').length, 1);
  });
});

test('several cards from one summary are released one at a time, not dropped on the wall together', async () => {
  // A testimony is now four or five cards (the model splits by thought, packLinesIntoCards sizes
  // them). Four appearing in the same frame costs a slow reader their place, which is the exact
  // thing the display exists to protect.
  const timers = [];
  await withRuntimeHarness({
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutFn: () => {}
  }, async ({ ctx, runtime }) => {
    runtime.addLine('First thought.\nSecond thought.\nThird thought.', { source: 'ai', paced: true });

    assert.equal(ctx.state.transcriptItems.length, 1, 'only the first card goes up immediately');
    assert.match(ctx.state.transcriptItems[0].text, /First thought/);

    const tick = () => timers.filter((t) => t.ms === 5000).pop();
    tick().fn();
    assert.equal(ctx.state.transcriptItems.length, 2);
    tick().fn();
    assert.equal(ctx.state.transcriptItems.length, 3);
    assert.match(ctx.state.transcriptItems[2].text, /Third thought/);
  });
});

// Issue #40: a paced card's speaker is captured when the card is CREATED (inside addLine, before
// it ever reaches the release queue), not read from ctx.state.speakerName again when the queue
// finally releases it -- otherwise a speaker change mid-queue mislabels every card still waiting.
test('a speaker change mid-queue labels the still-queued cards with the speaker active when each was created, not at release', async () => {
  const timers = [];
  await withRuntimeHarness({
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutFn: () => {},
    stateOverrides: { speakerName: 'Alpha' }
  }, async ({ ctx, runtime }) => {
    runtime.addLine('First thought.\nSecond thought.\nThird thought.', { source: 'ai', paced: true });
    assert.equal(ctx.state.transcriptItems[0].speaker, 'Alpha', 'the first card is created (and shown) under Alpha');

    // The operator changes speaker while the second and third cards are still queued.
    runtime.setSpeakerName('Beta');

    const tick = () => timers.filter((t) => t.ms === 5000).pop();
    tick().fn();
    tick().fn();

    assert.equal(ctx.state.transcriptItems.length, 3);
    assert.equal(ctx.state.transcriptItems[1].speaker, 'Alpha', 'created under Alpha, must not inherit the later change');
    assert.equal(ctx.state.transcriptItems[2].speaker, 'Alpha', 'same for the third queued card');
  });
});

test('a manual line is never paced -- the operator pressed Show now', async () => {
  await withRuntimeHarness({}, async ({ ctx, runtime }) => {
    runtime.addLine('Typed by hand.', { source: 'manual' });
    assert.equal(ctx.state.transcriptItems.length, 1);
    assert.match(ctx.state.transcriptItems[0].text, /Typed by hand/);
  });
});

test('Clear drops cards still queued, so they cannot land on a screen just emptied', async () => {
  const timers = [];
  await withRuntimeHarness({
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutFn: () => {}
  }, async ({ ctx, runtime }) => {
    runtime.addLine('One.\nTwo.\nThree.', { source: 'ai', paced: true });
    assert.equal(ctx.state.transcriptItems.length, 1);

    runtime.clearLines(); // arms
    runtime.clearLines(); // confirms
    assert.equal(ctx.state.transcriptItems.length, 0);

    for (const t of timers.filter((t) => t.ms === 5000)) t.fn();
    assert.equal(ctx.state.transcriptItems.length, 0, 'a queued card must not reappear after a Clear');
  });
});

test('a multi-line summary becomes multiple cards, not one merged run-on card', async () => {
  // Regression, found 2026-08-02: addLine ran normalizeText over the whole reply, and normalizeText
  // collapses /\s+/ -- newlines included. createTranscriptItems' AI path splits on newlines and
  // nothing else, so by the time it ran there were no breaks left to split on. Every multi-line
  // result had been arriving as one card, silently, including information mode's announcements.
  await withRuntimeHarness({}, async ({ ctx, runtime }) => {
    runtime.addLine('Closing hymn is number 301.\nSister Ellsworth will offer the benediction.', { source: 'ai' });
    assert.equal(ctx.state.transcriptItems.length, 2, 'two announcements must be two cards');
    assert.match(ctx.state.transcriptItems[0].text, /^Closing hymn is number 301\.$/);
    assert.match(ctx.state.transcriptItems[1].text, /^Sister Ellsworth will offer the benediction\.$/);
  });
});

test('the first card does not wait out an interval, and later ones do (#31)', async () => {
  // At the honest 20s interval the reader watched a blank wall for up to 20 seconds after the meeting
  // started, with no way to tell the app was working, while speech sat in the bucket waiting on a
  // clock. Steve's call: summarize the first complete chunk on arrival, then let the interval own the
  // cadence.
  const calls = [];
  await withRuntimeHarness({
    createSummarizationDriverFn: () => ({
      id: 'openai',
      summarize: async ({ recentTranscript }) => { calls.push(recentTranscript); return { line: 'A first card.' }; }
    }),
    stateOverrides: { summaryIntervalSeconds: 20, openAiReady: true, summarizationSource: 'openai' }
  }, async ({ ctx, runtime }) => {
    // Falsy, not literally false: the harness deliberately does not seed what start-app.js seeds, so
    // this is undefined here. The code tests `!firstCardShown`, so undefined and false behave the same
    // and asserting the literal would be stricter than the contract.
    assert.ok(!ctx.state.firstCardShown, 'sanity: the wall starts empty');

    // One complete sentence arrives. No interval tick has happened.
    runtime.handleTranscriptEvent({ type: 'final', text: 'I would like to bear my testimony.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await ctx.state.summarizeCallPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls.length, 1, 'the first complete chunk must be summarized on arrival');
    assert.equal(ctx.state.firstCardShown, true, 'and the wall is no longer empty');

    // A second chunk must NOT trigger another immediate call: the interval owns the cadence now.
    runtime.handleTranscriptEvent({ type: 'final', text: 'I know the Church is true.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1, 'later chunks wait for the interval rather than summarizing on arrival');
  });
});

test('clearing the wall makes the first-card path live again (#31, #77)', async () => {
  // Ansel's framing, which holds however this is solved: the empty-screen problem is not the first
  // line of a meeting, it is any moment the card area is blank while speech is being heard. Asserting
  // the flag directly would survive it being renamed into meaninglessness (#77) -- assert the
  // behavior the flag exists to gate: a chunk arriving at a blank wall must summarize on arrival,
  // not wait out the interval.
  const calls = [];
  await withRuntimeHarness({
    createSummarizationDriverFn: () => ({
      id: 'openai',
      summarize: async ({ recentTranscript }) => { calls.push(recentTranscript); return { line: 'A fresh card.' }; }
    }),
    stateOverrides: {
      firstCardShown: true,
      summaryIntervalSeconds: 20,
      openAiReady: true,
      summarizationSource: 'openai',
      transcriptItems: [{ id: 'a', text: 'A card.', mode: 'speaker', source: 'ai', createdAt: 1 }]
    }
  }, async ({ ctx, runtime }) => {
    runtime.clearLines(); // arms
    runtime.clearLines(); // confirms
    assert.equal(ctx.state.transcriptItems.length, 0);

    runtime.handleTranscriptEvent({ type: 'final', text: 'Speech into the empty wall.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await ctx.state.summarizeCallPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls.length, 1, 'a chunk arriving at a cleared wall must summarize on arrival, not wait out the interval');
  });
});

test('undoing the last card makes the first-card path live again (#77)', async () => {
  // #31 fixed the clear path only; undoLine can also empty transcriptItems one card at a time
  // (removing the last remaining card) without going through clearLines, so it left the reader on a
  // blank wall waiting out a full interval.
  const calls = [];
  await withRuntimeHarness({
    createSummarizationDriverFn: () => ({
      id: 'openai',
      summarize: async ({ recentTranscript }) => { calls.push(recentTranscript); return { line: 'A fresh card.' }; }
    }),
    stateOverrides: {
      firstCardShown: true,
      summaryIntervalSeconds: 20,
      openAiReady: true,
      summarizationSource: 'openai',
      transcriptItems: [{ id: 'a', text: 'A card.', mode: 'speaker', source: 'ai', createdAt: 1 }]
    }
  }, async ({ ctx, runtime }) => {
    runtime.undoLine();
    assert.equal(ctx.state.transcriptItems.length, 0, 'sanity: undo removed the only card');

    runtime.handleTranscriptEvent({ type: 'final', text: 'Speech into the empty wall.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await ctx.state.summarizeCallPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls.length, 1, 'a chunk arriving after undo emptied the wall must summarize on arrival, not wait out the interval');
  });
});

test('a provider already in backoff is not called again on chunk arrival (#31)', async () => {
  // Found by Cato before this shipped. Gating on firstCardShown alone bypassed the summarize backoff
  // entirely: effectiveIntervalSeconds is consumed only by startLoop, so it lengthens the INTERVAL and
  // can do nothing about a call fired by a chunk arriving. With a provider down at meeting start that
  // was one call per speech chunk, several a minute, for the whole outage, while a deliberate 30 second
  // backoff sat there unused.
  let calls = 0;
  await withRuntimeHarness({
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => { calls += 1; return { line: '' }; } }),
    stateOverrides: { openAiReady: true, summarizationSource: 'openai', effectiveIntervalSeconds: 30 }
  }, async ({ runtime }) => {
    runtime.handleTranscriptEvent({ type: 'final', text: 'A complete sentence here.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 0, 'the interval is the backstop while backing off; arrival must not bypass it');
  });
});

test('barren chunks cannot each buy a provider call (#31)', async () => {
  // The healthy version of the same problem: speech that keeps returning no useful line never sets
  // firstCardShown, so without a floor between attempts every chunk bought its own call.
  let calls = 0;
  let now = 100000;
  await withRuntimeHarness({
    nowFn: () => now,
    createSummarizationDriverFn: () => ({ id: 'openai', summarize: async () => { calls += 1; return { line: '' }; } }),
    stateOverrides: { openAiReady: true, summarizationSource: 'openai' }
  }, async ({ ctx, runtime }) => {
    runtime.handleTranscriptEvent({ type: 'final', text: 'First barren sentence.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await ctx.state.summarizeCallPromise;
    const afterFirst = calls;
    assert.equal(afterFirst, 1, 'the first arrival does summarize');

    // Same instant: a second chunk must not buy a second call.
    runtime.handleTranscriptEvent({ type: 'final', text: 'Second barren sentence.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, afterFirst, 'a chunk arriving inside the floor must not trigger another call');

    // Past the floor: allowed again, because no card has landed and the wall is still empty.
    now += 5000;
    runtime.handleTranscriptEvent({ type: 'final', text: 'Third barren sentence.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(calls > afterFirst, 'past the floor the wall is still empty, so trying again is right');
  });
});

test('a new speaker gets the same fast path as the meeting\'s first speaker, even mid-meeting (#106)', async () => {
  // firstCardShown is already true (a card is on the wall from the outgoing speaker), so without
  // awaitingNewSpeakerArrival the incoming speaker's first sentence would wait out whatever is left
  // of the old interval. The loop itself is never touched, this only reopens the #31 arrival gate.
  const calls = [];
  await withRuntimeHarness({
    createSummarizationDriverFn: () => ({
      id: 'openai',
      summarize: async ({ recentTranscript }) => { calls.push(recentTranscript); return { line: 'A card.' }; }
    }),
    stateOverrides: { openAiReady: true, summarizationSource: 'openai', firstCardShown: true }
  }, async ({ ctx, runtime }) => {
    runtime.setMode('speaker');
    await new Promise((resolve) => setTimeout(resolve, 0));

    runtime.handleTranscriptEvent({ type: 'final', text: 'The new speaker begins their remarks.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await ctx.state.summarizeCallPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls.length, 1, 'the new speaker\'s first complete sentence must not wait for the interval');

    // A second chunk from the same speaker goes back to waiting on the interval.
    runtime.handleTranscriptEvent({ type: 'final', text: 'They continue with a second sentence.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1, 'only the first sentence after a speaker change gets the fast path');
  });
});

test('pressing Start Listening opens the fast path; an internal force-resume does not (#106)', async () => {
  const driver = {
    id: 'browser', label: 'Browser', isLive: true,
    async start() {}, async stop() {}, setMode() {}
  };
  await withRuntimeHarness({
    createTranscriptionDriverFn: () => driver
  }, async ({ ctx, runtime }) => {
    await runtime.startListening();
    assert.equal(ctx.state.awaitingNewSpeakerArrival, true, 'a real Start press opens the fast path');

    ctx.state.awaitingNewSpeakerArrival = false;
    await runtime.startListening({ force: true });
    assert.equal(ctx.state.awaitingNewSpeakerArrival, false, 'an internal force-resume is not a new speaker');
  });
});

test('#56: an interval too short for the measured reader is not reachable once their profile is applied', async () => {
  // At 30 wpm a 10-word card takes 20 seconds to read, so every position below 20s on the slider
  // derives a budget under the floor. Ansel's point: that configuration should not be reachable,
  // rather than reachable with a caption saying it does not work.
  await withRuntimeHarness({
    stateOverrides: { summaryIntervalSeconds: 5 }
  }, async ({ ctx, elements, runtime }) => {
    // With no measured profile nothing moves: the default pace is not a measurement of this reader,
    // and changing the out-of-the-box cadence is not this card's call.
    runtime.setSummaryInterval(9);
    assert.equal(ctx.state.summaryIntervalSeconds, 9);

    runtime.applyReadingPaceProfile('steve', {
      recordedAt: '2026-08-02T10:00:00.000Z',
      cards: [
        { text: 'ten words here to make the arithmetic land at thirty', words: 10, ms: 20000 },
        { text: 'ten words here to make the arithmetic land at thirty', words: 10, ms: 20000 }
      ]
    });

    // 2026-08-09: a profile is a full bookmark now, so this lands on the profile's OWN recommended
    // interval (22s at 30 wpm), not merely raised to the 20s floor -- 22 also happens to clear it.
    assert.equal(ctx.state.summaryIntervalSeconds, 22, "the interval is set to this reader's recommended pace");
    assert.equal(elements.summaryIntervalInput.min, '20', 'and the slider cannot be dragged back below the floor');

    runtime.setSummaryInterval(4);
    assert.equal(ctx.state.summaryIntervalSeconds, 20, 'a value arriving from anywhere else is held at the floor too');
  });
});

test('#56: the slider and the floor cannot drift apart when the interval itself does not move', async () => {
  // Both paths found by Cato gating #97, and both leave the control disagreeing with the setter.
  const SLOW_PROFILE = {
    recordedAt: '2026-08-02T10:00:00.000Z',
    cards: [
      { text: 'ten words here to make the arithmetic land at thirty', words: 10, ms: 20000 },
      { text: 'ten words here to make the arithmetic land at thirty', words: 10, ms: 20000 }
    ]
  };

  await withRuntimeHarness({
    // 22s is this profile's own recommended interval (30 wpm) -- already sitting there, so applying
    // it takes the setSummaryInterval no-op path (next === current) and only updateSummaryIntervalControl
    // runs, which is the exact path #97 found stale.
    stateOverrides: { summaryIntervalSeconds: 22 }
  }, async ({ ctx, elements, runtime }) => {
    runtime.applyReadingPaceProfile('steve', SLOW_PROFILE);
    assert.equal(ctx.state.summaryIntervalSeconds, 22, 'an interval that already matches the recommendation is left alone');
    assert.equal(elements.summaryIntervalInput.min, '20', 'and the unusable range is still taken away');

    // Clearing the profile gives the range back. Without this the operator is locked above 20s with
    // no way down through the control, while the setter would happily accept 5.
    runtime.applyReadingPaceProfile('', null);
    assert.equal(elements.summaryIntervalInput.min, '2', 'no measurement, no floor');
    runtime.setSummaryInterval(5);
    assert.equal(ctx.state.summaryIntervalSeconds, 5);
  });
});
