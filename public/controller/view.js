export function updateStatus(ctx, text) {
  ctx.dom.status.textContent = text;
}

export function renderDisplay(ctx) {
  const visible = [...ctx.state.lines].slice(-5);
  const padded = Array(5 - visible.length).fill('').concat(visible);
  ['line1', 'line2', 'line3', 'line4', 'line5'].forEach((id, index) => {
    ctx.dom[id].textContent = padded[index] || '';
  });
}

export function setPanelOpen(ctx, open, { focusInput = false } = {}) {
  ctx.state.panelOpen = open;
  ctx.dom.panel.hidden = !open;
  ctx.dom.panel.setAttribute('aria-hidden', String(!open));

  if (open && focusInput) {
    ctx.dom.manualInput.focus();
  } else if (!open) {
    ctx.dom.display.focus();
  }
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
    const unavailable = btn.dataset.source === 'openai' && !ctx.state.openAiReady;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.disabled = unavailable;
  });

  ctx.dom.summarizationButtons.forEach((btn) => {
    const active = btn.dataset.source === ctx.state.summarizationSource;
    const unavailable = btn.dataset.source === 'openai' && !ctx.state.openAiReady;
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

export function updateIntervalButtons(ctx) {
  ctx.dom.intervalButtons.forEach((btn) => {
    const active = Number(btn.dataset.interval) === ctx.state.summaryIntervalSeconds;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

export function syncViewerControls(ctx) {
  ctx.dom.fontSizeInput.value = String(ctx.state.fontSize);
  ctx.dom.fontSizeValue.textContent = `${ctx.state.fontSize}px`;
  ctx.dom.displayMarginInput.value = String(ctx.state.displayMargin);
  ctx.dom.displayMarginValue.textContent = `${ctx.state.displayMargin.toFixed(1)}vw`;
  updateIntervalButtons(ctx);
}

export function applyViewerSettings(ctx) {
  document.documentElement.style.setProperty('--font-size', `${ctx.state.fontSize}px`);
  document.documentElement.style.setProperty('--display-margin', String(ctx.state.displayMargin));
}
