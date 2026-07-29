import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds,
  clampSummaryMaxWords,
  summaryMaxWordsFromSliderIndex,
  fontSizeFromSliderPosition,
  clampAudioProcessingPreset,
  clampAudioHighPassHz,
  clampAudioBoolean,
  AUDIO_SETTINGS_DEFAULTS
} from '../services/view-settings.js';
import {
  bindRailResize,
  loadRailWidth
} from './rail-resize.js';
import {
  bindRailCollapse,
  loadRailCollapsed
} from './rail-collapse.js';
import { bindQuickPanelSheet, loadQuickPanelSnap } from './quick-panel-sheet.js';
import { applyPersistedTranscriptHeight, bindTranscriptResize } from './transcript-resize.js';
import {
  renderDisplay,
  bindTranscriptViewport,
  setSettingsOpen,
  setSettingsSection,
  setViewPanelOpen,
  setQuickPanelOpen,
  syncViewerControls,
  updateModeButtons,
  updatePauseButton,
  updateSourceButtons
} from './view.js';
import { createRuntime } from './runtime.js';
import { isDemoModeEnabled, startDemoFeed } from './demo-feed.js';

const STORAGE = {
  fontSize: 'fontSize',
  displayMargin: 'displayMargin',
  summaryInterval: 'summaryIntervalSeconds',
  summaryMaxWords: 'summaryMaxWords',
  transcriptionSource: 'transcriptionSource',
  summarizationSource: 'summarizationSource',
  summarizationSourceChosen: 'summarizationSourceChosen',
  // Must stay in sync with runtime.js's own STORAGE map -- see the gotcha recorded there. Add a
  // key to BOTH maps or neither.
  audioProcessingPreset: 'audioProcessingPreset',
  audioHighPassEnabled: 'audioHighPassEnabled',
  audioHighPassHz: 'audioHighPassHz',
  audioCompressorEnabled: 'audioCompressorEnabled',
  audioLimiterEnabled: 'audioLimiterEnabled',
  audioBrowserAgc: 'audioBrowserAgc',
  audioBrowserNoiseSuppression: 'audioBrowserNoiseSuppression',
  audioBrowserEchoCancel: 'audioBrowserEchoCancel',
  audioBypassForTest: 'audioBypassForTest'
};

export function startApp() {
  const ctx = {
    state: {
      transcriptItems: [],
      clearArmed: false,
      lastClearedItems: null,
      mode: 'speaker',
      paused: false,
      fontSize: clampFontSize(localStorage.getItem(STORAGE.fontSize) || 84),
      displayMargin: clampDisplayMargin(localStorage.getItem(STORAGE.displayMargin) || 4.5),
      operatorRailWidth: loadRailWidth(localStorage),
      railCollapsed: loadRailCollapsed(localStorage),
      summaryIntervalSeconds: clampSummaryIntervalSeconds(localStorage.getItem(STORAGE.summaryInterval) || 5),
      summaryMaxWords: clampSummaryMaxWords(localStorage.getItem(STORAGE.summaryMaxWords) || 14),
      displayMarginGuidesVisible: false,
      displayMarginAdjusting: false,
      transcriptChunks: [],
      transcriptPreview: '',
      inFlightChunks: [],
      listening: false,
      loopHandle: null,
      lastSentText: '',
      lastSentBlock: null,
      stickToBottom: true,
      prefersReducedMotion: Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
      settingsOpen: false,
      viewPanelOpen: false,
      viewPanelCloseHandle: null,
      quickPanelOpen: false,
      quickPanelCloseHandle: null,
      quickPanelSnap: loadQuickPanelSnap(),
      panelOpen: false,
      pendingProviderSelection: null,
      registrationProvider: 'openai',
      transcriptionSource: localStorage.getItem(STORAGE.transcriptionSource) || 'browser',
      summarizationSource: localStorage.getItem(STORAGE.summarizationSource) || 'openai',
      summarizationSourceChosen: localStorage.getItem(STORAGE.summarizationSourceChosen) === 'true',
      openAiReady: false,
      anthropicReady: false,
      serverOpenAiReady: false,
      serverAnthropicReady: false,
      providerKeys: {},
      audioProcessingPreset: clampAudioProcessingPreset(localStorage.getItem(STORAGE.audioProcessingPreset), AUDIO_SETTINGS_DEFAULTS.audioProcessingPreset),
      audioHighPassEnabled: clampAudioBoolean(localStorage.getItem(STORAGE.audioHighPassEnabled), AUDIO_SETTINGS_DEFAULTS.audioHighPassEnabled),
      audioHighPassHz: clampAudioHighPassHz(localStorage.getItem(STORAGE.audioHighPassHz), AUDIO_SETTINGS_DEFAULTS.audioHighPassHz),
      audioCompressorEnabled: clampAudioBoolean(localStorage.getItem(STORAGE.audioCompressorEnabled), AUDIO_SETTINGS_DEFAULTS.audioCompressorEnabled),
      audioLimiterEnabled: clampAudioBoolean(localStorage.getItem(STORAGE.audioLimiterEnabled), AUDIO_SETTINGS_DEFAULTS.audioLimiterEnabled),
      audioBrowserAgc: clampAudioBoolean(localStorage.getItem(STORAGE.audioBrowserAgc), AUDIO_SETTINGS_DEFAULTS.audioBrowserAgc),
      audioBrowserNoiseSuppression: clampAudioBoolean(localStorage.getItem(STORAGE.audioBrowserNoiseSuppression), AUDIO_SETTINGS_DEFAULTS.audioBrowserNoiseSuppression),
      audioBrowserEchoCancel: clampAudioBoolean(localStorage.getItem(STORAGE.audioBrowserEchoCancel), AUDIO_SETTINGS_DEFAULTS.audioBrowserEchoCancel),
      audioBypassForTest: clampAudioBoolean(localStorage.getItem(STORAGE.audioBypassForTest), AUDIO_SETTINGS_DEFAULTS.audioBypassForTest)
    },
    dom: {
      display: $('display'),
      transcriptViewport: $('transcriptViewport'),
      transcriptStack: $('transcriptStack'),
      panel: $('panel'),
      railResizeHandle: $('railResizeHandle'),
      railCollapseToggle: $('railCollapseToggle'),
      manualInput: $('manualInput'),
      pasteTranscript: $('pasteTranscript'),
      status: $('status'),
      railStatus: $('railStatus'),
      railStatusDot: $('railStatusDot'),
      railStatusWord: $('railStatusWord'),
      railNote: $('railNote'),
      liveTranscript: $('liveTranscript'),
      railTranscript: $('railTranscript'),
      railTranscriptProgress: $('railTranscriptProgress'),
      railTranscriptProgressFill: $('railTranscriptProgressFill'),
      readyCheckMicDot: $('readyCheckMicDot'),
      readyCheckMicFix: $('readyCheckMicFix'),
      readyCheckAiDot: $('readyCheckAiDot'),
      readyCheckAiFix: $('readyCheckAiFix'),
      readyCheckAiTest: $('readyCheckAiTest'),
      readyCheckDisplayDot: $('readyCheckDisplayDot'),
      readyCheckDisplayFix: $('readyCheckDisplayFix'),
      readyCheckDisplaySample: $('readyCheckDisplaySample'),
      fontSizeInput: $('fontSize'),
      fontSizeValue: $('fontSizeValue'),
      fontSizeField: $('fontSizeField'),
      displayMarginInput: $('displayMargin'),
      displayMarginValue: $('displayMarginValue'),
      displayMarginField: $('displayMarginField'),
      summaryIntervalInput: $('summaryInterval'),
      summaryIntervalValue: $('summaryIntervalValue'),
      summaryIntervalField: $('summaryIntervalField'),
      summaryMaxWordsInput: $('summaryMaxWords'),
      summaryMaxWordsValue: $('summaryMaxWordsValue'),
      summaryMaxWordsField: $('summaryMaxWordsField'),
      viewPanel: $('viewPanel'),
      viewButton: $('viewButton'),
      closeViewPanel: $('closeViewPanel'),
      quickPanel: $('quickPanel'),
      quickPanelToggle: $('quickPanelToggle'),
      quickPanelBackdrop: $('quickPanelBackdrop'),
      quickPanelHandle: $('quickPanelHandle'),
      quickPanelScroll: $('quickPanelScroll'),
      quickControlsSection: $('quickControlsSection'),
      railTranscriptSection: $('railTranscriptSection'),
      settingsPanel: $('settingsPanel'),
      settingsBackdrop: $('settingsBackdrop'),
      settingsBody: $('settingsBody'),
      settingsButton: $('settingsButton'),
      settingsAlertBadge: $('settingsAlertBadge'),
      closeSettings: $('closeSettings'),
      alertsSection: $('alertsSection'),
      apiWarning: $('apiWarning'),
      serviceRegistrationOpenAi: $('serviceRegistrationOpenAi'),
      serviceRegistrationClaude: $('serviceRegistrationClaude'),
      serviceRegistrationTitle: $('serviceRegistrationTitle'),
      serviceRegistrationDescription: $('serviceRegistrationDescription'),
      serviceRegistrationState: $('serviceRegistrationState'),
      serviceRegistrationMasked: $('serviceRegistrationMasked'),
      serviceRegistrationKeyInput: $('serviceRegistrationKeyInput'),
      serviceRegistrationSave: $('serviceRegistrationSave'),
      serviceRegistrationTest: $('serviceRegistrationTest'),
      serviceRegistrationDelete: $('serviceRegistrationDelete'),
      serviceRegistrationOpenAiStatus: $('serviceRegistrationOpenAiStatus'),
      serviceRegistrationClaudeStatus: $('serviceRegistrationClaudeStatus'),
      serviceRegistrationHint: $('serviceRegistrationHint'),
      transcriptionBrowser: $('transcriptionBrowser'),
      transcriptionOpenAi: $('transcriptionOpenAi'),
      summaryOpenAi: $('summaryOpenAi'),
      summaryClaude: $('summaryClaude'),
      transcriptionHint: $('transcriptionHint'),
      summaryHint: $('summaryHint'),
      pauseAi: $('pauseAi'),
      pauseAiLabel: $('pauseAiLabel'),
      undo: $('undo'),
      clear: $('clear'),
      clearLabel: $('clearLabel'),
      startListening: $('startListening'),
      stopListening: $('stopListening'),
      fullscreen: $('fullscreen'),
      modeButtons: Array.from(document.querySelectorAll('.mode')),
      transcriptionButtons: Array.from(document.querySelectorAll('[data-kind="transcription"]')),
      summarizationButtons: Array.from(document.querySelectorAll('[data-kind="summarization"]')),
      settingsNavButtons: Array.from(document.querySelectorAll('[data-settings-nav]')),
      settingsSections: Array.from(document.querySelectorAll('[data-settings-section]'))
    }
  };

  applyPersistedTranscriptHeight(ctx);

  const runtime = createRuntime(ctx);

  function bindEvents() {
    bindTranscriptViewport(ctx);
    bindManualEntry(ctx, runtime);
    bindTranscriptSummaries(ctx, runtime);
    bindControlButtons(ctx, runtime);
    bindViewerControls(ctx, runtime);
    bindRailResize(ctx);
    bindRailCollapse(ctx);
    bindQuickPanelSheet(ctx);
    bindTranscriptResize(ctx);
    bindModeAndSourceButtons(ctx, runtime);
    bindServiceRegistrationControls(ctx, runtime);
    bindSettingsNav(ctx);
    bindReadyCheck(ctx, runtime);
    bindKeyboardShortcuts(ctx, runtime);
  }

  bindEvents();
  updateModeButtons(ctx);
  updateSourceButtons(ctx);
  updatePauseButton(ctx);
  syncViewerControls(ctx);
  runtime.saveViewerSettings();
  setSettingsOpen(ctx, false);
  renderDisplay(ctx);
  runtime.showRecentTranscript();
  const runtimeConfig = runtime.loadRuntimeConfig();
  if (isDemoModeEnabled(globalThis.location?.search)) {
    runtimeConfig.finally?.(() => {
      startDemoFeed(runtime);
    });
  }
  const ticker = setInterval(runtime.showRecentTranscript, 1000);
  ticker.unref?.();
  setViewPanelOpen(ctx, false);
  setQuickPanelOpen(ctx, false);
}

function bindManualEntry(ctx, runtime) {
  const submitManualLine = () => {
    if (!runtime.addLine(ctx.dom.manualInput.value)) return;
    ctx.dom.manualInput.value = '';
    ctx.dom.manualInput.focus();
  };

  $('addManual').addEventListener('click', submitManualLine);
  ctx.dom.manualInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submitManualLine();
  });
}

function bindTranscriptSummaries(ctx, runtime) {
  ctx.dom.pasteTranscript.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
    e.preventDefault();
    runtime.summarizeCurrentText(ctx.dom.pasteTranscript.value);
  });

  $('summarizeOnce').addEventListener('click', () => runtime.summarizeCurrentText(ctx.dom.pasteTranscript.value));
}

function bindControlButtons(ctx, runtime) {
  ctx.dom.startListening.addEventListener('click', runtime.startListening);
  ctx.dom.stopListening.addEventListener('click', runtime.stopListening);
  ctx.dom.pauseAi.addEventListener('click', runtime.togglePauseAi);
  ctx.dom.undo.addEventListener('click', runtime.undoLine);
  ctx.dom.clear.addEventListener('click', runtime.clearLines);
  ctx.dom.clear.addEventListener('blur', runtime.cancelClearArm);
  const fullscreenButton = ctx.dom.fullscreen || $('fullscreen');
  const syncFullscreenButton = () => {
    const active = Boolean(document.fullscreenElement);
    const label = active ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton?.setAttribute('aria-pressed', String(active));
    fullscreenButton?.setAttribute('aria-label', label);
    if (fullscreenButton) {
      fullscreenButton.title = label;
    }
  };
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    await document.documentElement.requestFullscreen?.();
  };
  fullscreenButton?.addEventListener('click', () => {
    toggleFullscreen().catch((error) => updateStatus(ctx, `Fullscreen failed: ${error.message}`));
  });
  document.addEventListener?.('fullscreenchange', syncFullscreenButton);
  syncFullscreenButton();
  ctx.dom.viewButton.addEventListener('click', () => setViewPanelOpen(ctx, !ctx.state.viewPanelOpen, { focusReturn: false }));
  ctx.dom.closeViewPanel.addEventListener('click', () => setViewPanelOpen(ctx, false, { focusReturn: true }));
  ctx.dom.quickPanelToggle?.addEventListener('click', () => setQuickPanelOpen(ctx, !ctx.state.quickPanelOpen, { focusReturn: false }));
  ctx.dom.quickPanelBackdrop?.addEventListener('click', () => setQuickPanelOpen(ctx, false, { focusReturn: true }));
  ctx.dom.settingsButton.addEventListener('click', () => runtime.toggleSettingsOpen());
  ctx.dom.closeSettings.addEventListener('click', () => runtime.setSettingsOpen(false, { focusReturn: true }));
  ctx.dom.settingsPanel?.addEventListener('close', () => runtime.setSettingsOpen(false, { focusReturn: true }));
  ctx.dom.settingsPanel?.addEventListener('click', (event) => {
    if (event.target !== ctx.dom.settingsPanel) return;
    runtime.setSettingsOpen(false, { focusReturn: true });
  });
}

function beginSliderAdjustment(fieldEl) {
  fieldEl?.closest?.('.viewDrawerBody, .settingsCard, .settingsDetail')?.classList.add('is-adjusting-slider');
  // The viewer drawer (Text size / Margins) sits directly over the TV
  // canvas -- while dragging either of those, fade the drawer's own
  // shell (not just its sibling fields) so the canvas underneath is
  // fully visible, with only the active slider still showing clearly.
  fieldEl?.closest?.('.viewDrawerShell')?.classList.add('is-adjusting-slider-shell');
  fieldEl?.classList.add('is-active-slider-field');
}

function endSliderAdjustment(fieldEl) {
  fieldEl?.closest?.('.viewDrawerBody, .settingsCard, .settingsDetail')?.classList.remove('is-adjusting-slider');
  fieldEl?.closest?.('.viewDrawerShell')?.classList.remove('is-adjusting-slider-shell');
  fieldEl?.classList.remove('is-active-slider-field');
}

function bindDragFade(input, fieldEl, { onDragStart = () => {}, onDragEnd = () => {} } = {}) {
  if (!input) return;
  const start = () => {
    beginSliderAdjustment(fieldEl);
    onDragStart();
  };
  const end = () => {
    endSliderAdjustment(fieldEl);
    onDragEnd();
  };
  input.addEventListener('pointerdown', start);
  input.addEventListener('pointerup', end);
  input.addEventListener('pointercancel', end);
  input.addEventListener('blur', end);
  input.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      start();
      globalThis.requestAnimationFrame?.(end) ?? end();
    }
  });
}

function bindViewerControls(ctx, runtime) {
  ctx.dom.fontSizeInput.addEventListener('input', (e) => {
    runtime.setFontSize(fontSizeFromSliderPosition(e.target.value, ctx.state.fontSize));
  });
  ctx.dom.displayMarginInput.addEventListener('input', (e) => runtime.setDisplayMargin(e.target.value));
  ctx.dom.summaryIntervalInput.addEventListener('input', (e) => {
    runtime.setSummaryInterval(e.target.value);
  });
  ctx.dom.summaryMaxWordsInput.addEventListener('input', (e) => {
    runtime.setSummaryMaxWords(summaryMaxWordsFromSliderIndex(e.target.value, ctx.state.summaryMaxWords));
  });

  bindDragFade(ctx.dom.fontSizeInput, ctx.dom.fontSizeField);

  bindDragFade(ctx.dom.displayMarginInput, ctx.dom.displayMarginField, {
    onDragStart: () => {
      document.documentElement.classList.add('is-adjusting-display-margin');
      runtime.beginDisplayMarginAdjustment();
    },
    onDragEnd: () => {
      document.documentElement.classList.remove('is-adjusting-display-margin');
      runtime.endDisplayMarginAdjustment();
    }
  });

  bindDragFade(ctx.dom.summaryIntervalInput, ctx.dom.summaryIntervalField);
  bindDragFade(ctx.dom.summaryMaxWordsInput, ctx.dom.summaryMaxWordsField);
}

function bindModeAndSourceButtons(ctx, runtime) {
  ctx.dom.modeButtons.forEach((btn) => btn.addEventListener('click', () => runtime.setMode(btn.dataset.mode)));
  ctx.dom.transcriptionButtons.forEach((btn) => btn.addEventListener('click', () => handleSourceSelection(ctx, runtime, btn)));
  ctx.dom.summarizationButtons.forEach((btn) => btn.addEventListener('click', () => handleSourceSelection(ctx, runtime, btn)));
}

function bindSettingsNav(ctx) {
  (ctx.dom.settingsNavButtons || []).forEach((btn) => {
    btn.addEventListener('click', () => setSettingsSection(ctx, btn.dataset.settingsNav));
  });
}

function bindReadyCheck(ctx, runtime) {
  ctx.dom.readyCheckAiTest?.addEventListener('click', () => {
    const provider = ctx.state.summarizationSource === 'claude' ? 'claude' : 'openai';
    runtime.testProviderKey(provider);
  });

  ctx.dom.readyCheckDisplaySample?.addEventListener('click', () => {
    runtime.setSettingsOpen(false);
    setViewPanelOpen(ctx, true);
  });
}

function bindServiceRegistrationControls(ctx, runtime) {
  const buttons = [
    ctx.dom.serviceRegistrationOpenAi,
    ctx.dom.serviceRegistrationClaude
  ].filter(Boolean);

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      runtime.setRegistrationProvider(btn.dataset.registerProvider);
    });
  });

  const input = ctx.dom.serviceRegistrationKeyInput;
  const save = ctx.dom.serviceRegistrationSave;
  const test = ctx.dom.serviceRegistrationTest;
  const remove = ctx.dom.serviceRegistrationDelete;

  save?.addEventListener('click', () => {
    runtime.saveProviderKey(ctx.state.registrationProvider || 'openai', input?.value || '')
      .then(() => {
        clearServiceRegistrationInput(ctx);
      })
      .catch((error) => {
        runtime.setSettingsOpen(true);
        $('status').textContent = error.message;
      });
  });

  test?.addEventListener('click', () => runtime.testProviderKey(ctx.state.registrationProvider || 'openai', input?.value || '').catch((error) => {
    $('status').textContent = error.message;
  }));
  remove?.addEventListener('click', () => {
    runtime.deleteProviderKey(ctx.state.registrationProvider || 'openai')
      .then(() => {
        clearServiceRegistrationInput(ctx);
      })
      .catch((error) => {
        $('status').textContent = error.message;
      });
  });

  input?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    runtime.saveProviderKey(ctx.state.registrationProvider || 'openai', input.value || '')
      .then(() => {
        input.value = '';
      })
      .catch((error) => {
        $('status').textContent = error.message;
      });
  });
}

function clearServiceRegistrationInput(ctx) {
  if (ctx.dom.serviceRegistrationKeyInput) {
    ctx.dom.serviceRegistrationKeyInput.value = '';
  }
}

function handleSourceSelection(ctx, runtime, button) {
  const { kind, source } = button.dataset;
  if (!kind || !source) return;
  if (!runtime.isSourceConfigured(kind, source)) {
    runtime.promptProviderSetup(kind, source);
    return;
  }

  if (kind === 'transcription') {
    runtime.setTranscriptionSource(source);
  } else {
    runtime.setSummarizationSource(source);
  }
}

function bindKeyboardShortcuts(ctx, runtime) {
  document.addEventListener('keydown', (e) => {
    if (runtime.isTypingTarget(e.target) && !((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
      return;
    }

    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (ctx.state.viewPanelOpen) {
        e.preventDefault();
        setViewPanelOpen(ctx, false, { focusReturn: true });
        return;
      }
      if (ctx.state.quickPanelOpen) {
        e.preventDefault();
        setQuickPanelOpen(ctx, false, { focusReturn: true });
        return;
      }
      if (ctx.state.settingsOpen) {
        e.preventDefault();
        runtime.setSettingsOpen(false, { focusReturn: true });
        return;
      }
      if (ctx.state.clearArmed) {
        e.preventDefault();
        runtime.cancelClearArm();
      }
      return;
    }

    if (key === 'u' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      runtime.undoLine();
      return;
    }

    if (key === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      ctx.dom.pauseAi.click();
      return;
    }

    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      ctx.dom.manualInput.focus();
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '1') runtime.setMode('speaker');
    if (e.key === '2') runtime.setMode('information');
    if (e.key === '3') runtime.setMode('song');
    if (e.key === '4') runtime.setMode('prayer');
  });
}

function $(id) {
  return document.getElementById(id);
}
