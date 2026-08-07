// #46. Three failures on this page were found only by walking it in a browser, the worst being a
// Save button that shipped completely dead while the suite stayed green: with no handler the form
// did a native GET, dropped ?results, landed on the intro screen with a live START, and armed a
// re-run that would overwrite the results being saved. Every existing test here reads the HTML and
// checks a proxy (an id, a word, a colour token), which is exactly what could not catch that.
//
// So these drive the real module with a fake DOM and assert what happened: a request went out, the
// native submit did not, one press advances exactly one card, and the flow reaches the end.
import test from 'node:test';
import assert from 'node:assert/strict';

import { PRACTICE_CARDS, READING_PACE_CARDS } from '../../public/services/reading-pace-cards.js';

function createNode(initial = {}) {
  return {
    textContent: '',
    value: '',
    hidden: false,
    innerHTML: '',
    handlers: {},
    children: [],
    style: { setProperty() {} },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    ...initial
  };
}

const PAGE_IDS = [
  'introScreen', 'cardScreen', 'doneScreen', 'startButton', 'nextButton', 'paceCardText',
  'resultsScreen', 'resultsEmpty', 'resultsBody', 'resultsTableBody', 'resultsMedian',
  'resultsFastest', 'resultsSlowest', 'resultsSlope', 'resultsRecommendation',
  'resultsRecommendationMath', 'resultsRawJson', 'downloadResults',
  'saveProfileForm', 'saveProfileName', 'saveProfileStatus'
];

// Each test imports the module fresh, because it runs its entry branch on import and the branch it
// takes depends on the URL. The query string is the cache-buster.
let importCounter = 0;

async function loadPage({ search = '', storedResults = null, fetchImpl, nowSteps = [], fontSize } = {}) {
  const elements = Object.fromEntries(PAGE_IDS.map((id) => [id, createNode()]));
  const storage = new Map();
  if (storedResults) storage.set('readingPaceResults', JSON.stringify(storedResults));
  if (fontSize !== undefined) storage.set('fontSize', String(fontSize));

  const saved = {
    document: global.document,
    window: global.window,
    localStorage: global.localStorage,
    fetch: global.fetch,
    performance: global.performance
  };

  const fetchCalls = [];
  let nowIndex = 0;

  global.document = {
    documentElement: { style: { setProperty() {} } },
    getElementById: (id) => elements[id] ?? null,
    createElement: () => createNode()
  };
  global.window = { location: { search } };
  global.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value)
  };
  global.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return fetchImpl ? fetchImpl(url, options) : { ok: true, json: async () => ({ ok: true }) };
  };
  global.performance = {
    now: () => {
      const value = nowSteps[nowIndex] ?? nowIndex * 10000;
      nowIndex += 1;
      return value;
    }
  };

  importCounter += 1;
  await import(`../../public/reading-pace.js?case=${importCounter}`);
  // The results entry point is async, so let its awaits settle before anything is asserted.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    elements,
    fetchCalls,
    storage,
    restore() {
      global.document = saved.document;
      global.window = saved.window;
      global.localStorage = saved.localStorage;
      global.fetch = saved.fetch;
      global.performance = saved.performance;
    }
  };
}

const STORED = {
  recordedAt: '2026-08-02T10:00:00.000Z',
  fontSizePx: 84,
  cards: [
    { text: 'The meeting starts at ten.', words: 5, chars: 26, ms: 9000 },
    { text: 'Hymn 136 will be sung.', words: 5, chars: 22, ms: 11000 },
    { text: 'Brother Reed will speak next.', words: 5, chars: 29, ms: 10000 }
  ]
};

test('#46: saving a named profile sends the request and never lets the form navigate', async () => {
  const page = await loadPage({ search: '?results', storedResults: STORED });
  try {
    page.elements.saveProfileName.value = '  Steve  ';
    let defaultPrevented = false;

    assert.equal(typeof page.elements.saveProfileForm.handlers.submit, 'function',
      'the results screen must attach the save handler, since it is the only screen that renders here');

    await page.elements.saveProfileForm.handlers.submit({
      preventDefault() { defaultPrevented = true; }
    });

    // The second assertion is the one that matters: a native GET is what turned a dead button into
    // a destructive one, dropping ?results and arming a re-run over the results being saved.
    assert.equal(defaultPrevented, true, 'the native submit must be prevented, always');

    const posts = page.fetchCalls.filter((call) => call.options?.method === 'POST');
    assert.equal(posts.length, 1, 'pressing Save must actually send something');
    assert.equal(posts[0].url, '/api/reading-pace');
    assert.deepEqual(JSON.parse(posts[0].options.body), { name: 'Steve', payload: STORED });
    assert.match(page.elements.saveProfileStatus.textContent, /Saved as "Steve"/);
  } finally {
    page.restore();
  }
});

test('#46: an unnamed save asks for a name instead of sending anything', async () => {
  const page = await loadPage({ search: '?results', storedResults: STORED });
  try {
    page.elements.saveProfileName.value = '   ';
    let defaultPrevented = false;

    await page.elements.saveProfileForm.handlers.submit({
      preventDefault() { defaultPrevented = true; }
    });

    assert.equal(defaultPrevented, true, 'prevented even when there is nothing to save');
    assert.equal(page.fetchCalls.filter((call) => call.options?.method === 'POST').length, 0);
    assert.equal(page.elements.saveProfileStatus.textContent, 'Give it a name first.');
  } finally {
    page.restore();
  }
});

test('#46: one press advances exactly one card', async () => {
  // Two presses, each comfortably past the double-press floor, so the second card is the one on
  // screen afterwards and not the third.
  const page = await loadPage({ nowSteps: [0, 5000, 5000, 12000, 12000] });
  try {
    page.elements.startButton.handlers.click();
    assert.equal(page.elements.introScreen.hidden, true);
    assert.equal(page.elements.cardScreen.hidden, false);
    assert.equal(page.elements.paceCardText.textContent, PRACTICE_CARDS[0]);

    page.elements.nextButton.handlers.click();
    assert.equal(page.elements.paceCardText.textContent, PRACTICE_CARDS[1],
      'one press moves on by one card, not two');
  } finally {
    page.restore();
  }
});

test('#46: a press faster than a person can read is ignored rather than counted', async () => {
  // 300ms is a bounce or a double-press. Ignoring it costs him nothing and keeps the sample honest.
  const page = await loadPage({ nowSteps: [0, 0, 300] });
  try {
    page.elements.startButton.handlers.click();
    page.elements.nextButton.handlers.click();

    assert.equal(page.elements.paceCardText.textContent, PRACTICE_CARDS[0], 'still on the first card');
  } finally {
    page.restore();
  }
});

test('#46: pressing through the whole sequence reaches the done screen and records only the real cards', async () => {
  const total = PRACTICE_CARDS.length + READING_PACE_CARDS.length;
  // Every press lands 6 seconds after the card appeared: past the floor, and slow enough to be a
  // plausible read.
  const nowSteps = [];
  for (let i = 0; i <= total; i += 1) nowSteps.push(i * 6000, i * 6000 + 6000);

  // Seeded so the recorded size is a value this test chose, not whatever the clamp falls back to.
  const page = await loadPage({ nowSteps, fontSize: 84 });
  try {
    page.elements.startButton.handlers.click();
    for (let i = 0; i < total; i += 1) page.elements.nextButton.handlers.click();

    assert.equal(page.elements.cardScreen.hidden, true);
    assert.equal(page.elements.doneScreen.hidden, false, 'the flow must reach the end on its own');

    const stored = JSON.parse(page.storage.get('readingPaceResults'));
    assert.equal(stored.cards.length, READING_PACE_CARDS.length,
      'the practice cards are discarded, the rest are kept');
    assert.equal(stored.fontSizePx, 84, 'the size the run was measured at is recorded with it');
  } finally {
    page.restore();
  }
});
