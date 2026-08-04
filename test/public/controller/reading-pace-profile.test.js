import test from 'node:test';
import assert from 'node:assert/strict';

import { createElement, withRuntimeHarness } from './runtime-test-helpers.js';
import { chooseSummaryLevel } from '../../../public/services/summary-level.js';
import { DEFAULT_MEDIAN_WPM, recommendWordsPerCard } from '../../../public/services/reading-pace.js';

// Issue #44: words-per-card stops being an independent slider and becomes DERIVED from a measured
// (or assumed) pace times the update interval. These tests exercise that wiring through the runtime,
// not just the pure arithmetic already covered in reading-pace.test.js.

test('with no profile applied, the derived budget uses the app default pace and updates when the interval changes', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryIntervalSeconds: 5 }
  }, async ({ ctx, runtime }) => {
    const expectedAt5s = recommendWordsPerCard(DEFAULT_MEDIAN_WPM, 5).words;
    assert.equal(ctx.state.summaryMaxWords, undefined, 'sanity: the harness itself does not seed this');

    runtime.setSummaryInterval(30);
    const expectedAt30s = recommendWordsPerCard(DEFAULT_MEDIAN_WPM, 30).words;
    assert.equal(ctx.state.summaryMaxWords, expectedAt30s,
      'changing the interval must re-derive the word budget from the same pace, not leave it stuck');
    assert.notEqual(expectedAt30s, expectedAt5s,
      'sanity: the two intervals must actually derive different budgets for this assertion to mean anything');

    // The read-only display reflects the derived number -- Ansel's "why did that card only have six
    // words" requirement -- even though nothing ever wrote to it through the (removed) input listener.
    assert.equal(ctx.dom.summaryMaxWordsValue.textContent, `${expectedAt30s} words`);
  });
});

test('applying a reading-pace profile switches the derived budget to the measured pace, at whatever interval is already set', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryIntervalSeconds: 20 }
  }, async ({ ctx, runtime }) => {
    // A profile measured at 30 wpm (one word every two seconds -- the real pace this app was built
    // for) with cards shaped like the ones the reading-pace page actually records.
    const profile = {
      recordedAt: '2026-08-02T00:00:00.000Z',
      fontSizePx: 96,
      cards: [
        { words: 5, ms: 10000 }, // 30 wpm
        { words: 10, ms: 20000 } // 30 wpm
      ]
    };

    runtime.applyReadingPaceProfile('ansel', profile);

    assert.equal(ctx.state.readingPaceProfile.medianWpm, 30);
    assert.equal(ctx.state.readingPaceProfile.name, 'ansel');
    // Applying the profile restores the font size it was measured at -- a pace measured at one type
    // size does not transfer to a display at another.
    assert.equal(ctx.state.fontSize, 96);
    // Derived: 30 wpm at a 20s interval, exactly the app's own arithmetic, not a second copy of it.
    assert.equal(ctx.state.summaryMaxWords, recommendWordsPerCard(30, 20).words);
    // The interval itself is untouched -- it stays the operator's own control.
    assert.equal(ctx.state.summaryIntervalSeconds, 20);
  });
});

test('a profile with no usable cards clears cleanly back to the default pace, rather than crashing', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryIntervalSeconds: 20 }
  }, async ({ ctx, runtime }) => {
    runtime.applyReadingPaceProfile('empty', { cards: [] });
    assert.equal(ctx.state.readingPaceProfile, null);
    assert.equal(ctx.state.summaryMaxWords, recommendWordsPerCard(DEFAULT_MEDIAN_WPM, 20).words);
  });
});

test('applyLastReadingPaceProfile with no remembered name leaves the app working exactly as with none set', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryIntervalSeconds: 20, readingPaceProfileName: '' },
    fetchImpl: async () => {
      throw new Error('must never be called with no remembered profile name');
    }
  }, async ({ ctx, runtime }) => {
    await runtime.applyLastReadingPaceProfile();
    // Nothing to apply, so nothing changes: no profile, no crash, no status message the operator
    // never asked for.
    assert.ok(ctx.state.readingPaceProfile == null);
  });
});

test('applyLastReadingPaceProfile degrades silently when the server refuses or is unreachable', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryIntervalSeconds: 20, readingPaceProfileName: 'ansel' },
    fetchImpl: async () => { throw new Error('network down'); }
  }, async ({ ctx, runtime }) => {
    await runtime.applyLastReadingPaceProfile();
    // A rejected fetch must be swallowed, not surfaced -- the app must work with none set exactly as
    // it did before this feature existed, which includes surviving a dead network at boot.
    assert.ok(ctx.state.readingPaceProfile == null, 'no profile -- the app still works exactly as before this feature existed');
  });
});

test('a measured 30wpm profile at a 20s interval lands on brief, and a faster reader lands on condense', () => {
  // The end-to-end point of #44: the derived budget feeds straight into the level Cato's guard
  // protects, with no separate call needed to keep them in sync.
  const slow = recommendWordsPerCard(30, 20).words;
  assert.equal(chooseSummaryLevel({ cardWords: slow, mode: 'speaker' }), 'brief');

  const fast = recommendWordsPerCard(90, 20).words;
  assert.equal(chooseSummaryLevel({ cardWords: fast, mode: 'speaker' }), 'condense');
});
