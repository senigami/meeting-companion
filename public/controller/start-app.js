import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds,
  summaryIntervalSecondsFromSliderIndex
} from '../services/view-settings.js';
import {
  renderDisplay,
  bindTranscriptViewport,
  setSettingsOpen,
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
      mode: 'speaker',
      paused: false,
      fontSize: clampFontSize(localStorage.getItem(STORAGE.fontSize) || 84),
      displayMargin: clampDisplayMargin(localStorage.getItem(STORAGE.displayMargin) || 4.5),
      summaryIntervalSeconds: clampSummaryIntervalSeconds(localStorage.getItem(STORAGE.summaryInterval) || 5),
      displayMarginGuidesVisible: false,
      transcriptChunks: [],
      transcriptPreview: '',
      listening: false,
      loopHandle: null,
      lastSentText: '',
      stickToBottom: true,
      prefersReducedMotion: Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
      settingsOpen: false,
      panelOpen: false,
      pendingProviderSelection: null,
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
      manualInput: $('manualInput'),
      pasteTranscript: $('pasteTranscript'),
      status: $('status'),
      liveTranscript: $('liveTranscript'),
      railTranscript: $('railTranscript'),
      fontSizeInput: $('fontSize'),
      fontSizeValue: $('fontSizeValue'),
      displayMarginInput: $('displayMargin'),
      displayMarginValue: $('displayMarginValue'),
      summaryIntervalInput: $('summaryInterval'),
      summaryIntervalValue: $('summaryIntervalValue'),
      settingsPanel: $('settingsPanel'),
      settingsBackdrop: $('settingsBackdrop'),
      settingsBody: $('settingsBody'),
      alertButton: $('alertButton'),
      settingsButton: $('settingsButton'),
      closeSettings: $('closeSettings'),
      alertsSection: $('alertsSection'),
      apiWarning: $('apiWarning'),
      transcriptionBrowser: $('transcriptionBrowser'),
      transcriptionOpenAi: $('transcriptionOpenAi'),
      summaryOpenAi: $('summaryOpenAi'),
      summaryClaude: $('summaryClaude'),
      transcriptionHint: $('transcriptionHint'),
      summaryHint: $('summaryHint'),
      openaiKeyDescription: $('openaiKeyDescription'),
      openaiKeyState: $('openaiKeyState'),
      openaiKeyMasked: $('openaiKeyMasked'),
      openaiKeyInput: $('openaiKeyInput'),
      openaiKeySave: $('openaiKeySave'),
      openaiKeyTest: $('openaiKeyTest'),
      openaiKeyDelete: $('openaiKeyDelete'),
      claudeKeyDescription: $('claudeKeyDescription'),
      claudeKeyState: $('claudeKeyState'),
      claudeKeyMasked: $('claudeKeyMasked'),
      claudeKeyInput: $('claudeKeyInput'),
      claudeKeySave: $('claudeKeySave'),
      claudeKeyTest: $('claudeKeyTest'),
      claudeKeyDelete: $('claudeKeyDelete'),
      pauseAi: $('pauseAi'),
      pauseAiLabel: $('pauseAiLabel'),
      startListening: $('startListening'),
      stopListening: $('stopListening'),
      modeButtons: Array.from(document.querySelectorAll('.mode')),
      transcriptionButtons: Array.from(document.querySelectorAll('[data-kind="transcription"]')),
      summarizationButtons: Array.from(document.querySelectorAll('[data-kind="summarization"]'))
    }
  };

  const runtime = createRuntime(ctx);

  function bindEvents() {
    bindTranscriptViewport(ctx);
    bindManualEntry(ctx, runtime);
    bindTranscriptSummaries(ctx, runtime);
    bindControlButtons(ctx, runtime);
    bindViewerControls(ctx, runtime);
    bindModeAndSourceButtons(ctx, runtime);
    bindProviderKeyControls(ctx, runtime);
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
}

function bindManualEntry(ctx, runtime) {
  $('addManual').addEventListener('click', () => runtime.addLine(ctx.dom.manualInput.value));
  ctx.dom.manualInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    runtime.addLine(ctx.dom.manualInput.value);
    ctx.dom.manualInput.value = '';
    ctx.dom.manualInput.focus();
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
  $('undo').addEventListener('click', runtime.undoLine);
  $('clear').addEventListener('click', runtime.clearLines);
  $('fullscreen').addEventListener('click', () => document.documentElement.requestFullscreen?.());
  ctx.dom.settingsButton.addEventListener('click', () => runtime.toggleSettingsOpen());
  ctx.dom.alertButton?.addEventListener('click', () => runtime.setSettingsOpen(true));
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
}

function bindModeAndSourceButtons(ctx, runtime) {
  ctx.dom.modeButtons.forEach((btn) => btn.addEventListener('click', () => runtime.setMode(btn.dataset.mode)));
  ctx.dom.transcriptionButtons.forEach((btn) => btn.addEventListener('click', () => handleSourceSelection(ctx, runtime, btn)));
  ctx.dom.summarizationButtons.forEach((btn) => btn.addEventListener('click', () => handleSourceSelection(ctx, runtime, btn)));
}

function bindProviderKeyControls(ctx, runtime) {
  wireProviderActions(ctx, runtime, 'openai');
  wireProviderActions(ctx, runtime, 'claude');
}

function wireProviderActions(ctx, runtime, provider) {
  const prefix = provider === 'openai' ? 'openai' : 'claude';
  const input = ctx.dom[`${prefix}KeyInput`];
  const save = ctx.dom[`${prefix}KeySave`];
  const test = ctx.dom[`${prefix}KeyTest`];
  const remove = ctx.dom[`${prefix}KeyDelete`];

  save?.addEventListener('click', () => {
    runtime.saveProviderKey(provider, input?.value || '')
      .then(() => {
        if (input) input.value = '';
      })
      .catch((error) => {
        runtime.setSettingsOpen(true);
        $('status').textContent = error.message;
      });
  });

  test?.addEventListener('click', () => runtime.testProviderKey(provider, input?.value || '').catch((error) => {
    $('status').textContent = error.message;
  }));
  remove?.addEventListener('click', () => {
    runtime.deleteProviderKey(provider)
      .then(() => {
        if (input) input.value = '';
      })
      .catch((error) => {
        $('status').textContent = error.message;
      });
  });

  input?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    runtime.saveProviderKey(provider, input.value || '')
      .then(() => {
        input.value = '';
      })
      .catch((error) => {
        $('status').textContent = error.message;
      });
  });
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
      if (ctx.state.settingsOpen) {
        e.preventDefault();
        runtime.setSettingsOpen(false, { focusReturn: true });
      }
      return;
    }

    if (key === 'u' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      runtime.undoLine();
      return;
    }

    if (key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      runtime.clearLines();
      return;
    }

    if (key === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      ctx.dom.pauseAi.click();
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
