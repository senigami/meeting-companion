import test from 'node:test';
import assert from 'node:assert/strict';

import {
  flashRailNote,
  renderDisplay,
  renderReadyCheck,
  setViewPanelOpen,
  setQuickPanelOpen,
  setSettingsOpen,
  setSettingsSection,
  getDefaultSettingsSection,
  syncQuickPanelBreakpoint,
  updateStatus
} from '../../../public/controller/view.js';
import { appendTranscriptItems } from '../../../public/services/transcript-display.js';

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

// Issue #35: closing a panel while a control inside it is focused must move focus out before
// the panel is hidden, and the panel itself must end up inert -- Chrome refuses aria-hidden (and
// warns) on a container that still contains the focused element, so the old behaviour was
// whatever the browser decided rather than something chosen.
function createFocusableNode(tagName = 'button') {
  const node = createNode(tagName);
  node.focusCalls = 0;
  node.blurCalls = 0;
  node.focus = () => {
    node.focusCalls += 1;
    global.document.activeElement = node;
  };
  node.blur = () => {
    node.blurCalls += 1;
    if (global.document.activeElement === node) {
      global.document.activeElement = null;
    }
  };
  return node;
}

function createContainerNode(tagName = 'div') {
  const node = createNode(tagName);
  node.contains = (candidate) => node.children.includes(candidate);
  return node;
}

test('closing the view panel while the close button holds focus moves focus out first, then marks the panel inert', () => {
  const originalDocument = global.document;

  const viewPanel = createContainerNode('aside');
  const viewButton = createFocusableNode('button');
  const closeViewPanel = createFocusableNode('button');
  viewPanel.children.push(closeViewPanel);

  global.document = { activeElement: closeViewPanel };

  try {
    const ctx = {
      state: { viewPanelOpen: true, transcriptItems: [], stickToBottom: true, prefersReducedMotion: true },
      dom: { viewPanel, viewButton, closeViewPanel, transcriptViewport: createNode('div'), transcriptStack: createNode('div') }
    };

    setViewPanelOpen(ctx, false);

    assert.notEqual(global.document.activeElement, closeViewPanel, 'focus must move out of the panel before it is hidden');
    assert.equal(viewPanel.inert, true, 'the closed panel must be inert');
  } finally {
    global.document = originalDocument;
  }
});

// Issue #82 regression: above 900px `.drawerContent` is `display: contents`, so #quickPanel is
// not a closed drawer at all -- it's the permanent desktop rail. `inert` must only be written
// when the drawer breakpoint (<=900px) is actually active; on desktop the panel is always
// "closed" (quickPanelOpen starts false) but must never go inert, or the whole rail goes dead.
function withMatchMedia(matches, fn) {
  const originalMatchMedia = global.matchMedia;
  global.matchMedia = (query) => ({
    matches: query.includes('900px') ? matches : false,
    addEventListener() {},
    removeEventListener() {}
  });
  try {
    return fn();
  } finally {
    global.matchMedia = originalMatchMedia;
  }
}

test('closing the quick panel at the mobile drawer breakpoint (<=900px) moves focus out first, then marks the panel inert', () => {
  const originalDocument = global.document;

  const quickPanel = createContainerNode('div');
  const quickPanelToggle = createFocusableNode('button');
  const startListening = createFocusableNode('button');
  quickPanel.children.push(startListening);

  global.document = { activeElement: startListening };

  try {
    withMatchMedia(true, () => {
      const ctx = {
        state: { quickPanelOpen: true },
        dom: { quickPanel, quickPanelToggle, startListening }
      };

      setQuickPanelOpen(ctx, false);

      assert.notEqual(global.document.activeElement, startListening, 'focus must move out of the panel before it is hidden');
      assert.equal(quickPanel.inert, true, 'the closed mobile drawer must be inert');
    });
  } finally {
    global.document = originalDocument;
  }
});

test('the quick panel never goes inert above the 900px drawer breakpoint, even while "closed"', () => {
  const originalDocument = global.document;

  const quickPanel = createContainerNode('div');
  const quickPanelToggle = createFocusableNode('button');
  const startListening = createFocusableNode('button');
  quickPanel.children.push(startListening);

  global.document = { activeElement: null };

  try {
    withMatchMedia(false, () => {
      const ctx = {
        state: { quickPanelOpen: false },
        dom: { quickPanel, quickPanelToggle, startListening }
      };

      // Boot calls setQuickPanelOpen(ctx, false) unconditionally; on desktop this must be a no-op
      // for inertness, because #quickPanel is `display: contents` -- its children are the
      // permanent visible rail, not a hidden drawer.
      setQuickPanelOpen(ctx, false);

      assert.equal(quickPanel.inert, false, 'the desktop rail must never be inert');

      startListening.focus();
      assert.equal(global.document.activeElement, startListening, '#startListening must stay focusable on desktop');
    });
  } finally {
    global.document = originalDocument;
  }
});

// Issue #84. Open the drawer at mobile width, resize past 900px, and the full-viewport backdrop
// stays up while #quickPanelToggle -- the only visible control that dismisses it -- is not rendered
// at that width. The operator is left with a dimmed screen and nothing to click.
test('crossing to desktop with the quick drawer open closes it, so the backdrop cannot trap the operator', () => {
  const originalDocument = global.document;

  const quickPanel = createContainerNode('div');
  const quickPanelToggle = createFocusableNode('button');
  const quickPanelBackdrop = createNode('div');
  quickPanelBackdrop.hidden = false;

  global.document = { activeElement: null };

  try {
    withMatchMedia(false, () => {
      const ctx = {
        state: { quickPanelOpen: true },
        dom: { quickPanel, quickPanelToggle, quickPanelBackdrop }
      };

      syncQuickPanelBreakpoint(ctx);

      // The backdrop is the trap, so it is what gets asserted -- not merely the state flag that
      // is supposed to drive it.
      assert.equal(quickPanelBackdrop.hidden, true, 'the backdrop must be gone once there is no drawer');
      assert.equal(ctx.state.quickPanelOpen, false, 'the drawer must not stay "open" at a width with no drawer');
      assert.equal(quickPanel.inert, false, 'the desktop rail must never be inert');
    });
  } finally {
    global.document = originalDocument;
  }
});

// The DOM stubs above are deliberately thin, which means a test can "pass" because an incomplete
// stub threw somewhere incidental rather than because an assertion held. These two resync tests
// need the opposite: enough of a stub that the old re-entering behaviour runs to completion, so
// what catches it is an assertion about what it did, not a TypeError on the way.
function createSheetNode() {
  const node = createContainerNode('div');
  node.style = {};
  node.offsetHeight = 0;
  return node;
}

function withSyncRaf(fn) {
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { callback(); };
  try {
    return fn();
  } finally {
    globalThis.requestAnimationFrame = original;
  }
}

test('crossing the breakpoint with the quick drawer closed only resyncs inert -- it does not re-enter the open path', () => {
  const originalDocument = global.document;

  const quickPanel = createSheetNode();
  const quickPanelToggle = createFocusableNode('button');
  const quickPanelHandle = createFocusableNode('button');
  const quickPanelBackdrop = createNode('div');
  quickPanelBackdrop.hidden = true;

  global.document = { activeElement: null };

  try {
    withMatchMedia(true, () => withSyncRaf(() => {
      const ctx = {
        state: { quickPanelOpen: false },
        dom: { quickPanel, quickPanelToggle, quickPanelHandle, quickPanelBackdrop }
      };

      syncQuickPanelBreakpoint(ctx);

      assert.equal(quickPanel.inert, true, 'a still-closed mobile drawer must be inert');
      // setQuickPanelOpen unconditionally writes aria-expanded/aria-pressed/aria-label on the
      // toggle. An untouched toggle is therefore proof the whole setter was never re-entered,
      // which is the thing this test is named for -- the inert assertion above holds either way.
      assert.equal(
        quickPanelToggle.attributes['aria-expanded'],
        undefined,
        'a pure inert resync must not rewrite the toggle: that means the whole setter ran'
      );
      assert.equal(quickPanelBackdrop.hidden, true, 'a closed drawer keeps its backdrop hidden');
    }));
  } finally {
    global.document = originalDocument;
  }
});

test('crossing to mobile with the quick drawer open leaves it open, not inert, and does not steal focus', () => {
  const originalDocument = global.document;

  const quickPanel = createSheetNode();
  const quickPanelToggle = createFocusableNode('button');
  const quickPanelHandle = createFocusableNode('button');
  const quickPanelBackdrop = createNode('div');
  quickPanelBackdrop.hidden = false;

  global.document = { activeElement: null };

  try {
    withMatchMedia(true, () => withSyncRaf(() => {
      const ctx = {
        state: { quickPanelOpen: true },
        dom: { quickPanel, quickPanelToggle, quickPanelHandle, quickPanelBackdrop }
      };

      syncQuickPanelBreakpoint(ctx);

      // The close is specifically a desktop-crossing rule. Rotating a tablet back to portrait
      // must not slam a drawer the operator is using.
      assert.equal(ctx.state.quickPanelOpen, true, 'an open drawer stays open at a width that has one');
      assert.equal(quickPanel.inert, false, 'an open drawer is never inert');
      assert.equal(quickPanelBackdrop.hidden, false, 'an open drawer keeps its backdrop');
      // The old listener re-entered the setter, whose open branch focuses the drag handle on the
      // next frame. Resizing a window must never move the operator's focus.
      assert.equal(quickPanelHandle.focusCalls, 0, 'a breakpoint resync must not steal focus');
    }));
  } finally {
    global.document = originalDocument;
  }
});

test('closing the settings dialog while a control inside it holds focus moves focus out first', () => {
  const originalDocument = global.document;

  const settingsPanel = createContainerNode('dialog');
  settingsPanel.hidden = false;
  settingsPanel.open = true;
  settingsPanel.close = () => { settingsPanel.open = false; };
  const settingsButton = createFocusableNode('button');
  const closeSettings = createFocusableNode('button');
  settingsPanel.children.push(closeSettings);

  global.document = { activeElement: closeSettings };

  try {
    const ctx = {
      state: { settingsOpen: true },
      dom: { settingsPanel, settingsButton, closeSettings }
    };

    setSettingsOpen(ctx, false);

    assert.notEqual(global.document.activeElement, closeSettings, 'focus must move out of the dialog before it is hidden/closed');
  } finally {
    global.document = originalDocument;
  }
});

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
          { id: 'two', mode: 'speaker', text: 'Second thought.', createdAt: 2, source: 'manual' }
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
    frames.shift()(500);
    assert.equal(transcriptViewport.scrollTop > 0, true);
    frames.shift()(1000);

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

test('renderDisplay marks the first card after a mode change as a mode boundary, not the cards before or after it', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');

  const ctx = {
    state: {
      transcriptItems: [
        { id: 'one', mode: 'speaker', text: 'a', createdAt: 1, source: 'ai' },
        { id: 'two', mode: 'speaker', text: 'b', createdAt: 2, source: 'ai' },
        { id: 'three', mode: 'information', text: 'c', createdAt: 3, source: 'ai' },
        { id: 'four', mode: 'information', text: 'd', createdAt: 4, source: 'ai' }
      ],
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: { transcriptViewport, transcriptStack }
  };

  renderDisplay(ctx);

  const children = [...transcriptStack.children];
  assert.equal(children.length, 5, 'four cards plus one standalone divider before the mode change');
  assert.equal(children[0].className.includes('transcript-mode-divider'), false);
  assert.equal(children[1].className.includes('transcript-mode-divider'), false);
  assert.equal(children[2].className.includes('transcript-mode-divider'), true,
    'the divider sits between the last speaker card and the first information card');
  assert.equal(children[2].className.includes('transcript-item--information'), true,
    'colored to the mode being entered, not the one being left');
  assert.equal(children[3].className.includes('transcript-mode-divider'), false);
  assert.equal(children[4].className.includes('transcript-mode-divider'), false);
});

test('renderDisplay alternates the speaker-alt accent within a run of same-mode speaker cards, and resets outside speaker mode', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');

  const ctx = {
    state: {
      transcriptItems: [
        { id: 'one', mode: 'speaker', text: 'a', createdAt: 1, source: 'ai', speaker: 'Alice' },
        { id: 'two', mode: 'speaker', text: 'b', createdAt: 2, source: 'ai', speaker: 'Alice' },
        { id: 'three', mode: 'speaker', text: 'c', createdAt: 3, source: 'ai', speaker: 'Bob' },
        { id: 'four', mode: 'information', text: 'd', createdAt: 4, source: 'ai' },
        { id: 'five', mode: 'speaker', text: 'e', createdAt: 5, source: 'ai', speaker: 'Carol' }
      ],
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: { transcriptViewport, transcriptStack }
  };

  renderDisplay(ctx);

  // Mode-change dividers are now standalone sibling nodes (not a class on the card), so filter them
  // out here -- this test is about which CARDS get the alternation class, not about divider placement.
  const cards = [...transcriptStack.children].filter((el) => !el.className.includes('transcript-mode-divider'));
  const [one, two, three, four, five] = cards;
  assert.equal(one.className.includes('transcript-item--speaker-alt'), false);
  assert.equal(two.className.includes('transcript-item--speaker-alt'), false);
  assert.equal(three.className.includes('transcript-item--speaker-alt'), true);
  assert.equal(four.className.includes('transcript-item--speaker-alt'), false);
  // A new speaker follows an information-mode card, not a speaker-mode one, so the alternation
  // sequence restarts rather than continuing Bob's toggled-on state across the mode switch.
  assert.equal(five.className.includes('transcript-item--speaker-alt'), false);
});

test('a header card (program-tab send button) renders only the icon, mode label, and text -- no speaker row, no timestamp', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');

  const ctx = {
    state: {
      transcriptItems: [
        {
          id: 'header-one',
          mode: 'information',
          text: 'Announcements',
          createdAt: 5,
          source: 'manual',
          speaker: 'Announcements',
          isHeader: true
        }
      ],
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: { transcriptViewport, transcriptStack }
  };

  renderDisplay(ctx);

  const card = transcriptStack.children[0];
  const meta = card.children[0];

  assert.equal(card.className.includes('transcript-item--header'), true);
  assert.equal(card.className.includes('transcript-item--information'), true, 'still carries its mode accent');
  assert.equal(meta.children[0].className, 'transcript-icon icon-information');
  assert.equal(meta.children[1].textContent, 'Information');
  assert.equal(meta.children[2].className, 'transcript-meta-value', 'text sits in the label row, not a separate body');
  assert.equal(meta.children[2].textContent, 'Announcements');
  assert.equal(meta.children.length, 3, 'icon, mode label, and the text value -- no speaker row, no timestamp');
  assert.equal(card.children.length, 2, 'no separate body paragraph -- meta row and the delete button only');
});

test('a mode-boundary divider fires correctly around a header card: into it and out of it', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');

  const ctx = {
    state: {
      transcriptItems: [
        { id: 'one', mode: 'speaker', text: 'a', createdAt: 1, source: 'ai' },
        { id: 'header', mode: 'information', text: 'Announcements', createdAt: 2, source: 'manual', isHeader: true },
        { id: 'three', mode: 'prayer', text: 'c', createdAt: 3, source: 'ai' }
      ],
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: { transcriptViewport, transcriptStack }
  };

  renderDisplay(ctx);

  const children = [...transcriptStack.children];
  assert.equal(children.length, 5, 'three cards plus a divider before the header and a divider after it');
  assert.equal(children[0].className.includes('transcript-mode-divider'), false);
  assert.equal(children[1].className.includes('transcript-mode-divider'), true,
    'a divider precedes the header card, since it differs in mode from what came before it');
  assert.equal(children[1].className.includes('transcript-item--information'), true);
  assert.equal(children[2].className.includes('transcript-item--header'), true);
  assert.equal(children[3].className.includes('transcript-mode-divider'), true,
    'a divider also precedes the card right after the header card, since that one differs in mode too');
  assert.equal(children[3].className.includes('transcript-item--prayer'), true);
  assert.equal(children[4].className.includes('transcript-mode-divider'), false);
});

// Issue #40: a speaker label reads as extra load for someone who reads roughly one word every two
// seconds, so it must appear ONLY on the card where the speaker actually changed -- never repeated
// on every card that follows, and never invented as "Unknown" when the operator left it blank.
function findSpeakerNode(card) {
  const meta = card.children[0];
  return meta.children.find((node) => node.className === 'transcript-speaker');
}

test('a speaker label shows on every card for that speaker, not just the first (2026-08-09 reversal of #40)', () => {
  // Steve's design: the label is a persistent corner nameplate, not a sentence -- a reader glances
  // at the corner and only needs to notice when it changes. Suppressing repeats forced them to
  // remember who was talking instead, which is more cognitive load, not less.
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');

  const ctx = {
    state: {
      transcriptItems: [
        { id: 'a1', mode: 'speaker', text: 'First line.', createdAt: 1, source: 'ai', speaker: 'Bro. Ashcroft' },
        { id: 'a2', mode: 'speaker', text: 'Second line, same speaker.', createdAt: 2, source: 'ai', speaker: 'Bro. Ashcroft' },
        { id: 'a3', mode: 'speaker', text: 'Third line, same speaker.', createdAt: 3, source: 'ai', speaker: 'Bro. Ashcroft' }
      ],
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: { transcriptViewport, transcriptStack }
  };

  renderDisplay(ctx);

  const [first, second, third] = transcriptStack.children;
  assert.equal(findSpeakerNode(first)?.textContent, 'Bro. Ashcroft');
  assert.equal(findSpeakerNode(second)?.textContent, 'Bro. Ashcroft', 'a repeated speaker is still labelled every card');
  assert.equal(findSpeakerNode(third)?.textContent, 'Bro. Ashcroft', 'still labelled on the third repeat');
});

test('an empty speaker never renders a label, and never becomes "Unknown"', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');

  const ctx = {
    state: {
      transcriptItems: [
        { id: 'b1', mode: 'speaker', text: 'Nobody named.', createdAt: 1, source: 'ai', speaker: '' }
      ],
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: { transcriptViewport, transcriptStack }
  };

  renderDisplay(ctx);

  const card = transcriptStack.children[0];
  assert.equal(findSpeakerNode(card), undefined, 'an empty name means no label at all, never a placeholder');
});

test('a speaker changing back after a gap re-labels the card, and label detection walks display order card-to-card', () => {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');

  const ctx = {
    state: {
      transcriptItems: [
        { id: 'c1', mode: 'speaker', text: 'Alpha speaks.', createdAt: 1, source: 'ai', speaker: 'Alpha' },
        { id: 'c2', mode: 'speaker', text: 'Beta speaks.', createdAt: 2, source: 'ai', speaker: 'Beta' },
        { id: 'c3', mode: 'speaker', text: 'Alpha again.', createdAt: 3, source: 'ai', speaker: 'Alpha' }
      ],
      stickToBottom: true,
      prefersReducedMotion: true
    },
    dom: { transcriptViewport, transcriptStack }
  };

  renderDisplay(ctx);

  const [first, second, third] = transcriptStack.children;
  assert.equal(findSpeakerNode(first)?.textContent, 'Alpha');
  assert.equal(findSpeakerNode(second)?.textContent, 'Beta');
  assert.equal(findSpeakerNode(third)?.textContent, 'Alpha', 'Alpha returning after Beta is a real change again');
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
      // A provider only raises an alert when a selected source needs it, so these fixtures carry a
      // realistic selection: without one, an unconfigured provider is correctly silent and the
      // alert-section tests below would be asserting against an alert that should never fire.
      transcriptionSource: 'browser',
      summarizationSource: 'openai',
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

test('setSettingsSection hides the Alerts tab itself when there is nothing to show', () => {
  const ctx = createSettingsCtx({ openAiReady: true, anthropicReady: true });

  setSettingsSection(ctx, 'timing');

  const alertsNav = ctx.dom.settingsNavButtons.find((node) => node.dataset.settingsNav === 'alerts');
  assert.equal(alertsNav.hidden, true, 'an always-visible tab that opens on an empty section reads as broken');
});

test('setSettingsSection shows the Alerts tab when an alert is active', () => {
  const ctx = createSettingsCtx({ openAiReady: false, anthropicReady: true });

  setSettingsSection(ctx, 'alerts');

  const alertsNav = ctx.dom.settingsNavButtons.find((node) => node.dataset.settingsNav === 'alerts');
  assert.equal(alertsNav.hidden, false);
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
      railStatusWord: createStatusNode('span'),
      railNote: createStatusNode('div')
    }
  };
}

test('updateStatus with a silence level shows a gentler, non-alert rail note distinct from a problem', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'No transcript activity for 45s. Check the microphone.', { level: 'silence' });

  assert.equal(ctx.dom.railStatusWord.textContent, 'Check mic');
  assert.equal(ctx.dom.railStatusDot.classList.contains('is-level-silence'), true);
  assert.equal(ctx.dom.railNote.textContent, '⏱ No transcript activity for 45s. Check the microphone.');
  assert.equal(ctx.dom.railNote.classList.contains('is-silence'), true);
  assert.equal(ctx.dom.railNote.classList.contains('is-problem'), false);
  // Unconfirmed, not fatal -- polite/status, not the assertive/alert used for a real problem.
  assert.equal(ctx.dom.railNote.attributes.role, 'status');
  assert.equal(ctx.dom.railNote.attributes['aria-live'], 'polite');
});

test('a problem status auto-expands a collapsed rail once so the reason is readable', () => {
  const originalDocument = global.document;
  const classes = new Set();
  global.document = {
    documentElement: {
      classList: {
        add(name) {
          classes.add(name);
        },
        remove(name) {
          classes.delete(name);
        },
        contains(name) {
          return classes.has(name);
        }
      },
      style: {
        setProperty() {},
        getPropertyValue() {
          return '';
        }
      }
    }
  };

  try {
    const ctx = createStatusCtx();
    ctx.state.railCollapsed = true;
    ctx.dom.railCollapseToggle = createStatusNode('button');

    updateStatus(ctx, 'Microphone stopped.', { level: 'problem' });

    assert.equal(ctx.state.railCollapsed, false);
    assert.ok(!classes.has('is-rail-collapsed'));
  } finally {
    global.document = originalDocument;
  }
});

test('a silence warning also auto-expands a collapsed rail, since a note nobody can read helps nobody', () => {
  const originalDocument = global.document;
  const classes = new Set(['is-rail-collapsed']);
  global.document = {
    documentElement: {
      classList: {
        add(name) {
          classes.add(name);
        },
        remove(name) {
          classes.delete(name);
        },
        contains(name) {
          return classes.has(name);
        }
      },
      style: {
        setProperty() {},
        getPropertyValue() {
          return '';
        }
      }
    }
  };

  try {
    const ctx = createStatusCtx();
    ctx.state.railCollapsed = true;
    ctx.dom.railCollapseToggle = createStatusNode('button');

    updateStatus(ctx, 'No transcript activity for 45s. Check the microphone.', { level: 'silence' });

    assert.equal(ctx.state.railCollapsed, false);
    assert.ok(!classes.has('is-rail-collapsed'));
  } finally {
    global.document = originalDocument;
  }
});

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

test('updateStatus mirrors a problem message into the rail note, which #status alone cannot show', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'Browser transcription stopped: not-allowed', { level: 'problem' });

  assert.equal(ctx.dom.railNote.textContent, '⚠ Browser transcription stopped: not-allowed');
  assert.equal(ctx.dom.railNote.classList.contains('is-problem'), true);
  // Assertive/alert for a genuine fatal failure -- see INV-10 -- not the polite/status level used
  // for benign Clear/Undo flashes.
  assert.equal(ctx.dom.railNote.attributes.role, 'alert');
  assert.equal(ctx.dom.railNote.attributes['aria-live'], 'assertive');
});

test('updateStatus keeps a repeated problem message visible even though the level did not change', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'First failure', { level: 'problem' });
  updateStatus(ctx, 'Second failure', { level: 'problem' });

  assert.equal(ctx.dom.railNote.textContent, '⚠ Second failure');
});

test('updateStatus clears the problem note once the level recovers', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'Browser transcription stopped: not-allowed', { level: 'problem' });
  updateStatus(ctx, 'Listening.', { level: 'listening' });

  assert.equal(ctx.dom.railNote.textContent, '');
  assert.equal(ctx.dom.railNote.classList.contains('is-problem'), false);
  assert.equal(ctx.state.railProblemNote, false);
  // Live region stays mounted (never re-hidden) and drops back to polite once the note is benign.
  assert.equal(ctx.dom.railNote.attributes.role, 'status');
  assert.equal(ctx.dom.railNote.attributes['aria-live'], 'polite');
});

test('a problem note does not auto-hide the way a flashed note does', () => {
  const ctx = createStatusCtx();
  const timers = [];

  updateStatus(ctx, 'Browser transcription stopped: not-allowed', {
    level: 'problem',
    clearTimeoutFn: (id) => timers.push(id)
  });

  assert.equal(ctx.state.railNoteTimer, null);
  assert.equal(ctx.dom.railNote.textContent, '⚠ Browser transcription stopped: not-allowed');
});

test('a silence level cannot silently clobber an already-confirmed problem', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'Falling behind live speech — some speech will be missing from the transcript', { level: 'problem' });
  updateStatus(ctx, 'No transcript activity for 45s. Check the microphone.', { level: 'silence' });

  assert.equal(ctx.state.railStatusLevel, 'problem');
  assert.equal(ctx.dom.railStatusWord.textContent, 'Problem');
  assert.equal(ctx.dom.railNote.textContent, '⚠ Falling behind live speech — some speech will be missing from the transcript');
  assert.equal(ctx.dom.railNote.classList.contains('is-problem'), true);
  assert.equal(ctx.dom.status.textContent, 'Falling behind live speech — some speech will be missing from the transcript');
});

test('a problem outranks silence but recovery to a normal level still clears the note honestly', () => {
  const ctx = createStatusCtx();

  updateStatus(ctx, 'Microphone stopped.', { level: 'problem' });
  updateStatus(ctx, 'No transcript activity for 45s.', { level: 'silence' });
  assert.equal(ctx.state.railStatusLevel, 'problem');

  // The condition itself clearing (not a weaker alarm) is what recovers the rail.
  updateStatus(ctx, 'Listening.', { level: 'listening' });

  assert.equal(ctx.state.railStatusLevel, 'listening');
  assert.equal(ctx.dom.railNote.textContent, '');
  assert.equal(ctx.dom.railNote.classList.contains('is-problem'), false);
});

test('flashRailNote restores an active silence note (text, class, urgency) once its own timer expires', () => {
  const ctx = createStatusCtx();
  const timers = [];
  const setTimeoutFn = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  const clearTimeoutFn = () => {};

  updateStatus(ctx, 'No transcript activity for 45s. Check the microphone.', { level: 'silence' });
  flashRailNote(ctx, 'Cleared 2 lines.', { setTimeoutFn, clearTimeoutFn });

  // While the flash is showing, it takes over the note completely (no gold styling on a benign
  // Clear/Undo message -- that would be its own dishonesty in the other direction).
  assert.equal(ctx.dom.railNote.textContent, 'Cleared 2 lines.');
  assert.equal(ctx.dom.railNote.classList.contains('is-silence'), false);
  assert.equal(ctx.dom.railNote.classList.contains('is-problem'), false);

  // The flash timer fires. The silence condition is still active (railStatusLevel never changed),
  // so the note must come back exactly as it was -- not stay blank forever.
  timers[0]();

  assert.equal(ctx.dom.railNote.textContent, '⏱ No transcript activity for 45s. Check the microphone.');
  assert.equal(ctx.dom.railNote.classList.contains('is-silence'), true);
  assert.equal(ctx.dom.railNote.attributes.role, 'status');
  assert.equal(ctx.dom.railNote.attributes['aria-live'], 'polite');
});

test('flashRailNote restores an active problem note as role="alert" once its own timer expires', () => {
  const ctx = createStatusCtx();
  const timers = [];
  const setTimeoutFn = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  const clearTimeoutFn = () => {};

  updateStatus(ctx, 'Microphone stopped.', { level: 'problem' });
  flashRailNote(ctx, 'Removed: "one"', { setTimeoutFn, clearTimeoutFn });
  timers[0]();

  assert.equal(ctx.dom.railNote.textContent, '⚠ Microphone stopped.');
  assert.equal(ctx.dom.railNote.classList.contains('is-problem'), true);
  assert.equal(ctx.dom.railNote.attributes.role, 'alert');
  assert.equal(ctx.dom.railNote.attributes['aria-live'], 'assertive');
});

test('a recovery landing inside a flash window still clears the persistent state it left behind', () => {
  const ctx = createStatusCtx();
  const timers = [];
  const setTimeoutFn = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  const clearTimeoutFn = () => {};
  ctx.state.railAutoExpandedLevels = new Set(['silence']);

  updateStatus(ctx, 'No transcript activity for 45s. Check the microphone.', { level: 'silence' });
  flashRailNote(ctx, 'Cleared 2 lines.', { setTimeoutFn, clearTimeoutFn });

  // Speech resumes while the Clear flash is still up -- a four-second window that a real service
  // hits routinely. The flash has already set railProblemNote false, so gating the cleanup on that
  // flag alone would skip it here and strand the auto-expand latch and the remembered note.
  updateStatus(ctx, 'Listening.', { level: 'listening' });
  timers[0]();

  assert.equal(ctx.state.railStatusLevel, 'listening');
  assert.equal(ctx.state.railPersistentNoteText, null);
  assert.equal(ctx.state.railAutoExpandedLevels.size, 0);
  assert.equal(ctx.dom.railNote.textContent, '');
  assert.equal(ctx.dom.railNote.classList.contains('is-silence'), false);
});

test('flashRailNote does not restore a stale note once the condition has actually cleared', () => {
  const ctx = createStatusCtx();
  const timers = [];
  const setTimeoutFn = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  const clearTimeoutFn = () => {};

  updateStatus(ctx, 'Microphone stopped.', { level: 'problem' });
  flashRailNote(ctx, 'Cleared 1 line.', { setTimeoutFn, clearTimeoutFn });
  // The problem clears for real while the flash is still showing.
  updateStatus(ctx, 'Listening.', { level: 'listening' });
  timers[0]();

  assert.equal(ctx.dom.railNote.textContent, '');
  assert.equal(ctx.dom.railNote.classList.contains('is-problem'), false);
});

test('flashRailNote takes over from a sticky problem note instead of layering on it', () => {
  const ctx = createStatusCtx();
  updateStatus(ctx, 'Browser transcription stopped: not-allowed', { level: 'problem' });

  flashRailNote(ctx, 'Cleared 2 lines.', { setTimeoutFn: () => 1, clearTimeoutFn: () => {} });

  assert.equal(ctx.dom.railNote.textContent, 'Cleared 2 lines.');
  assert.equal(ctx.dom.railNote.classList.contains('is-problem'), false);
  assert.equal(ctx.state.railProblemNote, false);
  assert.equal(ctx.dom.railNote.attributes.role, 'status');
  assert.equal(ctx.dom.railNote.attributes['aria-live'], 'polite');
});

function createRailNoteCtx() {
  return {
    state: {},
    dom: {
      railNote: createStatusNode('div')
    }
  };
}

test('flashRailNote shows the note text and clears it again after the timer fires', () => {
  const ctx = createRailNoteCtx();
  const timers = [];
  const setTimeoutFn = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  const clearTimeoutFn = () => {};

  flashRailNote(ctx, 'Cleared 2 lines.', { setTimeoutFn, clearTimeoutFn });

  assert.equal(ctx.dom.railNote.textContent, 'Cleared 2 lines.');

  timers[0]();

  // The live region itself is never re-hidden (see index.html/view.js) -- only its text empties,
  // so the node stays registered in the accessibility tree for the next announcement.
  assert.equal(ctx.dom.railNote.textContent, '');
});

test('flashRailNote clears any prior timer so rapid successive calls do not flicker', () => {
  const ctx = createRailNoteCtx();
  let nextId = 0;
  const cleared = [];
  const setTimeoutFn = () => {
    nextId += 1;
    return nextId;
  };
  const clearTimeoutFn = (id) => {
    cleared.push(id);
  };

  flashRailNote(ctx, 'Removed: "one"', { setTimeoutFn, clearTimeoutFn });
  const firstTimer = ctx.state.railNoteTimer;
  flashRailNote(ctx, 'Removed: "two"', { setTimeoutFn, clearTimeoutFn });

  assert.ok(cleared.includes(firstTimer));
  assert.equal(ctx.dom.railNote.textContent, 'Removed: "two"');
});

test('flashRailNote does nothing when there is no rail note element', () => {
  const ctx = { state: {}, dom: {} };

  assert.doesNotThrow(() => flashRailNote(ctx, 'Cleared 1 line.'));
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

test('renderReadyCheck marks the microphone row green when browser speech is available and the mic has been verified ready', () => {
  const originalWindow = global.window;
  global.window = { SpeechRecognition: function SpeechRecognition() {} };

  try {
    const ctx = createReadyCheckCtx({ transcriptionSource: 'browser', openAiReady: false, micReady: true });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-ready'), true);
    assert.equal(ctx.dom.readyCheckMicFix.textContent, '');
    assert.equal(ctx.dom.readyCheckMicFix.hidden, true);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck marks the microphone row green when the selected transcription source is OpenAI and the mic has been verified ready, even without browser speech', () => {
  const originalWindow = global.window;
  global.window = {};

  try {
    const ctx = createReadyCheckCtx({ transcriptionSource: 'openai', openAiReady: true, micReady: true });

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

test('renderReadyCheck reflects an all-green state when browser speech is available, the mic is verified ready, and both providers are ready', () => {
  const originalWindow = global.window;
  global.window = { SpeechRecognition: function SpeechRecognition() {} };

  try {
    const ctx = createReadyCheckCtx({
      transcriptionSource: 'browser',
      summarizationSource: 'openai',
      openAiReady: true,
      anthropicReady: true,
      micReady: true
    });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-ready'), true);
    assert.equal(ctx.dom.readyCheckAiDot.classList.contains('is-ready'), true);
    assert.equal(ctx.dom.readyCheckDisplayDot.classList.contains('is-ready'), true);
  } finally {
    global.window = originalWindow;
  }
});

// Regression for the 2026-07-30 bug: checkMicReady used to be a pure feature-detect
// (browserSpeechAvailable()) that never consulted permission or device state, so the row read
// green in Chrome with mic permission denied and every microphone unplugged.
test('renderReadyCheck marks the microphone row red when browser speech exists but the mic has not been verified ready (denied permission or no device)', () => {
  const originalWindow = global.window;
  global.window = { SpeechRecognition: function SpeechRecognition() {} };

  try {
    const ctx = createReadyCheckCtx({
      transcriptionSource: 'browser',
      micReady: false,
      micReadyReason: 'denied'
    });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-ready'), false);
    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-not-ready'), true);
    assert.match(ctx.dom.readyCheckMicFix.textContent, /blocked/i);
    assert.equal(ctx.dom.readyCheckMicFix.hidden, false);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck marks the microphone row red with a "no microphone" fix when permission is fine but no device was found', () => {
  const originalWindow = global.window;
  global.window = { SpeechRecognition: function SpeechRecognition() {} };

  try {
    const ctx = createReadyCheckCtx({
      transcriptionSource: 'browser',
      micReady: false,
      micReadyReason: 'no-device'
    });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-ready'), false);
    assert.match(ctx.dom.readyCheckMicFix.textContent, /no microphone was found/i);
  } finally {
    global.window = originalWindow;
  }
});

test('renderReadyCheck marks the microphone row green for the OpenAI transcription source once the mic is verified ready, even though the Web Speech API is absent', () => {
  const originalWindow = global.window;
  global.window = {};

  try {
    const ctx = createReadyCheckCtx({
      transcriptionSource: 'openai',
      openAiReady: true,
      micReady: true
    });

    renderReadyCheck(ctx);

    assert.equal(ctx.dom.readyCheckMicDot.classList.contains('is-ready'), true);
  } finally {
    global.window = originalWindow;
  }
});

// --- #81: the wall filling up must not jump the reader ----------------------------------------
//
// Steve, watching a real meeting: the scroll is smooth and easy to follow until a certain number of
// cards is reached, then it starts jumping -- because that is the point old cards begin being
// removed. Two distinct faults sat under that, and these pin both.

function createScrollHarness({ itemCount, stickToBottom = true, cardHeight = 0 }) {
  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');
  transcriptViewport.scrollTop = 0;
  transcriptViewport.clientHeight = 600;
  transcriptViewport.scrollHeight = 1600;

  const frames = [];
  const originals = {
    document: global.document,
    raf: global.requestAnimationFrame,
    caf: global.cancelAnimationFrame
  };
  global.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  global.cancelAnimationFrame = () => {};
  global.document = {
    createElement(tagName) {
      const node = createNode(tagName);
      if (tagName === 'article') node.querySelector = () => null;
      // Set at creation, not after the fact: the trim reads a node's height at the moment it removes
      // it, so a height assigned later is a height the code under test never saw.
      node.offsetHeight = cardHeight;
      return node;
    }
  };

  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${i}`, mode: 'speaker', text: `Thought number ${i}.`, createdAt: i, source: 'ai'
  }));

  const ctx = {
    state: { transcriptItems: items, stickToBottom, prefersReducedMotion: false },
    dom: { transcriptViewport, transcriptStack }
  };

  return {
    ctx,
    frames,
    transcriptStack,
    transcriptViewport,
    // Timestamps must ADVANCE. Feeding the same one every frame leaves elapsed at 0 forever and the
    // animation requests another frame each time, which is an infinite loop rather than a failure.
    runScrollToCompletion() {
      let now = 0;
      let guard = 0;
      while (frames.length) {
        if (++guard > 500) throw new Error('scroll animation did not settle');
        now += 200;
        frames.shift()(now);
      }
    },
    restore() {
      global.document = originals.document;
      global.requestAnimationFrame = originals.raf;
      global.cancelAnimationFrame = originals.caf;
    }
  };
}

// Fault one, and the reason it is timing and not just bookkeeping: taking the card off the top
// mid-scroll shrinks scrollHeight, the browser clamps scrollTop by the same amount, and the content
// the reader is following lurches. So the overflow must still be on screen while the scroll runs.
test('a card past the cap is still on the wall during the arrival scroll, and gone once it finishes', () => {
  const h = createScrollHarness({ itemCount: 26 });
  try {
    renderDisplay(h.ctx);

    assert.equal(h.transcriptStack.children.length, 26, 'nothing may be trimmed before the scroll runs');

    h.runScrollToCompletion();

    assert.equal(h.transcriptStack.children.length, 24, 'the overflow is dropped once the scroll has settled');
    assert.equal(h.ctx.state.transcriptItems.length, 24);
    assert.equal(h.ctx.state.transcriptItems[0].id, 'item-2', 'the OLDEST cards go, not the newest');
    assert.equal(h.ctx.state.transcriptItems[23].id, 'item-25');
  } finally {
    h.restore();
  }
});

// Fault two, which is the bigger one and is invisible from the couch: trimming at append time meant
// the previously rendered ids were no longer a PREFIX of the new ones, so renderDisplay fell off its
// append-only fast path onto the full-rebuild path -- permanently, from card 25 onward. Every
// arrival then destroyed and recreated all 24 cards, replaying all 24 entrance animations at once.
// That is the exact fault #13 was filed for. Asserting on node IDENTITY is the point: a rebuilt card
// looks identical and is a different object, which is what makes this regression silent.
test('a card that survives the trim is the same DOM node, never torn down and rebuilt', () => {
  const h = createScrollHarness({ itemCount: 25 });
  try {
    renderDisplay(h.ctx);
    h.runScrollToCompletion();

    const survivor = h.transcriptStack.children[h.transcriptStack.children.length - 1];
    assert.equal(survivor.dataset.itemId, 'item-24');

    h.ctx.state.transcriptItems = [
      ...h.ctx.state.transcriptItems,
      { id: 'item-25', mode: 'speaker', text: 'A new arrival.', createdAt: 25, source: 'ai' }
    ];
    renderDisplay(h.ctx);
    h.runScrollToCompletion();

    const stillThere = h.transcriptStack.children.find((node) => node.dataset.itemId === 'item-24');
    assert.equal(stillThere, survivor, 'the surviving card must be the SAME node object, not a rebuilt copy');
  } finally {
    h.restore();
  }
});

// The reader who has scrolled up gets no arrival scroll at all, so the overflow has to be drained
// somewhere or it grows without bound -- and draining it above them moves their text unless the
// removed height is subtracted from scrollTop by hand. The old eager trim never did this, so a
// reader re-reading during a busy stretch was quietly pushed along.
test('trimming above a reader who has scrolled up holds their place instead of moving their text', () => {
  const h = createScrollHarness({ itemCount: 26, stickToBottom: false, cardHeight: 40 });
  try {
    h.transcriptViewport.scrollTop = 900;

    renderDisplay(h.ctx);

    assert.equal(h.transcriptStack.children.length, 24);
    assert.equal(h.transcriptViewport.scrollTop, 820, '900 minus the 80px of card that was removed above them');
  } finally {
    h.restore();
  }
});

test('under the cap nothing is trimmed and no scroll position is touched', () => {
  const h = createScrollHarness({ itemCount: 5 });
  try {
    renderDisplay(h.ctx);
    h.runScrollToCompletion();
    assert.equal(h.transcriptStack.children.length, 5);
    assert.equal(h.ctx.state.transcriptItems.length, 5);
  } finally {
    h.restore();
  }
});

// The one above asserts node identity but builds ctx.state.transcriptItems by hand, so it never
// touches appendTranscriptItems -- and the bug lives in the INTERACTION between the two: the append
// trims, which makes the previous ids stop being a prefix, which makes renderDisplay rebuild. This
// test drives the real append path, and it is the one that actually fails against the old code.
test('growing the wall past the cap through the real append path keeps cards alive across renders', () => {
  const h = createScrollHarness({ itemCount: 0 });
  try {
    const makeItem = (i) => ({ id: `real-${i}`, mode: 'speaker', text: `Thought ${i}.`, createdAt: i, source: 'ai' });

    for (let i = 0; i < 25; i += 1) {
      h.ctx.state.transcriptItems = appendTranscriptItems(h.ctx.state.transcriptItems, [makeItem(i)]);
      renderDisplay(h.ctx);
      h.runScrollToCompletion();
    }

    const survivor = h.transcriptStack.children.find((node) => node.dataset.itemId === 'real-24');
    assert.ok(survivor, 'the newest card should be on the wall');

    h.ctx.state.transcriptItems = appendTranscriptItems(h.ctx.state.transcriptItems, [makeItem(25)]);
    renderDisplay(h.ctx);
    h.runScrollToCompletion();

    assert.equal(
      h.transcriptStack.children.find((node) => node.dataset.itemId === 'real-24'),
      survivor,
      'card 25 arriving must not tear down and rebuild the card that was already on the wall'
    );
    assert.equal(h.transcriptStack.children.length, 24);
  } finally {
    h.restore();
  }
});

// A hidden document never runs requestAnimationFrame, so the arrival animation never starts and the
// trim hanging off its completion never runs -- cards pile up for as long as the tab is backgrounded.
// Found the honest way: trying to watch this fix in a browser pane that turned out to be hidden, and
// getting 28 cards on a wall capped at 24.
test('a hidden document snaps and trims instead of waiting for an animation that will never run', () => {
  const h = createScrollHarness({ itemCount: 26 });
  const originalHidden = Object.getOwnPropertyDescriptor(global.document, 'hidden');
  try {
    global.document.hidden = true;

    renderDisplay(h.ctx);

    assert.equal(h.frames.length, 0, 'no animation frame may be requested in a hidden document');
    assert.equal(h.transcriptStack.children.length, 24, 'the trim must still happen');
    assert.equal(h.ctx.state.transcriptItems.length, 24);
  } finally {
    if (originalHidden) Object.defineProperty(global.document, 'hidden', originalHidden);
    h.restore();
  }
});
