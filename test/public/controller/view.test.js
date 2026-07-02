import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderDisplay,
  renderReadyCheck,
  setViewPanelOpen,
  setSettingsOpen,
  setSettingsSection,
  getDefaultSettingsSection,
  updateStatus
} from '../../../public/controller/view.js';

function createNode(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    dataset: {},
    className: '',
    textContent: '',
    hidden: false,
    attributes: {},
    scrollIntoViewCalls: [],
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
    scrollIntoView(options) {
      this.scrollIntoViewCalls.push(options);
    }
  };
}

test('renderDisplay renders transcript cards and scrolls to the latest item', async () => {
  const originalDocument = global.document;
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const originalCancelAnimationFrame = global.cancelAnimationFrame;

  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');
  transcriptViewport.scrollTop = 0;
  transcriptViewport.clientHeight = 600;
  transcriptViewport.scrollHeight = 1600;
  const frames = [];

  global.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  global.cancelAnimationFrame = () => {};

  global.document = {
    createElement(tagName) {
      const node = createNode(tagName);
      if (tagName === 'article') {
        node.querySelector = () => null;
      }
      return node;
    }
  };

  try {
    const ctx = {
      state: {
        transcriptItems: [
          { id: 'one', mode: 'speaker', text: 'First thought.', createdAt: 1, source: 'ai' },
          { id: 'two', mode: 'information', text: 'Second thought.', createdAt: 2, source: 'manual' }
        ],
        stickToBottom: true,
        prefersReducedMotion: false
      },
      dom: {
        transcriptViewport,
        transcriptStack
      }
    };

    renderDisplay(ctx);
    assert.equal(frames.length, 1);
    frames.shift()(0);
    assert.equal(transcriptViewport.scrollTop, 0);
    frames.shift()(360);
    assert.equal(transcriptViewport.scrollTop > 0, true);
    frames.shift()(720);

    assert.equal(transcriptStack.children.length, 2);
    assert.equal(transcriptStack.children[1].dataset.active, 'true');
    assert.equal(transcriptStack.children[1].scrollIntoViewCalls.length, 0);
    assert.equal(transcriptViewport.scrollTop, 1000);
  } finally {
    global.document = originalDocument;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test('renderDisplay preserves user scroll position when the reader is not at the bottom', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');
  transcriptViewport.scrollTop = 240;
  transcriptViewport.clientHeight = 500;
  transcriptViewport.scrollHeight = 1200;
  transcriptViewport.scrollToCalls = [];
  transcriptViewport.scrollTo = function scrollTo(options) {
    this.scrollToCalls.push(options);
  };

  const ctx = {
    state: {
      transcriptItems: [
        { id: 'one', mode: 'speaker', text: 'First thought.', createdAt: 1, source: 'ai' },
        { id: 'two', mode: 'speaker', text: 'Second thought.', createdAt: 2, source: 'ai' }
      ],
      stickToBottom: false,
      prefersReducedMotion: false
    },
    dom: {
      transcriptViewport,
      transcriptStack
    }
  };

  renderDisplay(ctx);

  assert.equal(transcriptStack.children.length, 2);
  assert.equal(transcriptViewport.scrollToCalls.length, 0);
  assert.equal(transcriptViewport.scrollTop, 240);
});

test('renderDisplay shows manual transcript cards with a human icon instead of the active mode icon', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');

  const ctx = {
    state: {
      transcriptItems: [
        {
          id: 'manual-one',
          mode: 'information',
          text: 'Manual line.',
          createdAt: 2,
          source: 'manual'
        }
      ],
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: {
      transcriptViewport,
      transcriptStack
    }
  };

  renderDisplay(ctx);

  const card = transcriptStack.children[0];
  const meta = card.children[0];

  assert.equal(card.className.includes('transcript-item--manual'), true);
  assert.equal(card.className.includes('transcript-item--information'), false);
  assert.equal(meta.children[0].className, 'transcript-icon icon-human');
  assert.equal(meta.children[1].textContent, 'Manual');
});

test('display controls show temporary sample text only while an empty display is being adjusted', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');
  const viewPanel = createNode('aside');
  const viewButton = createNode('button');
  const closeViewPanel = createNode('button');

  const ctx = {
    state: {
      transcriptItems: [],
      viewPanelOpen: false,
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: {
      transcriptViewport,
      transcriptStack,
      viewPanel,
      viewButton,
      closeViewPanel
    }
  };

  setViewPanelOpen(ctx, true);

  const card = transcriptStack.children[0];
  const body = card.children[1];

  assert.equal(transcriptStack.children.length, 1);
  assert.equal(card.className.includes('transcript-item--sample'), true);
  assert.equal(card.dataset.sample, 'true');
  assert.match(body.textContent, /sample text appears here/i);

  setViewPanelOpen(ctx, false);

  assert.equal(transcriptStack.children.length, 0);
});

test('display controls keep existing transcript text instead of showing sample text', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');
  const viewPanel = createNode('aside');
  const viewButton = createNode('button');
  const closeViewPanel = createNode('button');

  const ctx = {
    state: {
      transcriptItems: [
        { id: 'real-one', mode: 'speaker', text: 'Real meeting text.', createdAt: 1, source: 'ai' }
      ],
      viewPanelOpen: false,
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: {
      transcriptViewport,
      transcriptStack,
      viewPanel,
      viewButton,
      closeViewPanel
    }
  };

  setViewPanelOpen(ctx, true);

  const card = transcriptStack.children[0];
  const body = card.children[1];

  assert.equal(transcriptStack.children.length, 1);
  assert.equal(card.className.includes('transcript-item--sample'), false);
  assert.equal(body.textContent, 'Real meeting text.');
});

function createSettingsSectionNode(section, { hidden = false } = {}) {
  const node = createNode('section');
  node.dataset.settingsSection = section;
  node.hidden = hidden;
  return node;
}

function createSettingsNavNode(section) {
  const node = createNode('button');
  node.dataset.settingsNav = section;
  return node;
}

function createSettingsCtx(stateOverrides = {}) {
  const sections = ['alerts', 'timing', 'transcription', 'summaries', 'services', 'tools'];
  const settingsSections = sections.map((section) => createSettingsSectionNode(section, { hidden: true }));
  const settingsNavButtons = sections.map((section) => createSettingsNavNode(section));

  return {
    state: {
      openAiReady: true,
      anthropicReady: true,
      ...stateOverrides
    },
    dom: {
      settingsSections,
      settingsNavButtons
    }
  };
}

test('getDefaultSettingsSection picks Timing when there are no alerts', () => {
  const ctx = createSettingsCtx({ openAiReady: true, anthropicReady: true });
  assert.equal(getDefaultSettingsSection(ctx), 'timing');
});

test('getDefaultSettingsSection picks Alerts when the alert badge is lit', () => {
  const ctx = createSettingsCtx({ openAiReady: false, anthropicReady: true });
  assert.equal(getDefaultSettingsSection(ctx), 'alerts');
});

test('setSettingsSection shows only the requested section and marks the matching nav item current', () => {
  const ctx = createSettingsCtx({ openAiReady: true, anthropicReady: true });

  setSettingsSection(ctx, 'transcription');

  for (const node of ctx.dom.settingsSections) {
    assert.equal(node.hidden, node.dataset.settingsSection !== 'transcription');
  }

  for (const button of ctx.dom.settingsNavButtons) {
    const expectedCurrent = button.dataset.settingsNav === 'transcription' ? 'true' : 'false';
    assert.equal(button.attributes['aria-current'], expectedCurrent);
  }
});

test('setSettingsSection keeps the alerts section hidden when there are no alerts even if selected directly', () => {
  const ctx = createSettingsCtx({ openAiReady: true, anthropicReady: true });

  setSettingsSection(ctx, 'alerts');

  const alertsNode = ctx.dom.settingsSections.find((node) => node.dataset.settingsSection === 'alerts');
  assert.equal(alertsNode.hidden, true);
});

test('setSettingsSection reveals the alerts section when selected while alerts are active', () => {
  const ctx = createSettingsCtx({ openAiReady: false, anthropicReady: true });

  setSettingsSection(ctx, 'alerts');

  const alertsNode = ctx.dom.settingsSections.find((node) => node.dataset.settingsSection === 'alerts');
  assert.equal(alertsNode.hidden, false);
});

test('setSettingsOpen defaults to the Alerts section when opening with an active alert', () => {
  const ctx = createSettingsCtx({ openAiReady: false, anthropicReady: true });
  ctx.dom.settingsPanel = createNode('dialog');
  ctx.dom.settingsPanel.hidden = true;

  setSettingsOpen(ctx, true);

  const alertsNode = ctx.dom.settingsSections.find((node) => node.dataset.settingsSection === 'alerts');
  assert.equal(alertsNode.hidden, false);
  const alertsNav = ctx.dom.settingsNavButtons.find((node) => node.dataset.settingsNav === 'alerts');
  assert.equal(alertsNav.attributes['aria-current'], 'true');
});

test('setSettingsOpen defaults to the Timing section when opening with no active alert', () => {
  const ctx = createSettingsCtx({ openAiReady: true, anthropicReady: true });
  ctx.dom.settingsPanel = createNode('dialog');
  ctx.dom.settingsPanel.hidden = true;

  setSettingsOpen(ctx, true);

  const timingNode = ctx.dom.settingsSections.find((node) => node.dataset.settingsSection === 'timing');
  assert.equal(timingNode.hidden, false);
  const timingNav = ctx.dom.settingsNavButtons.find((node) => node.dataset.settingsNav === 'timing');
  assert.equal(timingNav.attributes['aria-current'], 'true');
});

test('setSettingsOpen renders the ready check rows so they reflect the current state on open', () => {
  const originalWindow = global.window;
  global.window = {};

  try {
    const ctx = createSettingsCtx({
      transcriptionSource: 'browser',
      summarizationSource: 'openai',
      openAiReady: false,
      anthropicReady: false
    });
    ctx.dom.settingsPanel = createNode('dialog');
    ctx.dom.settingsPanel.hidden = true;
    ctx.dom.readyCheckMicDot = createStatusNode('span');
    ctx.dom.readyCheckMicFix = createNode('div');
    ctx.dom.readyCheckAiDot = createStatusNode('span');
    ctx.dom.readyCheckAiFix = createNode('div');
    ctx.dom.readyCheckDisplayDot = createStatusNode('span');
    ctx.dom.readyCheckDisplayFix = createNode('div');

    setSettingsOpen(ctx, true);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-not-ready'), true);
    assert.match(ctx.dom.readyCheckMicFix.textContent, /can't listen/i);
  } finally {
    global.window = originalWindow;
  }
});

function createStatusNode(tagName = 'div') {
  const classes = new Set();
  const node = createNode(tagName);
  node.classList = {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    toggle(name, force) {
      const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
      if (shouldAdd) classes.add(name);
      else classes.delete(name);
      return shouldAdd;
    },
    contains(name) {
      return classes.has(name);
    }
  };
  return node;
}

function createStatusCtx() {
  return {
    state: {},
    dom: {
      status: createStatusNode(),
      railStatusDot: createStatusNode('span'),
      railStatusWord: createStatusNode('span')
    }
  };
}

test('updateStatus always writes the diagnostics status text', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'Summarizing...');

  assert.equal(ctx.dom.status.textContent, 'Summarizing...');
  assert.equal(ctx.dom.railStatusWord.textContent, '');
  assert.equal(ctx.dom.railStatusDot.classList.contains('is-level-listening'), false);
});

test('updateStatus with a level sets the rail dot class and word without changing the diagnostics behavior', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'Listening.', { level: 'listening' });

  assert.equal(ctx.dom.status.textContent, 'Listening.');
  assert.equal(ctx.dom.railStatusWord.textContent, 'Listening');
  assert.equal(ctx.dom.railStatusDot.classList.contains('is-level-listening'), true);
  assert.equal(ctx.state.railStatusLevel, 'listening');
});

test('updateStatus switches the rail dot level cleanly between calls', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'Listening.', { level: 'listening' });
  updateStatus(ctx, 'AI paused.', { level: 'paused' });

  assert.equal(ctx.dom.railStatusWord.textContent, 'Paused');
  assert.equal(ctx.dom.railStatusDot.classList.contains('is-level-listening'), false);
  assert.equal(ctx.dom.railStatusDot.classList.contains('is-level-paused'), true);
});

test('updateStatus without a level leaves the previously set indicator untouched', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'Listening.', { level: 'listening' });
  updateStatus(ctx, 'Added: hello there');

  assert.equal(ctx.dom.status.textContent, 'Added: hello there');
  assert.equal(ctx.dom.railStatusWord.textContent, 'Listening');
  assert.equal(ctx.dom.railStatusDot.classList.contains('is-level-listening'), true);
});

function createReadyCheckCtx(stateOverrides = {}) {
  return {
    state: {
      transcriptionSource: 'browser',
      summarizationSource: 'openai',
      openAiReady: false,
      anthropicReady: false,
      ...stateOverrides
    },
    dom: {
      readyCheckMicDot: createStatusNode('span'),
      readyCheckMicFix: createNode('div'),
      readyCheckAiDot: createStatusNode('span'),
      readyCheckAiFix: createNode('div'),
      readyCheckDisplayDot: createStatusNode('span'),
      readyCheckDisplayFix: createNode('div')
    }
  };
}

test('renderReadyCheck marks the microphone row red with a plain fix when browser speech is unavailable and OpenAI transcription is not ready', () => {
  const originalWindow = global.window;
  global.window = {};

  try {
    const ctx = createReadyCheckCtx({ transcriptionSource: 'browser', openAiReady: false });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-ready'), false);
    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-not-ready'), true);
    assert.match(ctx.dom.readyCheckMicFix.textContent, /can't listen/i);
    assert.equal(ctx.dom.readyCheckMicFix.hidden, false);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck marks the microphone row green when browser speech is available', () => {
  const originalWindow = global.window;
  global.window = { SpeechRecognition: function SpeechRecognition() {} };

  try {
    const ctx = createReadyCheckCtx({ transcriptionSource: 'browser', openAiReady: false });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-ready'), true);
    assert.equal(ctx.dom.readyCheckMicFix.textContent, '');
    assert.equal(ctx.dom.readyCheckMicFix.hidden, true);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck marks the microphone row green when the selected transcription source is OpenAI and ready, even without browser speech', () => {
  const originalWindow = global.window;
  global.window = {};

  try {
    const ctx = createReadyCheckCtx({ transcriptionSource: 'openai', openAiReady: true });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-ready'), true);
    assert.equal(ctx.dom.readyCheckMicFix.hidden, true);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck marks the AI summaries row red with a plain fix when the active summary provider has no key', () => {
  const originalWindow = global.window;
  global.window = {};

  try {
    const ctx = createReadyCheckCtx({ summarizationSource: 'openai', openAiReady: false, anthropicReady: true });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckAiDot.classList.contains('is-ready'), false);
    assert.equal(ctx.dom.readyCheckAiDot.classList.contains('is-not-ready'), true);
    assert.match(ctx.dom.readyCheckAiFix.textContent, /openai key is missing/i);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck marks the AI summaries row green when the active Claude provider is ready', () => {
  const originalWindow = global.window;
  global.window = {};

  try {
    const ctx = createReadyCheckCtx({ summarizationSource: 'claude', openAiReady: false, anthropicReady: true });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckAiDot.classList.contains('is-ready'), true);
    assert.equal(ctx.dom.readyCheckAiFix.hidden, true);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck marks the AI summaries row red for Claude with a plain fix when Claude has no key', () => {
  const originalWindow = global.window;
  global.window = {};

  try {
    const ctx = createReadyCheckCtx({ summarizationSource: 'claude', openAiReady: true, anthropicReady: false });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckAiDot.classList.contains('is-ready'), false);
    assert.match(ctx.dom.readyCheckAiFix.textContent, /claude key is missing/i);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck marks the TV display row green with no fix text', () => {
  const originalWindow = global.window;
  global.window = {};

  try {
    const ctx = createReadyCheckCtx();

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckDisplayDot.classList.contains('is-ready'), true);
    assert.equal(ctx.dom.readyCheckDisplayFix.textContent, '');
    assert.equal(ctx.dom.readyCheckDisplayFix.hidden, true);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck reflects an all-green state when browser speech is available and both providers are ready', () => {
  const originalWindow = global.window;
  global.window = { SpeechRecognition: function SpeechRecognition() {} };

  try {
    const ctx = createReadyCheckCtx({
      transcriptionSource: 'browser',
      summarizationSource: 'openai',
      openAiReady: true,
      anthropicReady: true
    });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-ready'), true);
    assert.equal(ctx.dom.readyCheckAiDot.classList.contains('is-ready'), true);
    assert.equal(ctx.dom.readyCheckDisplayDot.classList.contains('is-ready'), true);
  } finally {
    global.window = originalWindow;
  }
});
