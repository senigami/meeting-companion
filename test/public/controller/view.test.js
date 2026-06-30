import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDisplay } from '../../../public/controller/view.js';

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

  const transcriptViewport = createNode('div');
  const transcriptStack = createNode('div');
  transcriptViewport.scrollToCalls = [];
  transcriptViewport.scrollTop = 0;
  transcriptViewport.clientHeight = 600;
  transcriptViewport.scrollHeight = 1600;
  transcriptViewport.scrollTo = function scrollTo(options) {
    this.scrollToCalls.push(options);
    this.scrollTop = options.top;
  };

  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

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

    assert.equal(transcriptStack.children.length, 2);
    assert.equal(transcriptStack.children[1].dataset.active, 'true');
    assert.equal(transcriptStack.children[1].scrollIntoViewCalls.length, 1);
    assert.equal(transcriptViewport.scrollToCalls.length, 0);
  } finally {
    global.document = originalDocument;
    global.requestAnimationFrame = originalRequestAnimationFrame;
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
