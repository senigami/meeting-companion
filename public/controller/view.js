import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  summaryIntervalSliderIndexFromSeconds
} from '../services/view-settings.js';

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

export function updateStatus(ctx, text) {
  ctx.dom.status.textContent = text;
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
  if (ctx.dom.pauseAiLabel) {
    ctx.dom.pauseAiLabel.textContent = ctx.state.paused ? 'Resume' : 'Pause';
  }
  button.setAttribute('aria-pressed', String(ctx.state.paused));
}

export function updateSummaryIntervalControl(ctx) {
  if (!ctx.dom.summaryIntervalInput || !ctx.dom.summaryIntervalValue) return;
  ctx.dom.summaryIntervalInput.value = String(
    summaryIntervalSliderIndexFromSeconds(ctx.state.summaryIntervalSeconds)
  );
  ctx.dom.summaryIntervalInput.setAttribute('aria-valuetext', `${ctx.state.summaryIntervalSeconds}s`);
  ctx.dom.summaryIntervalValue.textContent = `${ctx.state.summaryIntervalSeconds}s`;
}

export function syncViewerControls(ctx) {
  ctx.dom.fontSizeInput.value = String(ctx.state.fontSize);
  ctx.dom.fontSizeValue.textContent = `${ctx.state.fontSize}px`;
  syncSliderVisual(ctx.dom.fontSizeInput, ctx.state.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX);
  ctx.dom.displayMarginInput.value = String(ctx.state.displayMargin);
  ctx.dom.displayMarginValue.textContent = `${ctx.state.displayMargin.toFixed(1)}%`;
  syncSliderVisual(ctx.dom.displayMarginInput, ctx.state.displayMargin, 0, 40);
  updateSummaryIntervalControl(ctx);
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

function syncSliderVisual(input, value, min, max) {
  if (!input?.parentElement) return;
  const range = Math.max(1, max - min);
  const percent = ((Number(value) - min) / range) * 100;
  input.parentElement.style.setProperty('--slider-value', String(Math.min(100, Math.max(0, percent))));
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

function buildAlerts(ctx) {
  const alerts = [];
  if (!ctx.state.openAiReady) {
    alerts.push({
      provider: 'openai',
      message: ctx.state.anthropicReady
        ? 'OpenAI key is missing. Browser transcription still works, and Claude summaries remain available.'
        : 'OpenAI key is missing. Browser transcription still works, but OpenAI transcription and summaries are off.'
    });
  }
  if (!ctx.state.anthropicReady) {
    alerts.push({
      provider: 'claude',
      message: ctx.state.openAiReady
        ? 'Claude key is missing. OpenAI features are available.'
        : 'Claude key is missing. Add one to enable Claude summaries.'
    });
  }
  return alerts;
}

function browserSpeechAvailable() {
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
