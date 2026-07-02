import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds,
  summaryIntervalSecondsFromSliderIndex
} from '../services/view-settings.js';
import { bindRangeSlider } from './range-slider.js';
import {
  bindRailResize,
  loadRailWidth
} from './rail-resize.js';
import {
  bindRailCollapse,
  loadRailCollapsed
} from './rail-collapse.js';
import {
  renderDisplay,
  bindTranscriptViewport,
  setSettingsOpen,
  setSettingsSection,
  setViewPanelOpen,
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
  transcriptionSource: 'transcriptionSource',
  summarizationSource: 'summarizationSource'
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
      displayMarginGuidesVisible: false,
      displayMarginAdjusting: false,
      transcriptChunks: [],
      transcriptPreview: '',
      listening: false,
      loopHandle: null,
      lastSentText: '',
      stickToBottom: true,
      prefersReducedMotion: Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
      settingsOpen: false,
      viewPanelOpen: false,
      viewPanelCloseHandle: null,
      panelOpen: false,
      pendingProviderSelection: null,
      registrationProvider: 'openai',
      transcriptionSource: localStorage.getItem(STORAGE.transcriptionSource) || 'browser',
      summarizationSource: localStorage.getItem(STORAGE.summarizationSource) || 'openai',
      openAiReady: false,
      anthropicReady: false,
      serverOpenAiReady: false,
      serverAnthropicReady: false,
      providerKeys: {}
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
      liveTranscript: $('liveTranscript'),
      railTranscript: $('railTranscript'),
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
      displayMarginInput: $('displayMargin'),
      displayMarginValue: $('displayMarginValue'),
      summaryIntervalInput: $('summaryInterval'),
      summaryIntervalValue: $('summaryIntervalValue'),
      viewPanel: $('viewPanel'),
      viewButton: $('viewButton'),
      closeViewPanel: $('closeViewPanel'),
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

  const runtime = createRuntime(ctx);

  function bindEvents() {
    bindTranscriptViewport(ctx);
    bindManualEntry(ctx, runtime);
    bindTranscriptSummaries(ctx, runtime);
    bindControlButtons(ctx, runtime);
    bindViewerControls(ctx, runtime);
    bindRailResize(ctx);
    bindRailCollapse(ctx);
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
  ctx.dom.settingsButton.addEventListener('click', () => runtime.toggleSettingsOpen());
  ctx.dom.closeSettings.addEventListener('click', () => runtime.setSettingsOpen(false, { focusReturn: true }));
  ctx.dom.settingsPanel?.addEventListener('close', () => runtime.setSettingsOpen(false, { focusReturn: true }));
  ctx.dom.settingsPanel?.addEventListener('click', (event) => {
    if (event.target !== ctx.dom.settingsPanel) return;
    runtime.setSettingsOpen(false, { focusReturn: true });
  });
}

function bindViewerControls(ctx, runtime) {
  ctx.dom.fontSizeInput.addEventListener('input', (e) => runtime.setFontSize(e.target.value));
  ctx.dom.displayMarginInput.addEventListener('input', (e) => runtime.setDisplayMargin(e.target.value));
  ctx.dom.summaryIntervalInput.addEventListener('input', (e) => {
    runtime.setSummaryInterval(summaryIntervalSecondsFromSliderIndex(e.target.value, ctx.state.summaryIntervalSeconds));
  });
  bindRangeSlider(ctx.dom.fontSizeInput, (value) => runtime.setFontSize(value));
  bindRangeSlider(ctx.dom.displayMarginInput, (value) => runtime.setDisplayMargin(value), {
    onDragStart: () => {
      document.documentElement.classList.add('is-adjusting-display-margin');
      runtime.beginDisplayMarginAdjustment();
    },
    onDragEnd: () => {
      document.documentElement.classList.remove('is-adjusting-display-margin');
      runtime.endDisplayMarginAdjustment();
    }
  });
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
