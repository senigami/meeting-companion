import {
  clampDisplayMargin,
  clampFontSize,
  clampFontFamily,
  clampFontWeight,
  clampSummaryIntervalSeconds,
  fontSizeFromSliderPosition,
  clampAudioProcessingPreset,
  clampAudioHighPassHz,
  clampAudioBoolean,
  AUDIO_SETTINGS_DEFAULTS
} from '../services/view-settings.js';
import { DEFAULT_MEDIAN_WPM, readingBudget } from '../services/reading-pace.js';
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
  updateSourceButtons,
  renderProgramPanel,
  updateSpeakerDatalist
} from './view.js';
import { createRuntime } from './runtime.js';
import { isDemoModeEnabled, startDemoFeed } from './demo-feed.js';
import { createRecordingSessionId } from '../services/session-recording.js';
import { normalizeReplaySpeed } from '../services/transcription/replay.js';
import { sanitizeEditedText } from '../services/sanitize-edited-text.js';

// 2026-08-09: a real session had demo cards appear unprompted mid-meeting with a real OpenAI key
// configured and selected in Settings the whole time -- traced to a stray `?demo` left in the URL
// (from earlier same-day demo testing) triggering startDemoFeed on page load, whose returned cancel
// function was discarded. Pressing Stop repeatedly did nothing because Stop never had a handle to
// cancel it; only a hard refresh did. Held here, at module scope, because the feed is scheduled once
// from startApp() but must be cancellable from bindControlButtons()'s Stop handler, which runs
// earlier in the same startApp() call.
let cancelDemoFeed = () => {};

const STORAGE = {
  fontSize: 'fontSize',
  displayMargin: 'displayMargin',
  fontFamily: 'fontFamily',
  fontWeight: 'fontWeight',
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
  audioConditioningEnabled: 'audioConditioningEnabled',
  audioDeviceId: 'audioDeviceId',
  recordingEnabled: 'recordingEnabled',
  // Replay transcription source (GitHub issue #3). Must stay in sync with runtime.js's own
  // STORAGE map -- same gotcha runtime.js's comment documents for summarizationSourceChosen.
  replayRecordingId: 'replayRecordingId',
  replaySpeed: 'replaySpeed',
  // Pointer at a server-side reader profile, not the measurement itself -- see runtime.js's own
  // STORAGE map for why that distinction is what makes this safe in localStorage. Must stay in sync
  // with runtime.js's own STORAGE map, same gotcha as summarizationSourceChosen above.
  readingPaceProfileName: 'readingPaceProfileName'
};

export function startApp() {
  const ctx = {
    state: {
      transcriptItems: [],
      clearArmed: false,
      lastClearedItems: null,
      mode: 'speaker',
      // Display-only, operator-typed (issue #40). Empty is the valid default -- no name means no
      // label, never "Unknown" -- and deliberately never persisted: it names whoever is speaking
      // right now, not a setting to carry into the next meeting.
      speakerName: '',
      // Per-meeting program list (Steve's explicit call): typed fresh each meeting, never persisted
      // to localStorage like audioDeviceId/transcriptionSource above -- resets on reload.
      program: [],
      paused: false,
      fontSize: clampFontSize(localStorage.getItem(STORAGE.fontSize) || 84),
      displayMargin: clampDisplayMargin(localStorage.getItem(STORAGE.displayMargin) || 4.5),
      fontFamily: clampFontFamily(localStorage.getItem(STORAGE.fontFamily) || 'system'),
      fontWeight: clampFontWeight(localStorage.getItem(STORAGE.fontWeight) || 600),
      operatorRailWidth: loadRailWidth(localStorage),
      railCollapsed: loadRailCollapsed(localStorage),
      summaryIntervalSeconds: clampSummaryIntervalSeconds(localStorage.getItem(STORAGE.summaryInterval) || 5),
      // DERIVED (issue #44), not read from localStorage, and seeded from readingBudget rather than
      // derivedCardWords -- which is the SNAPPED helper, and using it here quietly undid the whole
      // fix on the one path most readers are on.
      //
      // Found by Cato before this shipped. At the default (no profile, 5s interval, assumed 30 wpm)
      // the true budget is 2.5 words and this line seeded 11. readingBudget was never initialised at
      // all, so updateSummaryMaxWordsControl's optional chains fell through to the healthy branch:
      // the screen read "11 words" with no warning and every summarize call was told 11. Not a first
      // frame flicker either -- recomputeSummaryMaxWords only runs on an interval change or a profile
      // apply, and applyLastReadingPaceProfile returns early with no remembered name, so with an
      // operator who never drags the slider the false 11 lasted the whole session.
      //
      // Both fields are seeded from ONE call for the same reason the view stopped computing its own:
      // two places deriving this quantity is the fault #44 exists to remove.
      ...(() => {
        const seconds = clampSummaryIntervalSeconds(localStorage.getItem(STORAGE.summaryInterval) || 5);
        const budget = readingBudget(DEFAULT_MEDIAN_WPM, seconds);
        return { summaryMaxWords: budget.words, readingBudget: budget };
      })(),
      // No profile until applyLastReadingPaceProfile (runtime.js) resolves, same "must work with none
      // set" requirement issue #44 states explicitly -- every reader before this shipped had none.
      // No card on the wall yet, so the first complete chunk summarizes on arrival (#31).
      firstCardShown: false,
      readingPaceProfile: null,
      // Set only by dragging Words per card directly (runtime.js's setSummaryMaxWordsOverride) --
      // recomputeSummaryMaxWords skips re-deriving while this is true, and applying any profile
      // selection (including "No profile") always clears it back.
      summaryMaxWordsManual: false,
      readingPaceProfileName: localStorage.getItem(STORAGE.readingPaceProfileName) || '',
      displayMarginGuidesVisible: false,
      displayMarginAdjusting: false,
      transcriptChunks: [],
      transcriptPreview: '',
      inFlightChunks: [],
      listening: false,
      loopHandle: null,
      lastSentText: '',
      summaryHistory: [],
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
      // Real mic readiness (permission + a real audioinput device), refreshed asynchronously by
      // runtime.js#refreshMicReadiness. Starts false/'unknown' -- never claim the mic is ready
      // before it has actually been checked once (INV-10: a green dot that has never met a
      // microphone is worse than no dot at all).
      micReady: false,
      micReadyReason: 'unknown',
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
      audioConditioningEnabled: clampAudioBoolean(localStorage.getItem(STORAGE.audioConditioningEnabled), AUDIO_SETTINGS_DEFAULTS.audioConditioningEnabled),
      // Raw string, not clamped here: a saved deviceId goes stale the moment a USB mic is
      // unplugged, and validating it against the current device list is resolveDeviceId's job
      // (audio-monitor.js), run at the point of use, not at load time when no list exists yet.
      audioDeviceId: localStorage.getItem(STORAGE.audioDeviceId) || AUDIO_SETTINGS_DEFAULTS.audioDeviceId,
      audioLevelTestActive: false,
      // Debugging/tuning session recorder (ADR-0004, backlog items 2-3): on by default -- Steve's
      // explicit, twice-made call, since a default-off instrument gets no data unless someone
      // remembers to arm it, and this never leaves the machine (recordings/ is gitignored, server
      // binds loopback-only). #recordingIndicator (index.html) is the truthful, always-visible sign
      // that it is actually happening; recordingOk starts null (unproven) rather than true, so the
      // indicator's first real signal always comes from an actual write, never an assumption.
      recordingEnabled: localStorage.getItem(STORAGE.recordingEnabled) !== 'false',
      recordingSessionId: createRecordingSessionId(),
      recordingQueue: [],
      recordingOk: null,
      recordingHeaderQueued: false,
      // Set for real by loadRuntimeConfig() from /api/config's appCommit (server.js is the only
      // place that can ask git -- the browser can't). 'unknown' is the honest default until that
      // resolves, and stays the honest answer if the server itself couldn't determine it either
      // (issue #4).
      appCommit: 'unknown',
      // Replay transcription source (GitHub issue #3): a recorded session driven back through the
      // live pipeline. availableRecordings starts empty and is filled by runtime.refreshRecordingList()
      // during loadRuntimeConfig() -- until then a persisted selection is trusted but not yet proven.
      availableRecordings: [],
      selectedRecordingId: localStorage.getItem(STORAGE.replayRecordingId) || '',
      replaySpeed: normalizeReplaySpeed(localStorage.getItem(STORAGE.replaySpeed))
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
      fontFamilySelect: $('fontFamily'),
      fontWeightInput: $('fontWeight'),
      fontWeightValue: $('fontWeightValue'),
      fontWeightField: $('fontWeightField'),
      summaryIntervalInput: $('summaryInterval'),
      summaryIntervalValue: $('summaryIntervalValue'),
      summaryIntervalField: $('summaryIntervalField'),
      summaryMaxWordsInput: $('summaryMaxWords'),
      summaryMaxWordsValue: $('summaryMaxWordsValue'),
      summaryMaxWordsField: $('summaryMaxWordsField'),
      readingPaceProfileSelect: $('readingPaceProfileSelect'),
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
      audioDeviceSelect: $('audioDeviceSelect'),
      audioLevelTestButton: $('audioLevelTestButton'),
      audioLevelBar: $('audioLevelBar'),
      audioLevelPeak: $('audioLevelPeak'),
      audioLevelText: $('audioLevelText'),
      replayControls: $('replayControls'),
      replayRecordingSelect: $('replayRecordingSelect'),
      replaySpeedSelect: $('replaySpeedSelect'),
      modeButtons: Array.from(document.querySelectorAll('.mode')),
      speakerNameInput: $('speakerNameInput'),
      speakerNameDatalist: $('speakerNameDatalist'),
      speakerHeaderSend: $('speakerHeaderSend'),
      programList: $('programList'),
      programAddRow: $('programAddRow'),
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
    bindProgramPanel(ctx, runtime);
    bindServiceRegistrationControls(ctx, runtime);
    bindSettingsNav(ctx);
    bindReadyCheck(ctx, runtime);
    bindKeyboardShortcuts(ctx, runtime);
  }

  bindEvents();
  updateModeButtons(ctx);
  updateSourceButtons(ctx);
  updatePauseButton(ctx);
  renderProgramPanel(ctx);
  updateSpeakerDatalist(ctx);
  syncViewerControls(ctx);
  runtime.saveViewerSettings();
  setSettingsOpen(ctx, false);
  renderDisplay(ctx);
  runtime.showRecentTranscript();
  const runtimeConfig = runtime.loadRuntimeConfig();
  // Issue #44: populate the profile picker and apply the last-used one, if there is one.
  // Fire-and-forget, same reasoning as loadRuntimeConfig above -- both are nice-to-haves layered on
  // top of a UI that already rendered with a working default, never something the boot path waits on.
  void runtime.refreshReadingPaceProfileList();
  void runtime.applyLastReadingPaceProfile();
  if (isDemoModeEnabled(globalThis.location?.search)) {
    runtimeConfig.finally?.(() => {
      // A real provider being configured means this is a live meeting, whatever the URL still says
      // -- a leftover `?demo` param from earlier testing must never inject scripted content into
      // that session (2026-08-09 incident: exactly this, with OpenAI configured and selected the
      // whole time). The query string alone is not consent; only the absence of any real provider
      // makes an unconfigured demo-on-load a safe, expected first-run default.
      if (ctx.state.openAiReady || ctx.state.anthropicReady) return;
      cancelDemoFeed = startDemoFeed(runtime);
      // Stop starts disabled (only Start enables it) and the demo feed never calls startListening,
      // so Stop stayed disabled -- and a disabled button never dispatches a click at all, in any
      // browser. That is the exact "I clicked Stop a few more times, nothing would change" from the
      // 2026-08-09 incident: cancelDemoFeed existed by then but the button that was meant to reach
      // it could not be pressed. Enabling it here is what makes Stop an actual way out of a demo run.
      ctx.dom.stopListening.disabled = false;
    });
  }
  const ticker = setInterval(runtime.showRecentTranscript, 1000);
  ticker.unref?.();
  setViewPanelOpen(ctx, false);
  setQuickPanelOpen(ctx, false);
}

function bindManualEntry(ctx, runtime) {
  const submitManualLine = () => {
    // Explicit speaker: '' -- addLine defaults to ctx.state.speakerName, which exists so an AI card
    // (or a header-card send) picks up the name sitting in that separate box. A quick note typed
    // here has nothing to do with it: Steve, live, after a leftover name in that box silently
    // attached itself to an unrelated manual line pushed through this one.
    if (!runtime.addLine(ctx.dom.manualInput.value, { speaker: '' })) return;
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

// `plaintext-only` (Chromium/Firefox) blocks a paste or an Enter press from inserting real markup
// (a <div>/<br>) into the card, which is exactly what sanitizeEditedText exists to clean up after
// on browsers that don't support it -- so prefer it, and fall back to `true` where it's absent
// (older WebKit) rather than leaving the card uneditable.
const PLAINTEXT_ONLY_SUPPORTED = (() => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false;
  try {
    const probe = document.createElement('div');
    probe.contentEditable = 'plaintext-only';
    return probe.contentEditable === 'plaintext-only';
  } catch {
    return false;
  }
})();

function beginCardEdit(node, card) {
  // Already editing this node (a second click while the caret is inside it) -- do nothing, and
  // critically don't re-stash textContent, which would overwrite the original with whatever's
  // been typed so far and break Escape's restore.
  if (!node || node.getAttribute?.('contenteditable')) return;
  node.dataset.originalText = node.textContent || '';
  node.setAttribute('contenteditable', PLAINTEXT_ONLY_SUPPORTED ? 'plaintext-only' : 'true');
  node.spellcheck = false;
  card?.classList?.add('transcript-item--editing');
  node.focus?.();
  const selection = globalThis.getSelection?.();
  if (selection && typeof document !== 'undefined' && document.createRange) {
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function endCardEdit(node, card) {
  node.removeAttribute('contenteditable');
  card?.classList?.remove('transcript-item--editing');
}

// Click-to-edit-in-place (#125), same delegation idiom as transcript-delete above: cards are
// replaced wholesale on every render, so one listener on the stack (keyed by the id/class view.js
// stamps onto each card) survives that churn instead of being re-attached every tick.
function bindTranscriptCardEditing(ctx, runtime) {
  const stack = ctx.dom.transcriptStack;
  if (!stack) return;

  stack.addEventListener('click', (event) => {
    const target = event.target?.closest?.('.transcript-text, .transcript-meta-value');
    if (!target) return;
    const card = target.closest?.('.transcript-item');
    // The sample placeholder isn't a real captured line -- nothing to correct, same exclusion the
    // delete button already applies.
    if (!card || card.dataset?.sample === 'true') return;
    beginCardEdit(target, card);
  });

  // `plaintext-only` blocks a rich paste from inserting real markup, but where it's unsupported
  // (older WebKit) contenteditable="true" inserts the browser's OWN pasted HTML live -- an
  // <img onerror=...> in the clipboard fires the instant it lands, before sanitizeEditedText or
  // any commit handler ever runs. Feature-detecting our way out of that (relying on plaintext-only
  // where available) leaves the fallback with no defense at all. Intercept paste unconditionally,
  // on every browser, and insert only the plain-text payload -- confirmed live: without this,
  // execCommand('insertHTML', ..., '<img onerror=...>') executes the handler immediately.
  stack.addEventListener('paste', (event) => {
    const target = event.target?.closest?.('[contenteditable]');
    if (!target) return;
    event.preventDefault();
    const plain = event.clipboardData?.getData('text/plain') ?? '';
    const selection = globalThis.getSelection?.();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(plain));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      target.textContent += plain;
    }
  });

  stack.addEventListener('keydown', (event) => {
    const target = event.target?.closest?.('[contenteditable]');
    if (!target) return;
    if (event.key === 'Enter') {
      // Funnel into the same commit path focusout uses below, rather than committing here too --
      // one path, not two.
      event.preventDefault();
      target.blur?.();
      return;
    }
    if (event.key === 'Escape') {
      // Restore the exact stashed string, not a re-normalized version of it, and drop
      // contenteditable BEFORE blur so the focusout handler below (filtered to nodes that still
      // carry contenteditable) never sees this as a commit.
      target.textContent = target.dataset.originalText ?? '';
      endCardEdit(target, target.closest?.('.transcript-item'));
      target.blur?.();
    }
  });

  stack.addEventListener('focusout', (event) => {
    const target = event.target?.closest?.('[contenteditable]');
    if (!target) return;
    const card = target.closest?.('.transcript-item');
    const id = card?.dataset?.itemId;
    const cleanText = sanitizeEditedText(target.textContent);
    endCardEdit(target, card);
    if (id) runtime.updateItemText(id, cleanText);
  });
}

function bindControlButtons(ctx, runtime) {
  ctx.dom.startListening.addEventListener('click', runtime.startListening);
  ctx.dom.stopListening.addEventListener('click', () => {
    // Stop must be able to kill a scripted demo feed too, not just a real transcription driver --
    // see cancelDemoFeed's own comment for the incident this closes.
    cancelDemoFeed();
    cancelDemoFeed = () => {};
    runtime.stopListening();
  });
  ctx.dom.pauseAi.addEventListener('click', runtime.togglePauseAi);
  ctx.dom.undo.addEventListener('click', runtime.undoLine);
  ctx.dom.clear.addEventListener('click', runtime.clearLines);
  ctx.dom.clear.addEventListener('blur', runtime.cancelClearArm);
  // Delegated: cards are replaced wholesale on every render (view.js#renderDisplay), so a listener
  // on each button would be thrown away and re-attached every tick. One listener on the stack,
  // keyed by the item id view.js stamps onto the card, survives that churn.
  ctx.dom.transcriptStack?.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest?.('.transcript-delete');
    if (!deleteBtn) return;
    const card = deleteBtn.closest('.transcript-item');
    const id = card?.dataset?.itemId;
    if (id) runtime.removeItem(id);
  });
  bindTranscriptCardEditing(ctx, runtime);
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
  // Crossing the 900px drawer breakpoint (e.g. rotating a tablet) changes whether #quickPanel
  // is a real closed drawer or the `display: contents` desktop rail -- resync inert so it never
  // gets stuck applied to the visible rail, or stuck absent on a still-closed mobile drawer.
  globalThis.matchMedia?.('(max-width: 900px)')?.addEventListener?.('change', () => {
    setQuickPanelOpen(ctx, ctx.state.quickPanelOpen, { focusReturn: false });
  });
  const recordingEnabledInput = $('recordingEnabledInput');
  if (recordingEnabledInput) {
    recordingEnabledInput.checked = ctx.state.recordingEnabled;
    recordingEnabledInput.addEventListener('change', (event) => {
      runtime.setRecordingEnabled(event.target.checked);
    });
  }
  ctx.dom.settingsButton.addEventListener('click', () => runtime.toggleSettingsOpen());
  ctx.dom.closeSettings.addEventListener('click', () => runtime.setSettingsOpen(false, { focusReturn: true }));
  ctx.dom.settingsPanel?.addEventListener('close', () => runtime.setSettingsOpen(false, { focusReturn: true }));
  ctx.dom.settingsPanel?.addEventListener('click', (event) => {
    if (event.target !== ctx.dom.settingsPanel) return;
    runtime.setSettingsOpen(false, { focusReturn: true });
  });
  ctx.dom.audioDeviceSelect?.addEventListener('change', (event) => {
    runtime.setAudioDeviceId(event.target.value);
  });
  ctx.dom.audioLevelTestButton?.addEventListener('click', () => {
    runtime.toggleAudioLevelTest();
  });
  ctx.dom.replayRecordingSelect?.addEventListener('change', (event) => {
    runtime.setSelectedRecordingId(event.target.value);
  });
  ctx.dom.replaySpeedSelect?.addEventListener('change', (event) => {
    runtime.setReplaySpeed(event.target.value);
  });
  runtime.populateAudioDeviceOptions?.();
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
  ctx.dom.fontFamilySelect?.addEventListener('change', (e) => {
    runtime.setFontFamily(e.target.value);
  });
  ctx.dom.fontWeightInput?.addEventListener('input', (e) => {
    runtime.setFontWeight(e.target.value);
  });
  ctx.dom.summaryIntervalInput.addEventListener('input', (e) => {
    runtime.setSummaryInterval(e.target.value);
  });
  // 2026-08-09: re-enabled as a fast manual override for mid-meeting adjustment, without redoing the
  // whole reading-pace measurement (see setSummaryMaxWordsOverride in runtime.js for how this stays
  // consistent with #44 -- it clears any applied profile first, so the override can never disagree
  // with one). The slider's value IS the word count now (6-24, one at a time), not an index into a
  // small option set -- Steve wanted every value in that range reachable for a live adjustment.
  ctx.dom.summaryMaxWordsInput.addEventListener('input', (e) => {
    runtime.setSummaryMaxWordsOverride(e.target.value);
  });
  ctx.dom.readingPaceProfileSelect?.addEventListener('change', (e) => {
    runtime.setReadingPaceProfileName(e.target.value);
  });

  bindDragFade(ctx.dom.fontSizeInput, ctx.dom.fontSizeField);
  if (ctx.dom.fontWeightInput && ctx.dom.fontWeightField) {
    bindDragFade(ctx.dom.fontWeightInput, ctx.dom.fontWeightField);
  }

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

  // 2026-08-09: the fade-out-the-other-fields effect stays for the Display options drawer (fontSize,
  // displayMargin above), but not here -- Steve wants Update interval and Words per card visible
  // side by side while dragging either, since adjusting one against the other is the whole point.
}

function bindModeAndSourceButtons(ctx, runtime) {
  ctx.dom.modeButtons.forEach((btn) => btn.addEventListener('click', () => runtime.setMode(btn.dataset.mode)));
  // As fast as changing mode (issue #40's own requirement): plain 'input', no Enter/blur to commit
  // -- the very next card created after a keystroke already carries the new name.
  ctx.dom.speakerNameInput?.addEventListener('input', (event) => {
    // syncInput: false -- this IS the operator typing directly into the field; writing a trimmed
    // value back into the live input mid-keystroke is what ate space characters (runtime.js).
    runtime.setSpeakerName(event.target.value, { syncInput: false });
  });
  // Send/arrow button next to the speaker-name input: pushes its current text to the display as a
  // header card in the active mode. Never clears the field -- see runtime.js#sendHeaderLine.
  ctx.dom.speakerHeaderSend?.addEventListener('click', () => {
    if (!runtime.sendHeaderLine(ctx.dom.speakerNameInput?.value)) return;
  });
  ctx.dom.transcriptionButtons.forEach((btn) => btn.addEventListener('click', () => handleSourceSelection(ctx, runtime, btn)));
  ctx.dom.summarizationButtons.forEach((btn) => btn.addEventListener('click', () => handleSourceSelection(ctx, runtime, btn)));
}

// Program tab (settings): a simple list editor synced into ctx.state.program. Add/remove are
// structural (rebuild the rows via renderProgramPanel); editing a row's own name/mode is NOT
// re-rendered, so the operator's own keystroke/focus in that row survives the state update -- see
// runtime.js#updateProgramEntry. One delegated listener each, same idiom as the transcript-delete
// button (cards/rows are rebuilt wholesale, so per-row listeners would be thrown away constantly).
function bindProgramPanel(ctx, runtime) {
  ctx.dom.programAddRow?.addEventListener('click', () => runtime.addProgramEntry());

  ctx.dom.programList?.addEventListener('input', (event) => {
    if (!event.target.matches?.('.programRowName')) return;
    const row = event.target.closest('[data-program-index]');
    const index = Number(row?.dataset?.programIndex);
    if (!Number.isInteger(index)) return;
    runtime.updateProgramEntry(index, { name: event.target.value });
  });

  ctx.dom.programList?.addEventListener('change', (event) => {
    if (!event.target.matches?.('.programRowMode')) return;
    const row = event.target.closest('[data-program-index]');
    const index = Number(row?.dataset?.programIndex);
    if (!Number.isInteger(index)) return;
    runtime.updateProgramEntry(index, { mode: event.target.value });
  });

  ctx.dom.programList?.addEventListener('click', (event) => {
    const removeBtn = event.target.closest?.('.programRowRemove');
    if (!removeBtn) return;
    const row = removeBtn.closest('[data-program-index]');
    const index = Number(row?.dataset?.programIndex);
    if (!Number.isInteger(index)) return;
    runtime.removeProgramEntry(index);
  });
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
