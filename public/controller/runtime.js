import { appendUniqueChunk, normalizeText } from '../services/text.js';
import { createSummarizationDriver, createTranscriptionDriver, listAvailableSources } from '../services/registry.js';
import { getDefaultSummarizationSource, getDefaultTranscriptionSource } from '../services/catalog.js';
import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds
} from '../services/view-settings.js';
import {
  applyViewerSettings,
  renderDisplay,
  setPanelOpen,
  updateModeButtons,
  updatePauseButton,
  updateSourceButtons,
  updateStatus,
  syncViewerControls,
  updateIntervalButtons
} from './view.js';

const STORAGE = {
  fontSize: 'fontSize',
  displayMargin: 'displayMargin',
  summaryInterval: 'summaryIntervalSeconds',
  transcriptionSource: 'transcriptionSource',
  summarizationSource: 'summarizationSource'
};

export function createRuntime(ctx) {
  let transcriptionDriver = null;
  let summarizationDriver = null;

  function saveViewerSettings() {
    applyViewerSettings(ctx);
    localStorage.setItem(STORAGE.fontSize, String(ctx.state.fontSize));
    localStorage.setItem(STORAGE.displayMargin, String(ctx.state.displayMargin));
  }

  function addLine(line) {
    const clean = normalizeText(line);
    if (!clean) return;
    const last = ctx.state.lines[ctx.state.lines.length - 1] || '';
    if (normalizeText(last).toLowerCase() === clean.toLowerCase()) return;
    ctx.state.lines.push(clean);
    ctx.state.lines = ctx.state.lines.slice(-20);
    renderDisplay(ctx);
  }

  function undoLine() {
    ctx.state.lines.pop();
    renderDisplay(ctx);
  }

  function clearLines() {
    ctx.state.lines = [];
    renderDisplay(ctx);
  }

  function recentTranscript(seconds = 30) {
    const pruneBefore = Date.now() - 5 * 60 * 1000;
    ctx.state.transcriptChunks = ctx.state.transcriptChunks.filter((chunk) => chunk.at >= pruneBefore);
    const cutoff = Date.now() - seconds * 1000;
    return ctx.state.transcriptChunks
      .filter((chunk) => chunk.at >= cutoff)
      .map((chunk) => chunk.text)
      .join(' ')
      .trim();
  }

  function showRecentTranscript() {
    ctx.dom.liveTranscript.textContent = [recentTranscript(20), ctx.state.transcriptPreview].filter(Boolean).join(' ').trim();
  }

  function handleTranscriptEvent(event) {
    if (!event?.text) return;

    if (event.type === 'final') {
      ctx.state.transcriptChunks = appendUniqueChunk(ctx.state.transcriptChunks, event.text);
      ctx.state.transcriptPreview = '';
    } else if (event.type === 'partial') {
      ctx.state.transcriptPreview = normalizeText(event.text);
    }

    showRecentTranscript();
  }

  function buildTranscriptionDriver() {
    return createTranscriptionDriver(ctx.state.transcriptionSource, {
      onEvent: handleTranscriptEvent,
      onStatus: (text) => updateStatus(ctx, text),
      fetchImpl: fetch
    });
  }

  function buildSummarizationDriver() {
    return createSummarizationDriver(ctx.state.summarizationSource, {
      onStatus: (text) => updateStatus(ctx, text),
      fetchImpl: fetch
    });
  }

  async function ensureTranscriptionDriver() {
    if (!transcriptionDriver || transcriptionDriver.id !== ctx.state.transcriptionSource) {
      transcriptionDriver = buildTranscriptionDriver();
    }
    return transcriptionDriver;
  }

  async function ensureSummarizationDriver() {
    if (!summarizationDriver || summarizationDriver.id !== ctx.state.summarizationSource) {
      summarizationDriver = buildSummarizationDriver();
    }
    return summarizationDriver;
  }

  function startLoop() {
    clearInterval(ctx.state.loopHandle);
    ctx.state.loopHandle = setInterval(() => summarizeCurrentText(), ctx.state.summaryIntervalSeconds * 1000);
    ctx.state.loopHandle.unref?.();
  }

  async function summarizeCurrentText(text) {
    if (ctx.state.paused) return;
    const recent = normalizeText(text || recentTranscript(30));
    if (!recent || recent === ctx.state.lastSentText) return;
    ctx.state.lastSentText = recent;
    updateStatus(ctx, 'Summarizing...');

    try {
      const driver = await ensureSummarizationDriver();
      const result = await driver.summarize({
        mode: ctx.state.mode,
        recentTranscript: recent,
        visibleLines: ctx.state.lines.slice(-5)
      });

      if (ctx.state.paused) return;
      if (result.line) {
        addLine(result.line);
        updateStatus(ctx, `Added: ${result.line}`);
      } else {
        updateStatus(ctx, result.reason || 'No new useful line.');
      }
    } catch (error) {
      updateStatus(ctx, `Could not summarize: ${error.message}`);
    }
  }

  function setMode(mode) {
    ctx.state.mode = mode;
    updateModeButtons(ctx);
    updateStatus(ctx, `Mode changed to ${mode}.`);
  }

  function setFontSize(nextSize) {
    ctx.state.fontSize = clampFontSize(nextSize, ctx.state.fontSize);
    saveViewerSettings();
    syncViewerControls(ctx);
  }

  function setDisplayMargin(nextMargin) {
    ctx.state.displayMargin = clampDisplayMargin(nextMargin, ctx.state.displayMargin);
    saveViewerSettings();
    syncViewerControls(ctx);
  }

  function setSummaryInterval(nextInterval) {
    const next = clampSummaryIntervalSeconds(nextInterval, ctx.state.summaryIntervalSeconds);
    if (next === ctx.state.summaryIntervalSeconds) return;
    ctx.state.summaryIntervalSeconds = next;
    localStorage.setItem(STORAGE.summaryInterval, String(next));
    updateIntervalButtons(ctx);
    updateStatus(ctx, `Update interval set to ${next}s.`);
    if (ctx.state.listening && !ctx.state.paused) {
      startLoop();
    }
  }

  async function startListening({ force = false } = {}) {
    if (ctx.state.listening && !force) return;
    if (ctx.state.transcriptionSource === 'openai' && !ctx.state.openAiReady) {
      updateStatus(ctx, 'OpenAI transcription is unavailable until OPENAI_API_KEY is set.');
      return;
    }

    const driver = await ensureTranscriptionDriver();
    if (typeof driver.setMode === 'function') driver.setMode(ctx.state.mode);

    try {
      await driver.start({ currentMode: ctx.state.mode });
      ctx.state.listening = true;
      ctx.dom.startListening.disabled = true;
      ctx.dom.stopListening.disabled = false;
      startLoop();
    } catch (error) {
      updateStatus(ctx, `Could not start listening: ${error.message}`);
    }
  }

  async function stopListening() {
    ctx.state.listening = false;
    clearInterval(ctx.state.loopHandle);
    ctx.state.loopHandle = null;
    if (transcriptionDriver) await transcriptionDriver.stop();
    ctx.dom.startListening.disabled = false;
    ctx.dom.stopListening.disabled = true;
  }

  async function togglePauseAi() {
    ctx.state.paused = !ctx.state.paused;
    updatePauseButton(ctx);

    if (ctx.state.paused) {
      if (ctx.state.listening && ctx.state.transcriptionSource === 'openai' && transcriptionDriver) {
        await transcriptionDriver.stop();
      }
      clearInterval(ctx.state.loopHandle);
      updateStatus(ctx, 'AI paused. Manual lines still work.');
      return;
    }

    updateStatus(ctx, 'AI resumed.');
    if (ctx.state.listening) {
      if (ctx.state.transcriptionSource === 'openai') {
        await startListening({ force: true });
      } else {
        startLoop();
      }
    }
  }

  async function setTranscriptionSource(source) {
    if (!source || ctx.state.transcriptionSource === source) return;

    const shouldResume = ctx.state.listening && !ctx.state.paused;
    if (ctx.state.listening) {
      await stopListening();
    }

    ctx.state.transcriptionSource = source;
    localStorage.setItem(STORAGE.transcriptionSource, source);
    updateSourceButtons(ctx);

    if (shouldResume) {
      await startListening();
    }
  }

  function setSummarizationSource(source) {
    if (!source || ctx.state.summarizationSource === source) return;
    ctx.state.summarizationSource = source;
    localStorage.setItem(STORAGE.summarizationSource, source);
    summarizationDriver = null;
    updateSourceButtons(ctx);
  }

  function setOpenAiAvailability(hasOpenAIKey) {
    ctx.state.openAiReady = hasOpenAIKey;
    updateSourceButtons(ctx);

    if (hasOpenAIKey) {
      ctx.dom.apiWarning.hidden = true;
      ctx.dom.apiWarning.textContent = '';
      updateStatus(ctx, 'Manual mode is ready. OpenAI key detected.');
      return;
    }

    ctx.dom.apiWarning.hidden = false;
    ctx.dom.apiWarning.textContent = 'OPENAI_API_KEY is missing. Browser transcription still works; OpenAI transcription and summaries are off.';
    updateStatus(ctx, 'OPENAI_API_KEY is missing. Browser transcription still works.');
  }

  async function ensureSelectedTranscriptionSourceExists() {
    const sourceSummary = listAvailableSources();
    if (sourceSummary.transcription.some((source) => source.id === ctx.state.transcriptionSource)) return;
    await setTranscriptionSource('browser');
  }

  function isTypingTarget(target) {
    return Boolean(target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
  }

  async function loadRuntimeConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const data = await response.json();
      setOpenAiAvailability(Boolean(data.hasOpenAIKey));
      if (!ctx.state.openAiReady && ctx.state.transcriptionSource === 'openai') {
        await setTranscriptionSource('browser');
      }
      await ensureSelectedTranscriptionSourceExists();
    } catch (error) {
      ctx.dom.apiWarning.hidden = false;
      ctx.dom.apiWarning.textContent = 'Could not read AI status. Manual lines still work.';
      updateStatus(ctx, `Could not read AI status: ${error.message}`);
    }
  }

  return {
    addLine,
    clearLines,
    handleTranscriptEvent,
    isTypingTarget,
    loadRuntimeConfig,
    recentTranscript,
    setDisplayMargin,
    setFontSize,
    setMode,
    setPanelOpen: (open, options) => setPanelOpen(ctx, open, options),
    setSummaryInterval,
    setSummarizationSource,
    setTranscriptionSource,
    showRecentTranscript,
    startListening,
    startLoop,
    stopListening,
    summarizeCurrentText,
    togglePauseAi,
    undoLine,
    updatePauseButton: () => updatePauseButton(ctx),
    updateSourceButtons: () => updateSourceButtons(ctx),
    syncViewerControls: () => syncViewerControls(ctx),
    saveViewerSettings,
    renderDisplay: () => renderDisplay(ctx)
  };
}
