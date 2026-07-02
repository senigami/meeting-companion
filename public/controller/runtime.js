import { appendUniqueChunk, normalizeText } from '../services/text.js';
import {
  appendTranscriptItems,
  createTranscriptItems
} from '../services/transcript-display.js';
import {
  createSummarizationDriver,
  createTranscriptionDriver
} from '../services/registry.js';
import { fetchWithTimeout } from '../services/fetch-timeout.js';
import { getDefaultSummarizationSource } from '../services/catalog.js';
import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds
} from '../services/view-settings.js';
import {
  flashRailNote,
  renderDisplay,
  setSettingsOpen,
  updateClearButton,
  updateModeButtons,
  updatePauseButton,
  updateSourceButtons,
  updateStatus,
  syncSettingsPanel,
  syncViewerControls,
  setDisplayMarginGuidesVisible,
  updateSummaryIntervalControl
} from './view.js';
import { buildLiveTranscriptText } from './live-transcript.js';
import { clearDisplayMarginGuideTimer, flashDisplayMarginGuides } from './margin-guides.js';
import { saveViewerSettings } from './view-settings-sync.js';
import {
  isProviderConfigured,
  isSourceConfigured
} from './provider-availability.js';

const STORAGE = {
  fontSize: 'fontSize',
  displayMargin: 'displayMargin',
  summaryInterval: 'summaryIntervalSeconds',
  transcriptionSource: 'transcriptionSource',
  summarizationSource: 'summarizationSource'
};

const CLEAR_ARM_TIMEOUT_MS = 3000;
const UNDO_STATUS_MAX_CHARS = 40;

function truncateForStatus(text, maxChars = UNDO_STATUS_MAX_CHARS) {
  const clean = typeof text === 'string' ? text : '';
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean;
}

function transcriptionStatusLevel(text) {
  const clean = String(text || '');
  // Transient browser blips (no-speech, aborted) surface as "Speech recognition
  // error: ..." while listening keeps running, so they must not raise a problem.
  // Fatal cases use different phrasing ("Browser transcription stopped after
  // speech recognition error: ...", "Microphone stopped. ...").
  if (/^Speech recognition error:/i.test(clean)) return undefined;
  return /error|microphone stopped/i.test(clean) ? 'problem' : undefined;
}

export function createRuntime(ctx, deps = {}) {
  let transcriptionDriver = null;
  let summarizationDriver = null;
  let clearArmTimer = null;
  const {
    createTranscriptionDriverFn = createTranscriptionDriver,
    createSummarizationDriverFn = createSummarizationDriver,
    fetchImpl = fetch,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = deps;

  function clearPendingSelection(provider) {
    if (ctx.state.pendingProviderSelection?.provider === provider) {
      ctx.state.pendingProviderSelection = null;
    }
  }

  function applyPendingSelection(provider) {
    const pending = ctx.state.pendingProviderSelection;
    if (!pending || pending.provider !== provider) return;
    ctx.state.pendingProviderSelection = null;
    if (pending.kind === 'transcription') {
      setTranscriptionSource(pending.source);
    } else if (pending.kind === 'summarization') {
      setSummarizationSource(pending.source);
    }
  }

  function openSettingsForProvider(provider, kind) {
    if (provider === 'browser') return updateStatus(ctx, 'Browser speech recognition is not available in this browser.');
    ctx.state.registrationProvider = provider;
    setSettingsOpen(ctx, true);
    globalThis.requestAnimationFrame?.(() => {
      const target = ctx.dom.serviceRegistrationKeyInput;
      target?.focus?.();
      target?.select?.();
    });
  }

  function addLine(line, { source = 'manual', mode = ctx.state.mode } = {}) {
    const clean = normalizeText(line);
    if (!clean) return false;
    const nextItems = createTranscriptItems({
      text: clean,
      mode,
      source
    });
    if (!nextItems.length) return false;
    ctx.state.transcriptItems = appendTranscriptItems(ctx.state.transcriptItems, nextItems);
    renderDisplay(ctx);
    showRecentTranscript();
    return true;
  }

  function undoLine() {
    if (!ctx.state.transcriptItems.length && ctx.state.lastClearedItems) {
      const restored = ctx.state.lastClearedItems;
      ctx.state.transcriptItems = restored;
      ctx.state.lastClearedItems = null;
      renderDisplay(ctx);
      const lineWord = restored.length === 1 ? 'line' : 'lines';
      flashRailNote(ctx, `Restored ${restored.length} ${lineWord}.`, { setTimeoutFn, clearTimeoutFn });
      return;
    }
    const [removed] = ctx.state.transcriptItems.splice(-1, 1);
    renderDisplay(ctx);
    if (removed) {
      const text = `Removed: "${truncateForStatus(removed.text)}"`;
      updateStatus(ctx, text);
      flashRailNote(ctx, text, { setTimeoutFn, clearTimeoutFn });
    }
  }

  function armClear() {
    ctx.state.clearArmed = true;
    updateClearButton(ctx);
    clearTimeoutFn(clearArmTimer);
    clearArmTimer = setTimeoutFn(() => {
      clearArmTimer = null;
      disarmClear();
    }, CLEAR_ARM_TIMEOUT_MS);
  }

  function disarmClear() {
    clearTimeoutFn(clearArmTimer);
    clearArmTimer = null;
    if (!ctx.state.clearArmed) return;
    ctx.state.clearArmed = false;
    updateClearButton(ctx);
  }

  function cancelClearArm() {
    disarmClear();
  }

  function clearLines() {
    if (!ctx.state.clearArmed) {
      armClear();
      return;
    }

    disarmClear();
    const outgoing = ctx.state.transcriptItems;
    if (!outgoing.length) {
      updateStatus(ctx, 'Nothing to clear.');
      return;
    }
    ctx.state.lastClearedItems = outgoing;
    ctx.state.transcriptItems = [];
    renderDisplay(ctx);
    const lineWord = outgoing.length === 1 ? 'line' : 'lines';
    const text = `Cleared ${outgoing.length} ${lineWord} — press U or click Undo to bring them back.`;
    updateStatus(ctx, text);
    flashRailNote(ctx, text, { setTimeoutFn, clearTimeoutFn });
  }

  function showRecentTranscript() {
    ctx.state.transcriptChunks = ctx.state.transcriptChunks.filter((chunk) => chunk.at >= Date.now() - 5 * 60 * 1000);
    const preview = buildLiveTranscriptText(ctx.state.transcriptChunks, ctx.state.transcriptPreview);
    if (ctx.dom.liveTranscript) {
      ctx.dom.liveTranscript.textContent = preview;
    }
    if (ctx.dom.railTranscript) {
      ctx.dom.railTranscript.textContent = preview;
    }
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
    return createTranscriptionDriverFn(ctx.state.transcriptionSource, {
      onEvent: handleTranscriptEvent,
      onStatus: (text) => {
        const level = transcriptionStatusLevel(text);
        updateStatus(ctx, text, level ? { level } : undefined);
      },
      fetchImpl,
      setTimeoutFn,
      clearTimeoutFn
    });
  }

  function buildSummarizationDriver() {
    return createSummarizationDriverFn(ctx.state.summarizationSource, {
      onStatus: (text) => updateStatus(ctx, text),
      fetchImpl,
      setTimeoutFn,
      clearTimeoutFn
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
    const intervalSeconds = ctx.state.effectiveIntervalSeconds || ctx.state.summaryIntervalSeconds;
    ctx.state.loopHandle = setInterval(() => summarizeCurrentText(), intervalSeconds * 1000);
    ctx.state.loopHandle.unref?.();
  }

  function clearSummarizeFailureAlert() {
    if (!ctx.state.summarizeFailureAlertActive) return;
    ctx.state.summarizeFailureAlertActive = false;
    if (ctx.dom.apiWarning) {
      ctx.dom.apiWarning.hidden = true;
      ctx.dom.apiWarning.textContent = '';
    }
    if (ctx.dom.alertsSection) {
      ctx.dom.alertsSection.hidden = true;
    }
    if (ctx.dom.settingsAlertBadge) {
      ctx.dom.settingsAlertBadge.hidden = true;
    }
  }

  function resetSummarizeBackoff() {
    ctx.state.summarizeFailureCount = 0;
    const hadBackoff = Boolean(ctx.state.effectiveIntervalSeconds);
    ctx.state.effectiveIntervalSeconds = null;
    clearSummarizeFailureAlert();
    if (hadBackoff && ctx.state.listening && !ctx.state.paused) {
      startLoop();
    }
  }

  function escalateSummarizeFailure() {
    if (ctx.dom.apiWarning) {
      ctx.dom.apiWarning.hidden = false;
      ctx.dom.apiWarning.textContent = 'AI summaries are failing. Manual lines still work.';
    }
    if (ctx.dom.alertsSection) {
      ctx.dom.alertsSection.hidden = false;
    }
    if (ctx.dom.settingsAlertBadge) {
      ctx.dom.settingsAlertBadge.hidden = false;
    }
    ctx.state.summarizeFailureAlertActive = true;
    ctx.state.effectiveIntervalSeconds = Math.min(ctx.state.summaryIntervalSeconds * 2, 30);
    if (ctx.state.listening && !ctx.state.paused) {
      startLoop();
    }
  }

  async function summarizeCurrentText(text) {
    if (ctx.state.paused) return;
    const recent = normalizeText(
      text || buildLiveTranscriptText(ctx.state.transcriptChunks, ctx.state.transcriptPreview, { seconds: 30 })
    );
    if (!recent || recent === ctx.state.lastSentText) return;
    ctx.state.lastSentText = recent;
    updateStatus(ctx, 'Summarizing...');

    try {
      const driver = await ensureSummarizationDriver();
      const result = await driver.summarize({
        mode: ctx.state.mode,
        recentTranscript: recent,
        visibleLines: ctx.state.transcriptItems.slice(-5).map((item) => item.text)
      });

      resetSummarizeBackoff();

      if (ctx.state.paused) return;
      const recoveredLevel = ctx.state.listening ? 'listening' : 'manual';
      if (result.line) {
        addLine(result.line, { source: 'ai', mode: ctx.state.mode });
        updateStatus(ctx, `Added: ${result.line}`, { level: recoveredLevel });
      } else {
        updateStatus(ctx, result.reason || 'No new useful line.', { level: recoveredLevel });
      }
    } catch (error) {
      ctx.state.summarizeFailureCount = (ctx.state.summarizeFailureCount || 0) + 1;
      if (ctx.state.summarizeFailureCount === 3) {
        escalateSummarizeFailure();
      }
      updateStatus(
        ctx,
        `Could not summarize: ${error.message}`,
        ctx.state.summarizeFailureAlertActive ? { level: 'problem' } : undefined
      );
    }
  }

  function setMode(mode) {
    ctx.state.mode = mode;
    if (transcriptionDriver && typeof transcriptionDriver.setMode === 'function') {
      transcriptionDriver.setMode(mode);
    }
    updateModeButtons(ctx);
    updateStatus(ctx, `Mode changed to ${mode}.`);
  }

  function setFontSize(nextSize) {
    ctx.state.fontSize = clampFontSize(nextSize, ctx.state.fontSize);
    saveViewerSettings(ctx);
    syncViewerControls(ctx);
  }

  function setDisplayMargin(nextMargin) {
    ctx.state.displayMargin = clampDisplayMargin(nextMargin, ctx.state.displayMargin);
    if (ctx.state.displayMarginAdjusting) {
      setDisplayMarginGuidesVisible(ctx, true);
    } else {
      flashDisplayMarginGuides(ctx, { setTimeoutFn, clearTimeoutFn });
    }
    saveViewerSettings(ctx);
    syncViewerControls(ctx);
  }

  function beginDisplayMarginAdjustment() {
    ctx.state.displayMarginAdjusting = true;
    clearDisplayMarginGuideTimer(ctx, { clearTimeoutFn });
    setDisplayMarginGuidesVisible(ctx, true);
  }

  function endDisplayMarginAdjustment() {
    ctx.state.displayMarginAdjusting = false;
    clearDisplayMarginGuideTimer(ctx, { clearTimeoutFn });
    setDisplayMarginGuidesVisible(ctx, false);
  }

  function setSummaryInterval(nextInterval) {
    const next = clampSummaryIntervalSeconds(nextInterval, ctx.state.summaryIntervalSeconds);
    if (next === ctx.state.summaryIntervalSeconds) return;
    ctx.state.summaryIntervalSeconds = next;
    localStorage.setItem(STORAGE.summaryInterval, String(next));
    updateSummaryIntervalControl(ctx);
    updateStatus(ctx, `Update interval set to ${next}s.`);
    if (ctx.state.listening && !ctx.state.paused) {
      startLoop();
    }
  }

  async function startListening({ force = false } = {}) {
    if (ctx.state.listening && !force) return;
    if (ctx.state.transcriptionSource === 'openai' && !ctx.state.openAiReady) {
      updateStatus(ctx, 'OpenAI transcription is unavailable until OPENAI_API_KEY is set.', { level: 'problem' });
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
      if (!ctx.state.paused) {
        updateStatus(ctx, 'Listening.', { level: 'listening' });
      }
    } catch (error) {
      updateStatus(ctx, `Could not start listening: ${error.message}`, { level: 'problem' });
    }
  }

  async function pauseActiveTranscription() {
    clearInterval(ctx.state.loopHandle);
    ctx.state.loopHandle = null;
    if (transcriptionDriver) {
      await transcriptionDriver.stop();
    }
  }

  async function stopListening() {
    ctx.state.listening = false;
    await pauseActiveTranscription();
    ctx.dom.startListening.disabled = false;
    ctx.dom.stopListening.disabled = true;
    if (!ctx.state.paused) {
      updateStatus(ctx, 'Manual mode.', { level: 'manual' });
    }
  }

  async function togglePauseAi() {
    ctx.state.paused = !ctx.state.paused;
    updatePauseButton(ctx);

    if (ctx.state.paused) {
      const wasListening = ctx.state.listening;
      if (wasListening) {
        await pauseActiveTranscription();
      }
      updateStatus(
        ctx,
        wasListening
          ? 'AI paused — microphone stopped. Manual lines still work.'
          : 'AI paused. Manual lines still work.',
        { level: 'paused' }
      );
      return;
    }

    if (ctx.state.listening) {
      await startListening({ force: true });
      updateStatus(ctx, 'AI resumed — microphone listening again.', { level: 'listening' });
    } else {
      updateStatus(ctx, 'AI resumed. Microphone is still stopped.', { level: 'manual' });
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
    syncSettingsPanel(ctx);

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
    syncSettingsPanel(ctx);
  }

  function promptProviderSetup(kind, source) {
    if (!kind || !source) return;
    if (source === 'browser') {
      updateStatus(ctx, 'Browser speech recognition is not available in this browser.');
      return;
    }
    ctx.state.registrationProvider = source;
    ctx.state.pendingProviderSelection = { provider: source, kind, source };
    updateStatus(ctx, `Add a ${source === 'openai' ? 'OpenAI' : 'Claude'} key to use this provider.`);
    openSettingsForProvider(source, kind);
  }

  async function saveProviderKey(provider, value) {
    const clean = normalizeText(value || '');
    if (!clean) {
      updateStatus(ctx, `Paste a ${provider === 'claude' ? 'Claude' : 'OpenAI'} key before saving.`);
      return;
    }
    const response = await fetchImpl('/api/provider/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey: clean })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Saving provider key failed.');
    }
    applyProviderConfig(data);
    updateStatus(ctx, `${provider === 'claude' ? 'Claude' : 'OpenAI'} key saved.`);
    applyPendingSelection(provider);
  }

  async function testProviderKey(provider, value) {
    const clean = normalizeText(value || ctx.state.providerKeys?.[provider] || '');
    updateStatus(ctx, `Testing ${provider === 'claude' ? 'Claude' : 'OpenAI'} key...`);
    try {
      const response = await fetchWithTimeout(fetchImpl, '/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey: clean
        })
      }, { setTimeoutFn, clearTimeoutFn });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Provider test failed.');
      }
      updateStatus(ctx, `${provider === 'claude' ? 'Claude' : 'OpenAI'} key verified.`);
    } catch (error) {
      updateStatus(ctx, `${provider === 'claude' ? 'Claude' : 'OpenAI'} key test failed: ${error.message}`);
    }
  }

  async function deleteProviderKey(provider) {
    const response = await fetchImpl('/api/provider/key', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Deleting provider key failed.');
    }
    applyProviderConfig(data);
    updateStatus(ctx, `${provider === 'claude' ? 'Claude' : 'OpenAI'} key removed.`);
    clearPendingSelection(provider);
  }

  function setRegistrationProvider(provider) {
    if (provider !== 'openai' && provider !== 'claude') return;
    ctx.state.registrationProvider = provider;
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);
  }

  async function ensureSelectedTranscriptionSourceExists() {
    if (ctx.state.transcriptionSource === 'browser') return;
    if (ctx.state.transcriptionSource === 'openai' && ctx.state.openAiReady) return;
    await setTranscriptionSource('browser');
  }

  function resolveAvailableSummarizationSource() {
    if (ctx.state.summarizationSource === 'openai' && ctx.state.openAiReady) return 'openai';
    if (ctx.state.summarizationSource === 'claude' && ctx.state.anthropicReady) return 'claude';
    if (ctx.state.anthropicReady) return 'claude';
    if (ctx.state.openAiReady) return 'openai';
    return getDefaultSummarizationSource();
  }

  async function ensureSelectedSummarizationSourceExists() {
    const nextSource = resolveAvailableSummarizationSource();
    if (nextSource === ctx.state.summarizationSource) return;
    ctx.state.summarizationSource = nextSource;
    localStorage.setItem(STORAGE.summarizationSource, nextSource);
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);
  }

  function isTypingTarget(target) {
    return Boolean(target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
  }

  async function loadRuntimeConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const data = await response.json();
      applyProviderConfig(data);
      await ensureSelectedSummarizationSourceExists();
      await ensureSelectedTranscriptionSourceExists();
    } catch (error) {
      if (ctx.dom.apiWarning) {
        ctx.dom.apiWarning.textContent = 'Could not read AI status. Manual lines still work.';
      }
      if (ctx.dom.alertsSection) {
        ctx.dom.alertsSection.hidden = false;
      }
      updateStatus(ctx, `Could not read AI status: ${error.message}`);
    }
  }

  function applyProviderConfig(data = {}) {
    ctx.state.providerKeys = data.providerKeys || ctx.state.providerKeys || {};
    ctx.state.serverOpenAiReady = Boolean(data.hasOpenAIKey);
    ctx.state.serverAnthropicReady = Boolean(data.hasAnthropicKey);
    ctx.state.openAiReady = Boolean(
      ctx.state.providerKeys.openai?.configured || ctx.state.serverOpenAiReady
    );
    ctx.state.anthropicReady = Boolean(
      ctx.state.providerKeys.claude?.configured || ctx.state.serverAnthropicReady
    );
    updateProviderAvailability();
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);
  }

  function updateProviderAvailability() {
    syncSettingsPanel(ctx);
    updateStatus(
      ctx,
      ctx.state.openAiReady
        ? 'Manual mode is ready. OpenAI key detected.'
        : ctx.state.anthropicReady
          ? 'OpenAI key is missing. Browser transcription still works; Claude summaries are available.'
          : 'OpenAI key is missing. Browser transcription still works.'
    );
  }

  return {
    addLine,
    cancelClearArm,
    clearLines,
    handleTranscriptEvent,
    deleteProviderKey,
    focusProviderKey: openSettingsForProvider,
    isTypingTarget,
    isProviderConfigured: (provider) => isProviderConfigured(ctx, provider),
    isSourceConfigured: (kind, source) => isSourceConfigured(ctx, kind, source),
    loadRuntimeConfig,
    setDisplayMargin,
    setFontSize,
    setMode,
    setPanelOpen: (open, options) => setSettingsOpen(ctx, open, options),
    setSummaryInterval,
    setSummarizationSource,
    setTranscriptionSource,
    setRegistrationProvider,
    promptProviderSetup,
    saveProviderKey,
    showRecentTranscript,
    startListening,
    startLoop,
    stopListening,
    testProviderKey,
    summarizeCurrentText,
    togglePauseAi,
    undoLine,
    updatePauseButton: () => updatePauseButton(ctx),
    toggleSettingsOpen: () => setSettingsOpen(ctx, !(ctx.state.settingsOpen ?? ctx.state.panelOpen)),
    setSettingsOpen: (open, options) => setSettingsOpen(ctx, open, options),
    updateSourceButtons: () => updateSourceButtons(ctx),
    syncViewerControls: () => syncViewerControls(ctx),
    saveViewerSettings: () => saveViewerSettings(ctx),
    beginDisplayMarginAdjustment,
    endDisplayMarginAdjustment,
    renderDisplay: () => renderDisplay(ctx)
  };
}
