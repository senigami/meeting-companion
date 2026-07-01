import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderDisplay,
  setViewPanelOpen
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
