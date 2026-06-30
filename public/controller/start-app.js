import { clampDisplayMargin, clampFontSize, clampSummaryIntervalSeconds } from '../services/view-settings.js';
import { renderDisplay, setPanelOpen, syncViewerControls, updateModeButtons, updatePauseButton, updateSourceButtons } from './view.js';
import { createRuntime } from './runtime.js';

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
      lines: [],
      mode: 'speaker',
      paused: false,
      fontSize: clampFontSize(localStorage.getItem(STORAGE.fontSize) || 84),
      displayMargin: clampDisplayMargin(localStorage.getItem(STORAGE.displayMargin) || 4.5),
      summaryIntervalSeconds: clampSummaryIntervalSeconds(localStorage.getItem(STORAGE.summaryInterval) || 5),
      transcriptChunks: [],
      transcriptPreview: '',
      listening: false,
      loopHandle: null,
      lastSentText: '',
      panelOpen: true,
      transcriptionSource: localStorage.getItem(STORAGE.transcriptionSource) || 'browser',
      summarizationSource: localStorage.getItem(STORAGE.summarizationSource) || 'openai',
      openAiReady: false,
      anthropicReady: false
    },
    dom: {
      display: $('display'),
      panel: $('panel'),
      apiWarning: $('apiWarning'),
      manualInput: $('manualInput'),
      pasteTranscript: $('pasteTranscript'),
      status: $('status'),
      liveTranscript: $('liveTranscript'),
      line1: $('line1'),
      line2: $('line2'),
      line3: $('line3'),
      line4: $('line4'),
      line5: $('line5'),
      fontSizeInput: $('fontSize'),
      fontSizeValue: $('fontSizeValue'),
      displayMarginInput: $('displayMargin'),
      displayMarginValue: $('displayMarginValue'),
      pauseAi: $('pauseAi'),
      startListening: $('startListening'),
      stopListening: $('stopListening'),
      modeButtons: Array.from(document.querySelectorAll('.mode')),
      transcriptionButtons: Array.from(document.querySelectorAll('[data-kind="transcription"]')),
      summarizationButtons: Array.from(document.querySelectorAll('[data-kind="summarization"]')),
      intervalButtons: Array.from(document.querySelectorAll('[data-interval]'))
    }
  };

  const runtime = createRuntime(ctx);

  function bindEvents() {
    bindManualEntry(ctx, runtime);
    bindTranscriptSummaries(ctx, runtime);
    bindControlButtons(ctx, runtime);
    bindViewerControls(ctx, runtime);
    bindModeAndSourceButtons(ctx, runtime);
    bindKeyboardShortcuts(ctx, runtime);
  }

  bindEvents();
  updateModeButtons(ctx);
  updateSourceButtons(ctx);
  updatePauseButton(ctx);
  syncViewerControls(ctx);
  runtime.saveViewerSettings();
  setPanelOpen(ctx, true);
  renderDisplay(ctx);
  runtime.showRecentTranscript();
  runtime.loadRuntimeConfig();
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
  $('bigger').addEventListener('click', () => runtime.setFontSize(ctx.state.fontSize + 8));
  $('smaller').addEventListener('click', () => runtime.setFontSize(ctx.state.fontSize - 8));
  $('fullscreen').addEventListener('click', () => document.documentElement.requestFullscreen?.());
  $('hidePanel').addEventListener('click', () => runtime.setPanelOpen(false));
}

function bindViewerControls(ctx, runtime) {
  ctx.dom.fontSizeInput.addEventListener('input', (e) => runtime.setFontSize(e.target.value));
  ctx.dom.displayMarginInput.addEventListener('input', (e) => runtime.setDisplayMargin(e.target.value));
}

function bindModeAndSourceButtons(ctx, runtime) {
  ctx.dom.modeButtons.forEach((btn) => btn.addEventListener('click', () => runtime.setMode(btn.dataset.mode)));
  ctx.dom.transcriptionButtons.forEach((btn) => btn.addEventListener('click', () => runtime.setTranscriptionSource(btn.dataset.source)));
  ctx.dom.summarizationButtons.forEach((btn) => btn.addEventListener('click', () => runtime.setSummarizationSource(btn.dataset.source)));
  ctx.dom.intervalButtons.forEach((btn) => btn.addEventListener('click', () => runtime.setSummaryInterval(Number(btn.dataset.interval))));
}

function bindKeyboardShortcuts(ctx, runtime) {
  document.addEventListener('keydown', (e) => {
    if (runtime.isTypingTarget(e.target) && !((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
      return;
    }

    const key = e.key.toLowerCase();
    if (key === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      runtime.setPanelOpen(!ctx.state.panelOpen, { focusInput: !ctx.state.panelOpen });
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      runtime.setPanelOpen(true, { focusInput: true });
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

    if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      $('bigger').click();
      return;
    }

    if (e.key === '-' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      $('smaller').click();
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
