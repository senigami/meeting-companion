import {
  summaryIntervalSliderIndexFromSeconds
} from '../services/view-settings.js';

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

export function setPanelOpen(ctx, open, { focusInput = false } = {}) {
  ctx.state.panelOpen = open;
  if (ctx.dom.secondaryControls) {
    ctx.dom.secondaryControls.hidden = !open;
    ctx.dom.secondaryControls.setAttribute('aria-hidden', String(!open));
  }
  if (ctx.dom.hidePanel) {
    ctx.dom.hidePanel.textContent = open ? 'Hide extras' : 'Show extras';
    ctx.dom.hidePanel.setAttribute('aria-expanded', String(open));
    ctx.dom.hidePanel.setAttribute('aria-controls', 'secondaryControls');
  }

  if (open && focusInput) {
    ctx.dom.manualInput.focus();
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
    btn.disabled = unavailable;
  });

  ctx.dom.summarizationButtons.forEach((btn) => {
    const active = btn.dataset.source === ctx.state.summarizationSource;
    const unavailable = isSourceUnavailable(ctx, btn.dataset.kind, btn.dataset.source);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.disabled = unavailable;
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
    if (source === 'openai') return !ctx.state.openAiReady;
    return false;
  }

  if (kind === 'summarization') {
    if (source === 'openai') return !ctx.state.openAiReady;
    if (source === 'claude') return !ctx.state.anthropicReady;
  }

  return false;
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
