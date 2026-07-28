import {
  summaryIntervalSliderIndexFromSeconds,
  summaryMaxWordsSliderIndexFromWords,
  sliderPositionFromFontSize
} from '../services/view-settings.js';
import { applyQuickPanelSnap, loadQuickPanelSnap } from './quick-panel-sheet.js';
import { autoExpandRailForCondition, resetRailAutoExpand } from './rail-collapse.js';

const MODE_META = {
  speaker: { label: 'Speaker', icon: 'icon-speaker' },
  information: { label: 'Information', icon: 'icon-information' },
  song: { label: 'Song', icon: 'icon-song' },
  prayer: { label: 'Prayer', icon: 'icon-prayer' }
};

const MANUAL_META = {
  label: 'Manual',
  icon: 'icon-human'
};

const TRANSCRIPT_SCROLL_DURATION_MS = 720;

const SETTINGS_SECTIONS = ['alerts', 'timing', 'transcription', 'summaries', 'services', 'tools'];
const DEFAULT_SETTINGS_SECTION = 'timing';

const RAIL_STATUS_WORDS = {
  listening: 'Listening',
  paused: 'Paused',
  manual: 'Manual',
  problem: 'Problem',
  // "Check mic" rather than "Problem": prolonged silence while listening is genuinely ambiguous --
  // it is exactly as consistent with a long prayer or reflective pause (normal in this room) as
  // with a dead microphone. Treating it as a confirmed "Problem" would be crying wolf during a
  // moment of silence that deserves quiet, not an alarm; saying nothing at all is the failure this
  // whole watchdog exists to prevent. A fourth, gentler level is the honest middle: visible and
  // persistent (loud enough to notice), but not styled or announced as urgently as a confirmed
  // fatal error (not loud enough to panic over).
  silence: 'Check mic'
};

// Levels serious enough that their rail-note explanation must stay up (no auto-hide) until the
// condition clears, rather than flashing briefly like a Clear/Undo note. 'problem' is a confirmed
// fatal condition (INV-10); 'silence' is not confirmed fatal, only prolonged and unexplained --
// see showRailPersistentNote for how the two are still styled and announced differently.
const PERSISTENT_STATUS_LEVELS = new Set(['problem', 'silence']);

// Ordered severity for the two persistent levels: 'problem' (a confirmed fatal condition, INV-10)
// must never be silently replaced by 'silence' (an unconfirmed, gentler watchdog alarm) just
// because the silence check happens to fire while a problem is already active -- e.g. a
// summarize-failure escalation followed by 45s of no transcript events precisely because the
// server path is backed off. Recovery still works: it comes from the condition itself clearing to
// a non-persistent level (e.g. 'listening'), never from a lower-ranked persistent level elbowing
// in on a higher one.
const LEVEL_RANK = { problem: 2, silence: 1 };

export function updateStatus(ctx, text, { level, clearTimeoutFn = clearTimeout } = {}) {
  if (level && RAIL_STATUS_WORDS[level]) {
    const currentLevel = ctx.state.railStatusLevel;
    if (
      PERSISTENT_STATUS_LEVELS.has(currentLevel) &&
      PERSISTENT_STATUS_LEVELS.has(level) &&
      (LEVEL_RANK[level] || 0) < (LEVEL_RANK[currentLevel] || 0)
    ) {
      return;
    }
  }

  ctx.dom.status.textContent = text;
  if (!level || !RAIL_STATUS_WORDS[level]) return;

  // #status lives inside the closed settings dialog, so a problem/silence message written only
  // there is unreadable. Mirror it into the rail note, and keep it up (no auto-hide) until the
  // level clears.
  if (PERSISTENT_STATUS_LEVELS.has(level)) {
    showRailPersistentNote(ctx, text, { clearTimeoutFn, isProblem: level === 'problem' });
  } else if (ctx.state.railProblemNote || ctx.state.railPersistentNoteText) {
    // Deliberately NOT gated on railProblemNote alone: flashRailNote clears that flag while its
    // overlay is up, so a recovery landing inside the 4s flash window would skip the cleanup
    // entirely and leak the auto-expand latch plus a stale remembered note. The screen would look
    // right and the next genuinely new condition would silently fail to expand a collapsed rail.
    clearRailProblem(ctx);
  }

  if (ctx.state.railStatusLevel === level) return;
  ctx.state.railStatusLevel = level;

  const dot = ctx.dom.railStatusDot;
  const word = ctx.dom.railStatusWord;
  if (word) {
    word.textContent = RAIL_STATUS_WORDS[level];
  }
  if (dot) {
    Object.keys(RAIL_STATUS_WORDS).forEach((name) => {
      dot.classList.toggle(`is-level-${name}`, name === level);
    });
  }
}

const RAIL_NOTE_DURATION_MS = 4000;

// #railNote stays mounted in the a11y tree at all times (see index.html) so switching its
// role/aria-live and filling its text is a single mutation on an already-registered live region --
// not "appear + speak" in the same tick, which AT frequently drops. A genuinely fatal problem
// (INV-10: this function only ever receives text already filtered to the fatal case) interrupts
// immediately (role="alert"/assertive); the benign Clear/Undo flashes stay role="status"/polite so
// they don't also start crying wolf.
function setRailNoteUrgency(note, isProblem) {
  note.setAttribute('role', isProblem ? 'alert' : 'status');
  note.setAttribute('aria-live', isProblem ? 'assertive' : 'polite');
}

// Non-text-based problem cue (WCAG 1.4.1: colour is not the only channel -- the red text colour
// alone must not be the only thing distinguishing a problem note from a benign Clear/Undo one).
// A plain Unicode prefix, not a separate aria-hidden node: this module has no DOM/document
// dependency today (renderDisplay's document.createElement only runs where a caller has stubbed
// `document`), so keep it that way rather than introducing one just for a decorative glyph.
const RAIL_PROBLEM_PREFIX = '⚠ ';
// A different glyph for the "silence" level: it is a time-based, unconfirmed signal, not the same
// claim as a confirmed fatal error, so it gets its own shape-based cue rather than reusing ⚠.
const RAIL_SILENCE_PREFIX = '⏱ ';

function showRailPersistentNote(ctx, text, { clearTimeoutFn = clearTimeout, isProblem = true } = {}) {
  const note = ctx.dom.railNote;
  if (!note) return;
  clearTimeoutFn(ctx.state.railNoteTimer);
  ctx.state.railNoteTimer = null;
  ctx.state.railProblemNote = true;
  note.classList.toggle('is-problem', isProblem);
  note.classList.toggle('is-silence', !isProblem);
  // Only a confirmed fatal condition interrupts assertively (role="alert"). The silence watchdog
  // has not confirmed anything is actually broken -- it stays role="status"/polite so it doesn't
  // also start crying wolf during what might just be a long prayer.
  setRailNoteUrgency(note, isProblem);
  const fullText = (isProblem ? RAIL_PROBLEM_PREFIX : RAIL_SILENCE_PREFIX) + text;
  note.textContent = fullText;
  // Remembered so a later flashRailNote (Clear/Undo) can hand the note back exactly as it was --
  // text, class, and urgency -- once its own timer expires, rather than leaving the condition's
  // note permanently blank while the condition itself is still active.
  ctx.state.railPersistentNoteText = fullText;
  ctx.state.railPersistentNoteIsProblem = isProblem;
  // Both persistent levels auto-expand, not just a confirmed problem. Verified live: with the rail
  // collapsed the watchdog fired correctly and the operator saw nothing but an unchanged dot,
  // because the 64px rail hides #railNote -- which would leave the watchdog doing no work in
  // exactly the unattended case it exists for. The note's whole value is that it says what to DO
  // next. Keyed by level: see autoExpandRailForCondition for why a shared latch was wrong.
  autoExpandRailForCondition(ctx, isProblem ? 'problem' : 'silence');
}

function clearRailProblem(ctx) {
  ctx.state.railProblemNote = false;
  ctx.state.railPersistentNoteText = null;
  ctx.state.railPersistentNoteIsProblem = null;
  // The rail has returned to a normal status -- every persistent condition has cleared -- so reset
  // the whole per-condition latch set rather than just the one that happened to be active.
  resetRailAutoExpand(ctx);
  const note = ctx.dom.railNote;
  if (!note) return;
  note.textContent = '';
  note.classList.remove('is-problem');
  note.classList.remove('is-silence');
  setRailNoteUrgency(note, false);
}

export function flashRailNote(ctx, text, { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  const note = ctx.dom.railNote;
  if (!note) return;
  clearTimeoutFn(ctx.state.railNoteTimer);
  ctx.state.railProblemNote = false;
  note.classList.remove('is-problem');
  note.classList.remove('is-silence');
  setRailNoteUrgency(note, false);
  note.textContent = text;
  ctx.state.railNoteTimer = setTimeoutFn(() => {
    ctx.state.railNoteTimer = null;
    // A flash (Clear/Undo) is a temporary overlay on top of a persistent note, not a destructive
    // takeover of it: if the problem/silence condition this note exists for is still active when
    // the flash expires, hand the note back exactly as it was rather than leaving it permanently
    // blank -- a blank note with the dot still reading "Check mic"/"Problem" strands the operator
    // with no way to tell what's wrong, which is the exact failure this whole area exists to
    // prevent. Ground truth is the live rail level, not a flag the flash itself could have gone
    // stale against.
    if (PERSISTENT_STATUS_LEVELS.has(ctx.state.railStatusLevel) && ctx.state.railPersistentNoteText) {
      const isProblem = Boolean(ctx.state.railPersistentNoteIsProblem);
      ctx.state.railProblemNote = true;
      note.classList.toggle('is-problem', isProblem);
      note.classList.toggle('is-silence', !isProblem);
      setRailNoteUrgency(note, isProblem);
      note.textContent = ctx.state.railPersistentNoteText;
      return;
    }
    note.textContent = '';
  }, RAIL_NOTE_DURATION_MS);
}

export function renderDisplay(ctx) {
  if (!ctx.dom.transcriptStack || !ctx.dom.transcriptViewport) return;

  const items = Array.isArray(ctx.state.transcriptItems) ? ctx.state.transcriptItems : [];
  const renderItems = items.length
    ? items
    : ctx.state.viewPanelOpen
      ? [{
        id: 'sample-text',
        mode: 'information',
        text: 'Sample text appears here so you can tune the display before the meeting starts.',
        createdAt: Date.now(),
        source: 'manual',
        sample: true
      }]
      : [];
  const shouldStick = ctx.state.stickToBottom !== false;
  const previousScrollTop = ctx.dom.transcriptViewport.scrollTop || 0;
  const reducedMotion = Boolean(ctx.state.prefersReducedMotion);

  const nodes = renderItems.map((item, index) => createTranscriptCard(item, index === renderItems.length - 1));
  if (typeof ctx.dom.transcriptStack.replaceChildren === 'function') {
    ctx.dom.transcriptStack.replaceChildren(...nodes);
  } else {
    ctx.dom.transcriptStack.children = [...nodes];
  }

  if (shouldStick) {
    scrollTranscriptToBottom(ctx, { reducedMotion });
    return;
  }

  ctx.dom.transcriptViewport.scrollTop = previousScrollTop;
}

function scrollTranscriptToBottom(ctx, { reducedMotion = false } = {}) {
  const viewport = ctx.dom.transcriptViewport;
  const targetTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);

  if (reducedMotion) {
    viewport.scrollTop = targetTop;
    return;
  }

  const startTop = Number(viewport.scrollTop) || 0;
  const distance = targetTop - startTop;
  if (Math.abs(distance) < 1) {
    viewport.scrollTop = targetTop;
    return;
  }

  const requestFrame = globalThis.requestAnimationFrame || ((callback) => setTimeout(() => callback(Date.now()), 16));
  const cancelFrame = globalThis.cancelAnimationFrame || clearTimeout;

  if (ctx.state.transcriptScrollFrame) {
    cancelFrame(ctx.state.transcriptScrollFrame);
    ctx.state.transcriptScrollFrame = null;
  }

  let startedAt = null;
  const animate = (timestamp) => {
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    startedAt ??= now;
    const elapsed = Math.min(1, (now - startedAt) / TRANSCRIPT_SCROLL_DURATION_MS);
    const eased = 1 - Math.pow(1 - elapsed, 3);
    viewport.scrollTop = startTop + distance * eased;

    if (elapsed < 1) {
      ctx.state.transcriptScrollFrame = requestFrame(animate);
      return;
    }

    viewport.scrollTop = targetTop;
    ctx.state.transcriptScrollFrame = null;
  };

  ctx.state.transcriptScrollFrame = requestFrame(animate);
}

export function getDefaultSettingsSection(ctx) {
  return buildAlerts(ctx).length > 0 ? 'alerts' : DEFAULT_SETTINGS_SECTION;
}

export function setSettingsSection(ctx, section) {
  const next = SETTINGS_SECTIONS.includes(section) ? section : DEFAULT_SETTINGS_SECTION;
  ctx.state.settingsSection = next;
  const hasAlerts = buildAlerts(ctx).length > 0;

  (ctx.dom.settingsSections || []).forEach((node) => {
    const sectionName = node.dataset?.settingsSection;
    const isActive = sectionName === next;
    // The alerts section stays hidden whenever there are no alerts to show,
    // even if a helper navigates to it directly.
    node.hidden = sectionName === 'alerts' ? !(isActive && hasAlerts) : !isActive;
  });

  (ctx.dom.settingsNavButtons || []).forEach((button) => {
    const isActive = button.dataset?.settingsNav === next;
    button.setAttribute('aria-current', String(isActive));
    button.classList?.toggle?.('active', isActive);
  });
}

export function setSettingsOpen(ctx, open, { focusReturn = false } = {}) {
  const next = Boolean(open);
  ctx.state.settingsOpen = next;
  ctx.state.panelOpen = next;

  if (next) {
    setSettingsSection(ctx, getDefaultSettingsSection(ctx));
    renderReadyCheck(ctx);
  }

  if (ctx.dom.settingsPanel) {
    ctx.dom.settingsPanel.hidden = !next;
    ctx.dom.settingsPanel.setAttribute('aria-hidden', String(!next));
    if (next && typeof ctx.dom.settingsPanel.showModal === 'function' && !ctx.dom.settingsPanel.open) {
      ctx.dom.settingsPanel.showModal();
    } else if (next && !ctx.dom.settingsPanel.open) {
      ctx.dom.settingsPanel.setAttribute('open', '');
    } else if (!next && ctx.dom.settingsPanel.open && typeof ctx.dom.settingsPanel.close === 'function') {
      ctx.dom.settingsPanel.close();
    } else if (!next) {
      ctx.dom.settingsPanel.removeAttribute?.('open');
    }
  }

  if (ctx.dom.settingsBackdrop) {
    ctx.dom.settingsBackdrop.hidden = true;
  }

  if (ctx.dom.settingsButton) {
    ctx.dom.settingsButton.setAttribute('aria-expanded', String(next));
    ctx.dom.settingsButton.setAttribute('aria-pressed', String(next));
  }

  if (next) {
    const focusTarget = ctx.state.pendingProviderSelection
      ? ctx.dom.serviceRegistrationKeyInput || ctx.dom.closeSettings || ctx.dom.settingsPanel || ctx.dom.settingsButton
      : ctx.dom.closeSettings || ctx.dom.settingsPanel || ctx.dom.settingsButton;
    globalThis.requestAnimationFrame?.(() => focusTarget?.focus?.());
    return;
  }

  if (focusReturn) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.settingsButton?.focus?.());
  }

  if (!next) {
    ctx.state.pendingProviderSelection = null;
  }
}

export const setPanelOpen = setSettingsOpen;

export function setViewPanelOpen(ctx, open, { focusReturn = false } = {}) {
  const next = Boolean(open);
  ctx.state.viewPanelOpen = next;

  if (ctx.state.viewPanelCloseHandle) {
    clearTimeout(ctx.state.viewPanelCloseHandle);
    ctx.state.viewPanelCloseHandle = null;
  }

  if (ctx.dom.viewPanel) {
    ctx.dom.viewPanel.hidden = !next;
    ctx.dom.viewPanel.setAttribute('aria-hidden', String(!next));
    if (next) {
      ctx.dom.viewPanel.classList?.add?.('is-open');
    } else {
      ctx.dom.viewPanel.classList?.remove?.('is-open');
      ctx.state.viewPanelCloseHandle = setTimeout(() => {
        if (ctx.dom.viewPanel && !ctx.state.viewPanelOpen) {
          ctx.dom.viewPanel.hidden = true;
        }
        ctx.state.viewPanelCloseHandle = null;
      }, 240);
    }
  }

  if (ctx.dom.viewButton) {
    ctx.dom.viewButton.setAttribute('aria-expanded', String(next));
    ctx.dom.viewButton.setAttribute('aria-pressed', String(next));
    const label = next ? 'Close display controls' : 'Open display controls';
    ctx.dom.viewButton.setAttribute('aria-label', label);
    ctx.dom.viewButton.title = label;
  }

  renderDisplay(ctx);

  if (next) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.closeViewPanel?.focus?.());
  } else if (focusReturn) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.viewButton?.focus?.());
  }
}

export function setQuickPanelOpen(ctx, open, { focusReturn = false } = {}) {
  const next = Boolean(open);
  ctx.state.quickPanelOpen = next;

  if (ctx.state.quickPanelCloseHandle) {
    clearTimeout(ctx.state.quickPanelCloseHandle);
    ctx.state.quickPanelCloseHandle = null;
  }

  if (ctx.dom.quickPanel) {
    if (next) {
      // Apply the last-used (or persisted) snap height before sliding
      // up, without animating the height itself -- only the slide
      // transform should visibly animate on open.
      applyQuickPanelSnap(ctx, ctx.state.quickPanelSnap || loadQuickPanelSnap(), { animate: false });
    }
    ctx.dom.quickPanel.setAttribute('aria-hidden', String(!next));
    if (next) {
      ctx.dom.quickPanel.classList?.add?.('is-open');
    } else {
      ctx.dom.quickPanel.classList?.remove?.('is-open');
    }
  }

  if (ctx.dom.quickPanelBackdrop) {
    ctx.dom.quickPanelBackdrop.hidden = !next;
  }

  if (ctx.dom.quickPanelToggle) {
    ctx.dom.quickPanelToggle.setAttribute('aria-expanded', String(next));
    ctx.dom.quickPanelToggle.setAttribute('aria-pressed', String(next));
    const label = next ? 'Close quick controls' : 'Open quick controls';
    ctx.dom.quickPanelToggle.setAttribute('aria-label', label);
    ctx.dom.quickPanelToggle.title = label;
  }

  if (next) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.quickPanelHandle?.focus?.());
  } else if (focusReturn) {
    globalThis.requestAnimationFrame?.(() => ctx.dom.quickPanelToggle?.focus?.());
  }
}

export function bindTranscriptViewport(ctx) {
  if (!ctx.dom.transcriptViewport) return;
  ctx.dom.transcriptViewport.addEventListener('scroll', () => {
    ctx.state.stickToBottom = isTranscriptNearBottom(ctx.dom.transcriptViewport);
  }, { passive: true });
}

export function updateModeButtons(ctx) {
  ctx.dom.modeButtons.forEach((btn) => {
    const active = btn.dataset.mode === ctx.state.mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

export function updateSourceButtons(ctx) {
  ctx.dom.transcriptionButtons.forEach((btn) => {
    const active = btn.dataset.source === ctx.state.transcriptionSource;
    const unavailable = isSourceUnavailable(ctx, btn.dataset.kind, btn.dataset.source);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.hidden = unavailable && btn.dataset.source !== ctx.state.transcriptionSource;
    btn.disabled = unavailable && btn.dataset.source === 'browser';
    updateProviderOptionLabel(btn, ctx, btn.dataset.kind, btn.dataset.source, { unavailable });
  });

  ctx.dom.summarizationButtons.forEach((btn) => {
    const active = btn.dataset.source === ctx.state.summarizationSource;
    const unavailable = isSourceUnavailable(ctx, btn.dataset.kind, btn.dataset.source);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.hidden = unavailable && btn.dataset.source !== ctx.state.summarizationSource;
    btn.disabled = false;
    updateProviderOptionLabel(btn, ctx, btn.dataset.kind, btn.dataset.source, { unavailable });
  });
}

export function syncServiceRegistration(ctx) {
  const provider = getRegistrationProvider(ctx);
  ctx.state.registrationProvider = provider;
  const state = getProviderState(ctx, 'summarization', provider);
  const label = provider === 'claude' ? 'Claude' : 'OpenAI';
  const configuredText = state.origin === 'server'
    ? 'Configured on server'
    : state.origin === 'local'
      ? 'Configured locally'
      : 'Needs key';

  updateRegistrationButton(ctx.dom.serviceRegistrationOpenAi, ctx, 'openai', provider);
  updateRegistrationButton(ctx.dom.serviceRegistrationClaude, ctx, 'claude', provider);

  if (ctx.dom.serviceRegistrationTitle) {
    ctx.dom.serviceRegistrationTitle.textContent = `${label} API key`;
  }

  if (ctx.dom.serviceRegistrationDescription) {
    ctx.dom.serviceRegistrationDescription.textContent = state.origin === 'local'
      ? 'Saved locally in this browser.'
      : state.origin === 'server'
        ? 'Using the server key. Paste a local override if needed.'
        : 'No key saved in this browser.';
  }

  if (ctx.dom.serviceRegistrationState) {
    ctx.dom.serviceRegistrationState.className = `statusPill ${state.configured ? 'ok' : 'warning'}`;
    ctx.dom.serviceRegistrationState.textContent = configuredText;
  }

  if (ctx.dom.serviceRegistrationMasked) {
    ctx.dom.serviceRegistrationMasked.hidden = !state.masked;
    ctx.dom.serviceRegistrationMasked.textContent = state.masked || '';
  }

  if (ctx.dom.serviceRegistrationKeyInput) {
    ctx.dom.serviceRegistrationKeyInput.placeholder = state.origin === 'local'
      ? `Paste a new ${label} key to replace the saved local key`
      : state.origin === 'server'
        ? `Paste a local ${label} override if you want one in this browser`
        : `Paste ${label} API key or local override`;
  }

  if (ctx.dom.serviceRegistrationSave) {
    ctx.dom.serviceRegistrationSave.textContent = state.configured ? 'Replace key' : 'Add and validate';
  }

  if (ctx.dom.serviceRegistrationTest) {
    ctx.dom.serviceRegistrationTest.textContent = 'Test key';
  }

  if (ctx.dom.serviceRegistrationDelete) {
    ctx.dom.serviceRegistrationDelete.disabled = state.origin !== 'local';
  }

  if (ctx.dom.serviceRegistrationHint) {
    ctx.dom.serviceRegistrationHint.textContent = state.origin === 'local'
      ? 'Saved locally in this browser. Do not use this on a shared computer.'
      : state.origin === 'server'
        ? 'This browser can override the server key locally if needed.'
        : 'Saved locally in this browser. Do not use this on a shared computer.';
  }
}

export function updatePauseButton(ctx) {
  const button = ctx.dom.pauseAi;
  const paused = Boolean(ctx.state.paused);
  if (ctx.dom.pauseAiLabel) {
    ctx.dom.pauseAiLabel.textContent = paused ? 'Resume' : 'Pause';
  }
  button.setAttribute('aria-pressed', String(paused));
  button.classList?.toggle?.('is-paused', paused);
  ctx.dom.panel?.classList?.toggle?.('is-paused', paused);
}

export function updateClearButton(ctx) {
  const button = ctx.dom.clear;
  if (!button) return;
  const armed = Boolean(ctx.state.clearArmed);
  if (ctx.dom.clearLabel) {
    ctx.dom.clearLabel.textContent = armed ? 'Confirm?' : 'Clear';
  }
  button.setAttribute('aria-label', armed ? 'Confirm clear all lines' : 'Clear all lines');
  button.title = armed ? 'Confirm clear all lines' : 'Clear all lines';
  button.classList?.toggle?.('is-armed', armed);
}

function updateSliderFill(input) {
  if (!input) return;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const percent = ((Number(input.value) - min) / Math.max(1, max - min)) * 100;
  input.style.setProperty('--slider-fill', `${Math.min(100, Math.max(0, percent))}%`);
}

export function updateSummaryIntervalControl(ctx) {
  if (!ctx.dom.summaryIntervalInput || !ctx.dom.summaryIntervalValue) return;
  const index = summaryIntervalSliderIndexFromSeconds(ctx.state.summaryIntervalSeconds);
  ctx.dom.summaryIntervalInput.value = String(index);
  ctx.dom.summaryIntervalInput.setAttribute('aria-valuetext', `${ctx.state.summaryIntervalSeconds}s`);
  ctx.dom.summaryIntervalValue.textContent = `${ctx.state.summaryIntervalSeconds}s`;
  updateSliderFill(ctx.dom.summaryIntervalInput);
}

export function updateSummaryMaxWordsControl(ctx) {
  if (!ctx.dom.summaryMaxWordsInput || !ctx.dom.summaryMaxWordsValue) return;
  const index = summaryMaxWordsSliderIndexFromWords(ctx.state.summaryMaxWords);
  ctx.dom.summaryMaxWordsInput.value = String(index);
  ctx.dom.summaryMaxWordsInput.setAttribute('aria-valuetext', `${ctx.state.summaryMaxWords} words`);
  ctx.dom.summaryMaxWordsValue.textContent = `${ctx.state.summaryMaxWords} words`;
  updateSliderFill(ctx.dom.summaryMaxWordsInput);
}

export function syncViewerControls(ctx) {
  ctx.dom.fontSizeInput.value = String(sliderPositionFromFontSize(ctx.state.fontSize));
  ctx.dom.fontSizeInput.setAttribute('aria-valuetext', `${ctx.state.fontSize}px`);
  ctx.dom.fontSizeValue.textContent = `${ctx.state.fontSize}px`;
  updateSliderFill(ctx.dom.fontSizeInput);
  ctx.dom.displayMarginInput.value = String(ctx.state.displayMargin);
  ctx.dom.displayMarginValue.textContent = `${ctx.state.displayMargin.toFixed(1)}%`;
  updateSliderFill(ctx.dom.displayMarginInput);
  updateSummaryIntervalControl(ctx);
  updateSummaryMaxWordsControl(ctx);
  updateDisplayMarginGuides(ctx);
}

export function applyViewerSettings(ctx) {
  document.documentElement.style.setProperty('--font-size', `${ctx.state.fontSize}px`);
  document.documentElement.style.setProperty('--display-margin', `${ctx.state.displayMargin}%`);
  updateDisplayMarginGuides(ctx);
}

export function setDisplayMarginGuidesVisible(ctx, visible) {
  ctx.state.displayMarginGuidesVisible = Boolean(visible);
  updateDisplayMarginGuides(ctx);
}

export function syncSettingsPanel(ctx) {
  const alerts = buildAlerts(ctx);
  const hasAlerts = alerts.length > 0;

  if (ctx.dom.settingsAlertBadge) {
    ctx.dom.settingsAlertBadge.hidden = !hasAlerts;
  }

  if (ctx.dom.settingsButton) {
    const label = hasAlerts ? 'Open settings, alerts waiting' : 'Open settings';
    ctx.dom.settingsButton.setAttribute('aria-label', label);
    ctx.dom.settingsButton.title = label;
  }

  if (ctx.dom.alertsSection) {
    ctx.dom.alertsSection.hidden = !hasAlerts;
  }

  if (ctx.dom.apiWarning) {
    ctx.dom.apiWarning.hidden = !hasAlerts;
    ctx.dom.apiWarning.textContent = hasAlerts ? alerts.map((alert) => alert.message).join(' ') : '';
  }

  updateSourceButtons(ctx);
  syncServiceRegistration(ctx);
  renderReadyCheck(ctx);
}

export function renderReadyCheck(ctx) {
  renderReadyCheckRow(ctx.dom.readyCheckMicDot, ctx.dom.readyCheckMicFix, checkMicReady(ctx), {
    fix: 'This browser can\'t listen. Choose OpenAI transcription or type lines manually.'
  });

  const activeSummaryProvider = ctx.state.summarizationSource === 'claude' ? 'claude' : 'openai';
  renderReadyCheckRow(ctx.dom.readyCheckAiDot, ctx.dom.readyCheckAiFix, checkAiReady(ctx), {
    fix: activeSummaryProvider === 'claude'
      ? 'Claude key is missing. Add one in AI services, or switch to OpenAI.'
      : 'OpenAI key is missing. Add one in AI services, or switch to Claude.'
  });

  renderReadyCheckRow(ctx.dom.readyCheckDisplayDot, ctx.dom.readyCheckDisplayFix, true, { fix: '' });
}

function checkMicReady(ctx) {
  return browserSpeechAvailable() || (ctx.state.transcriptionSource === 'openai' && Boolean(ctx.state.openAiReady));
}

function checkAiReady(ctx) {
  const activeSummaryProvider = ctx.state.summarizationSource === 'claude' ? 'claude' : 'openai';
  return activeSummaryProvider === 'claude' ? Boolean(ctx.state.anthropicReady) : Boolean(ctx.state.openAiReady);
}

function renderReadyCheckRow(dot, fixNode, ready, { fix } = {}) {
  if (dot) {
    dot.classList?.toggle?.('is-ready', ready);
    dot.classList?.toggle?.('is-not-ready', !ready);
  }
  if (fixNode) {
    fixNode.textContent = ready ? '' : fix || '';
    fixNode.hidden = ready;
  }
}

function createTranscriptCard(item, active = false) {
  const isManual = item.source === 'manual';
  const isSample = Boolean(item.sample);
  const visualMode = isManual ? 'manual' : item.mode || 'speaker';
  const modeMeta = isManual ? MANUAL_META : MODE_META[item.mode] || MODE_META.speaker;
  const article = createNode('article');
  article.className = `transcript-item transcript-item--${visualMode}${isManual ? ' transcript-item--manual' : ''}${isSample ? ' transcript-item--sample' : ''}`;
  setDataAttribute(article, 'mode', visualMode);
  setDataAttribute(article, 'source', item.source || 'ai');
  setDataAttribute(article, 'active', String(active));
  article.dataset.mode = visualMode;
  article.dataset.source = item.source || 'ai';
  article.dataset.active = String(active);
  if (isSample) {
    setDataAttribute(article, 'sample', 'true');
  }
  if (article.classList?.add && isSample) {
    article.classList.add('transcript-item--sample');
  }

  const meta = createNode('div');
  meta.className = 'transcript-meta';

  const icon = createNode('span');
  icon.className = `transcript-icon ${modeMeta.icon}`;
  if (typeof icon.setAttribute === 'function') {
    icon.setAttribute('aria-hidden', 'true');
  }
  meta.append(icon);

  const label = createNode('span');
  label.className = 'transcript-meta-label';
  label.textContent = modeMeta.label;
  meta.append(label);

  if (item.createdAt) {
    const time = createNode('time');
    time.className = 'transcript-time';
    time.dateTime = new Date(item.createdAt).toISOString();
    time.textContent = new Date(item.createdAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    });
    meta.append(time);
  }

  const body = createNode('p');
  body.className = 'transcript-text';
  body.textContent = item.text || '';

  article.append(meta, body);
  return article;
}

function syncBrowserPanel(ctx, refs) {
  const pending = ctx.state.pendingProviderSelection;
  const browserPending = pending?.kind === 'transcription' && pending?.source === 'openai';
  if (refs.panel) {
    refs.panel.hidden = !(ctx.state.transcriptionSource === 'browser' && !browserPending);
  }
  if (refs.description) {
    refs.description.textContent = browserSpeechAvailable()
      ? 'Browser speech stays local and uses the built-in microphone.'
      : 'Browser speech recognition is not available in this browser.';
  }
}

function isProviderPanelVisible(ctx, kind, source) {
  const pending = ctx.state.pendingProviderSelection;
  if (kind === 'transcription') {
    return ctx.state.transcriptionSource === source || (pending?.kind === kind && pending?.source === source);
  }
  if (kind === 'summarization') {
    return ctx.state.summarizationSource === source || (pending?.kind === kind && pending?.source === source);
  }
  return false;
}

function isSourceUnavailable(ctx, kind, source) {
  if (kind === 'transcription') {
    if (source === 'demo') return false;
    if (source === 'browser') return !browserSpeechAvailable();
    return !getProviderState(ctx, kind, source).configured;
  }

  return !getProviderState(ctx, kind, source).configured;
}

function syncProviderCard(ctx, provider, refs, visible = true) {
  const state = ctx.state.providerKeys?.[provider] || {
    configured: false,
    origin: 'missing',
    label: 'Needs key',
    masked: ''
  };

  if (refs.panel) {
    refs.panel.hidden = !visible;
  }

  if (refs.description) {
    refs.description.textContent = state.origin === 'local'
      ? 'Saved locally in this browser.'
      : state.origin === 'server'
        ? 'Using the server key. Paste a local override if needed.'
        : 'No key saved in this browser.';
  }

  if (refs.state) {
    refs.state.className = `statusPill ${state.configured ? 'ok' : 'warning'}`;
    refs.state.textContent = state.label;
  }

  if (refs.masked) {
    refs.masked.hidden = !state.masked;
    refs.masked.textContent = state.masked || '';
  }

  if (refs.input) {
    refs.input.placeholder = state.origin === 'local'
      ? 'Paste a new key to replace the saved local key'
      : state.origin === 'server'
        ? 'Paste a local override if you want one in this browser'
        : 'Paste API key or local override';
  }

  if (refs.remove) {
    refs.remove.disabled = state.origin !== 'local';
  }

  if (refs.save) {
    refs.save.textContent = state.origin === 'local' ? 'Replace key' : 'Save key';
  }

  if (refs.test) {
    refs.test.textContent = 'Test key';
  }
}

function updateProviderOptionLabel(button, ctx, kind, source, options = {}) {
  if (!button) return;
  const state = getProviderState(ctx, kind, source);
  const statusNode = typeof button.querySelector === 'function'
    ? button.querySelector('.providerStatus')
    : null;
  if (statusNode) {
    statusNode.textContent = state.label;
  } else if (typeof button.textContent === 'string' && button.dataset?.statusLabel) {
    button.textContent = button.dataset.statusLabel.replace('{status}', state.label);
  }
  button.dataset.configured = String(state.configured);
  button.dataset.origin = state.origin;
  if (kind === 'transcription' && source === 'browser') {
    button.disabled = !browserSpeechAvailable();
  }
}

function updateRegistrationButton(button, ctx, provider, activeProvider) {
  if (!button) return;
  const state = getProviderState(ctx, 'summarization', provider);
  const statusNode = typeof button.querySelector === 'function'
    ? button.querySelector('.providerStatus')
    : null;
  if (statusNode) {
    statusNode.textContent = state.label;
  }
  button.classList.toggle('active', provider === activeProvider);
  button.setAttribute('aria-pressed', String(provider === activeProvider));
  button.dataset.configured = String(state.configured);
  button.dataset.origin = state.origin;
}

function getRegistrationProvider(ctx) {
  const pending = ctx.state.pendingProviderSelection;
  if (pending?.provider === 'openai' || pending?.provider === 'claude') {
    return pending.provider;
  }

  if (ctx.state.registrationProvider === 'openai' || ctx.state.registrationProvider === 'claude') {
    return ctx.state.registrationProvider;
  }

  const openAiState = getProviderState(ctx, 'summarization', 'openai');
  const claudeState = getProviderState(ctx, 'summarization', 'claude');
  if (!openAiState.configured) return 'openai';
  if (!claudeState.configured) return 'claude';
  return 'openai';
}

function getProviderState(ctx, kind, source) {
  // The demo source depends on nothing -- no microphone, no key, no network -- so it is the one
  // source that is always configured. That is the whole point of it: there is always a way to see
  // the display working before a meeting starts.
  if (kind === 'transcription' && source === 'demo') {
    return { configured: true, origin: 'local', label: 'Sample meeting' };
  }

  if (kind === 'summarization' && source === 'demo') {
    return { configured: true, origin: 'local', label: 'No key needed' };
  }

  if (kind === 'transcription' && source === 'browser') {
    return {
      configured: browserSpeechAvailable(),
      origin: 'local',
      label: browserSpeechAvailable() ? 'Local' : 'Unavailable'
    };
  }

  if (source === 'openai') {
    return ctx.state.providerKeys?.openai || {
      configured: Boolean(ctx.state.serverOpenAiReady),
      origin: Boolean(ctx.state.serverOpenAiReady) ? 'server' : 'missing',
      label: Boolean(ctx.state.serverOpenAiReady) ? 'Configured on server' : 'Needs key',
      masked: ''
    };
  }

  if (source === 'claude') {
    return ctx.state.providerKeys?.claude || {
      configured: Boolean(ctx.state.serverAnthropicReady),
      origin: Boolean(ctx.state.serverAnthropicReady) ? 'server' : 'missing',
      label: Boolean(ctx.state.serverAnthropicReady) ? 'Configured on server' : 'Needs key',
      masked: ''
    };
  }

  return {
    configured: false,
    origin: 'missing',
    label: 'Needs key'
  };
}

// An unconfigured provider is only an alert when something currently selected actually needs it.
// This used to alert on every provider that had no key, which meant an operator running OpenAI and
// browser transcription was permanently told "Claude key is missing" about a provider they had never
// selected and may never use. That is not an error, it is a fact about a road not taken -- and a
// standing alert nobody can clear teaches the operator to ignore the alert surface, which is exactly
// what INV-10 exists to prevent. The settings panel still shows every provider's "Needs key" state;
// that is where you go to learn what is unconfigured. An alert is for something wrong right now.
function providersInUse(ctx) {
  const inUse = new Set();
  if (ctx.state.transcriptionSource === 'openai') inUse.add('openai');
  if (ctx.state.summarizationSource === 'openai') inUse.add('openai');
  if (ctx.state.summarizationSource === 'claude') inUse.add('anthropic');
  return inUse;
}

function buildAlerts(ctx) {
  const alerts = [];
  const inUse = providersInUse(ctx);

  if (inUse.has('openai') && !ctx.state.openAiReady) {
    alerts.push({
      provider: 'openai',
      // Alternatives named here are REAL ones only. Demo is deliberately never offered as a remedy:
      // it replays a rehearsal script, so on a live display it would show text nobody said. See the
      // note in services/response.js -- manual typing is the sanctioned live fallback, not demo.
      message: ctx.state.transcriptionSource === 'openai'
        ? 'OpenAI is selected but has no key. Add one in AI services, or switch transcription to Browser.'
        : 'OpenAI is selected for summaries but has no key. Add one in AI services, or switch summaries to Claude.'
    });
  }

  if (inUse.has('anthropic') && !ctx.state.anthropicReady) {
    alerts.push({
      provider: 'claude',
      message: 'Claude is selected for summaries but has no key. Add one in AI services, or switch summaries to OpenAI.'
    });
  }

  return alerts;
}

export function browserSpeechAvailable() {
  return Boolean(globalThis.window?.SpeechRecognition || globalThis.window?.webkitSpeechRecognition);
}

function isTranscriptNearBottom(viewport, threshold = 96) {
  if (!viewport) return true;
  const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  return remaining <= threshold;
}

function createNode(tagName) {
  if (globalThis.document?.createElement) {
    return globalThis.document.createElement(tagName);
  }

  return {
    tagName: tagName.toUpperCase(),
    children: [],
    className: '',
    dataset: {},
    attributes: {},
    textContent: '',
    dateTime: '',
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    scrollIntoView() {}
  };
}

function setDataAttribute(node, name, value) {
  if (!node) return;
  if (node.dataset) {
    node.dataset[name] = String(value);
  }
  if (typeof node.setAttribute === 'function') {
    node.setAttribute(`data-${name}`, value);
  }
}

function updateDisplayMarginGuides(ctx) {
  if (!ctx.dom.display) return;
  setDataAttribute(ctx.dom.display, 'marginGuides', ctx.state.displayMarginGuidesVisible ? 'true' : 'false');
}
