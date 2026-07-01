import {
  summaryIntervalSliderIndexFromSeconds
} from '../services/view-settings.js';
import { getProviderKeyState } from '../services/provider-credentials.js';

const MODE_META = {
  speaker: { label: 'Speaker', icon: 'icon-speaker' },
  information: { label: 'Information', icon: 'icon-information' },
  song: { label: 'Song', icon: 'icon-song' },
  prayer: { label: 'Prayer', icon: 'icon-prayer' }
};

export function updateStatus(ctx, text) {
  ctx.dom.status.textContent = text;
}

export function renderDisplay(ctx) {
  if (!ctx.dom.transcriptStack || !ctx.dom.transcriptViewport) return;

  const items = Array.isArray(ctx.state.transcriptItems) ? ctx.state.transcriptItems : [];
  const shouldStick = ctx.state.stickToBottom !== false;
  const previousScrollTop = ctx.dom.transcriptViewport.scrollTop || 0;
  const reducedMotion = Boolean(ctx.state.prefersReducedMotion);

  const nodes = items.map((item, index) => createTranscriptCard(item, index === items.length - 1));
  if (typeof ctx.dom.transcriptStack.replaceChildren === 'function') {
    ctx.dom.transcriptStack.replaceChildren(...nodes);
  } else {
    ctx.dom.transcriptStack.children = [...nodes];
  }

  if (shouldStick) {
    const target = nodes.at(-1);
    if (target?.scrollIntoView) {
      const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
      schedule(() => {
        target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'end' });
      });
    }
    return;
  }

  ctx.dom.transcriptViewport.scrollTop = previousScrollTop;
}

export function setSettingsOpen(ctx, open, { focusReturn = false } = {}) {
  const next = Boolean(open);
  ctx.state.settingsOpen = next;
  ctx.state.panelOpen = next;

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
    const focusTarget = ctx.dom.closeSettings || ctx.dom.settingsPanel || ctx.dom.settingsButton;
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
    btn.disabled = unavailable;
    updateProviderOptionLabel(btn, ctx, btn.dataset.kind, btn.dataset.source);
  });

  ctx.dom.summarizationButtons.forEach((btn) => {
    const active = btn.dataset.source === ctx.state.summarizationSource;
    const unavailable = isSourceUnavailable(ctx, btn.dataset.kind, btn.dataset.source);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.disabled = unavailable;
    updateProviderOptionLabel(btn, ctx, btn.dataset.kind, btn.dataset.source);
  });
}

export function updatePauseButton(ctx) {
  const button = ctx.dom.pauseAi;
  button.textContent = ctx.state.paused ? 'Resume AI' : 'Pause AI';
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
  ctx.dom.displayMarginInput.value = String(ctx.state.displayMargin);
  ctx.dom.displayMarginValue.textContent = `${ctx.state.displayMargin.toFixed(1)}vw`;
  updateSummaryIntervalControl(ctx);
}

export function applyViewerSettings(ctx) {
  document.documentElement.style.setProperty('--font-size', `${ctx.state.fontSize}px`);
  document.documentElement.style.setProperty('--display-margin', String(ctx.state.displayMargin));
}

export function syncSettingsPanel(ctx) {
  const alerts = buildAlerts(ctx);
  const hasAlerts = alerts.length > 0;

  if (ctx.dom.alertButton) {
    ctx.dom.alertButton.hidden = !hasAlerts;
    ctx.dom.alertButton.setAttribute('aria-expanded', String(Boolean(ctx.state.settingsOpen)));
  }

  if (ctx.dom.alertsSection) {
    ctx.dom.alertsSection.hidden = !hasAlerts;
  }

  if (ctx.dom.apiWarning) {
    ctx.dom.apiWarning.hidden = !hasAlerts;
    ctx.dom.apiWarning.textContent = hasAlerts ? alerts.map((alert) => alert.message).join(' ') : '';
  }

  syncProviderCard(ctx, 'openai', {
    description: ctx.dom.openaiKeyDescription,
    masked: ctx.dom.openaiKeyMasked,
    state: ctx.dom.openaiKeyState,
    input: ctx.dom.openaiKeyInput,
    save: ctx.dom.openaiKeySave,
    test: ctx.dom.openaiKeyTest,
    remove: ctx.dom.openaiKeyDelete
  });

  syncProviderCard(ctx, 'claude', {
    description: ctx.dom.claudeKeyDescription,
    masked: ctx.dom.claudeKeyMasked,
    state: ctx.dom.claudeKeyState,
    input: ctx.dom.claudeKeyInput,
    save: ctx.dom.claudeKeySave,
    test: ctx.dom.claudeKeyTest,
    remove: ctx.dom.claudeKeyDelete
  });

  if (ctx.dom.transcriptionBrowser) {
    updateProviderOptionLabel(ctx.dom.transcriptionBrowser, ctx, 'transcription', 'browser');
  }
  if (ctx.dom.transcriptionOpenAi) {
    updateProviderOptionLabel(ctx.dom.transcriptionOpenAi, ctx, 'transcription', 'openai');
  }
  if (ctx.dom.summaryOpenAi) {
    updateProviderOptionLabel(ctx.dom.summaryOpenAi, ctx, 'summarization', 'openai');
  }
  if (ctx.dom.summaryClaude) {
    updateProviderOptionLabel(ctx.dom.summaryClaude, ctx, 'summarization', 'claude');
  }
}

function createTranscriptCard(item, active = false) {
  const article = createNode('article');
  article.className = `transcript-item transcript-item--${item.mode || 'speaker'}${item.source === 'manual' ? ' transcript-item--manual' : ''}`;
  setDataAttribute(article, 'mode', item.mode || 'speaker');
  setDataAttribute(article, 'source', item.source || 'ai');
  setDataAttribute(article, 'active', String(active));
  article.dataset.mode = item.mode || 'speaker';
  article.dataset.source = item.source || 'ai';
  article.dataset.active = String(active);

  const meta = createNode('div');
  meta.className = 'transcript-meta';

  const icon = createNode('span');
  const modeMeta = MODE_META[item.mode] || MODE_META.speaker;
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

function isSourceUnavailable(ctx, kind, source) {
  if (kind === 'transcription') {
    if (source === 'browser') return !browserSpeechAvailable();
    return false;
  }

  return false;
}

function syncProviderCard(ctx, provider, refs) {
  const state = getProviderKeyState({
    serverReady: provider === 'openai' ? ctx.state.serverOpenAiReady : ctx.state.serverAnthropicReady,
    localKey: ctx.state.providerKeys?.[provider] || ''
  });

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

function updateProviderOptionLabel(button, ctx, kind, source) {
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

function getProviderState(ctx, kind, source) {
  if (kind === 'transcription' && source === 'browser') {
    return {
      configured: browserSpeechAvailable(),
      origin: 'local',
      label: browserSpeechAvailable() ? 'Local' : 'Unavailable'
    };
  }

  if (source === 'openai') {
    return getProviderKeyState({
      serverReady: Boolean(ctx.state.serverOpenAiReady),
      localKey: ctx.state.providerKeys?.openai || ''
    });
  }

  if (source === 'claude') {
    return getProviderKeyState({
      serverReady: Boolean(ctx.state.serverAnthropicReady),
      localKey: ctx.state.providerKeys?.claude || ''
    });
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
  return Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);
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
