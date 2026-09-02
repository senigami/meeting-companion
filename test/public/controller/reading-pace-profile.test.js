import test from 'node:test';
import assert from 'node:assert/strict';

import { createElement, withRuntimeHarness } from './runtime-test-helpers.js';
import { chooseSummaryLevel } from '../../../public/services/summary-level.js';
import {
  DEFAULT_MEDIAN_WPM,
  USABLE_CARD_WORDS_FLOOR,
  readingBudget,
  recommendSummaryIntervalSeconds
} from '../../../public/services/reading-pace.js';

// #56, Steve's decision 2026-09-01: words-per-card is now the control the operator sets directly,
// and the update interval is DERIVED from it (the reverse of #44's direction -- see runtime.js's
// recomputeSummaryInterval for why the old shape always left an unusable stretch reachable on the
// interval slider). These tests exercise that wiring through the runtime, not just the pure
// arithmetic already covered in reading-pace.test.js.

test('with no profile applied, the derived interval uses the app default pace and updates when words per card changes', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' }),
      summaryIntervalInput: createElement({ value: '0' }),
      summaryIntervalValue: createElement({ textContent: '' })
    },
    stateOverrides: {}
  }, async ({ ctx, runtime }) => {
    // The harness only seeds raw state -- it does not run the app's own derivation, so establish the
    // floor's own derived interval by calling the same setter the slider drives, at its own value.
    runtime.setWordsPerCard(USABLE_CARD_WORDS_FLOOR);
    const expectedAtFloor = recommendSummaryIntervalSeconds(DEFAULT_MEDIAN_WPM, USABLE_CARD_WORDS_FLOOR).seconds;
    assert.equal(ctx.state.summaryIntervalSeconds, expectedAtFloor,
      'setting words per card must derive the interval from the app default pace with no profile applied');

    runtime.setWordsPerCard(15);
    const expectedAt15Words = recommendSummaryIntervalSeconds(DEFAULT_MEDIAN_WPM, 15).seconds;
    assert.equal(ctx.state.summaryIntervalSeconds, expectedAt15Words,
      'changing words per card must re-derive the interval from the same pace, not leave it stuck');
    assert.notEqual(expectedAt15Words, expectedAtFloor,
      'sanity: the two word counts must actually derive different intervals for this assertion to mean anything');

    // The read-only interval display reflects the derived number -- Ansel's "why did that card only
    // have this long" requirement -- even though nothing ever wrote to it through a (removed) input
    // listener; the interval control is disabled now (view.js's updateSummaryIntervalControl).
    assert.equal(ctx.dom.summaryIntervalValue.textContent, `${expectedAt15Words}s`);
    assert.equal(ctx.dom.summaryIntervalInput.disabled, true);
  });
});

test('applying a reading-pace profile is a bookmark of pace and font size, not of the chosen word count', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' }),
      summaryIntervalInput: createElement({ value: '0' }),
      summaryIntervalValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryMaxWords: 17, summaryIntervalSeconds: 20 }
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
    // #56: the words-per-card the operator dialled in is theirs to keep -- a profile bookmarks the
    // reading PACE, never the word count. Reselecting one changes how much TIME that count gets,
    // never the count itself.
    assert.equal(ctx.state.summaryMaxWords, 17, 'the chosen word count survives a profile apply');
    // Derived: 30 wpm for THAT word count, exactly the app's own arithmetic, not a second copy of it.
    assert.equal(ctx.state.summaryIntervalSeconds, recommendSummaryIntervalSeconds(30, 17).seconds);
  });
});

test('dragging words per card recomputes the interval, keeping any applied profile', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' }),
      summaryIntervalInput: createElement({ value: '0' }),
      summaryIntervalValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryMaxWords: USABLE_CARD_WORDS_FLOOR, summaryIntervalSeconds: 20 }
  }, async ({ ctx, runtime }) => {
    const profile = {
      recordedAt: '2026-08-02T00:00:00.000Z',
      cards: [
        { words: 5, ms: 10000 }, // 30 wpm
        { words: 10, ms: 20000 } // 30 wpm
      ]
    };
    runtime.applyReadingPaceProfile('ansel', profile);
    assert.ok(ctx.state.readingPaceProfile, 'sanity: a profile is actually applied first');

    runtime.setWordsPerCard(17);

    assert.equal(ctx.state.summaryMaxWords, 17, 'the chosen count lands exactly, not snapped');
    // #56: unlike #44's manual override, setting a word count no longer clears the profile -- a
    // chosen count and a measured pace never disagree here, because the pace only ever determines
    // how much TIME that count gets.
    assert.ok(ctx.state.readingPaceProfile, 'the applied profile is untouched by a words-per-card change');
    assert.equal(ctx.state.summaryIntervalSeconds, recommendSummaryIntervalSeconds(30, 17).seconds,
      'the interval re-derives from the still-applied profile pace at the new word count');
  });
});

test('a word count floored at USABLE_CARD_WORDS_FLOOR is never reachable below it', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryMaxWords: USABLE_CARD_WORDS_FLOOR, summaryIntervalSeconds: 20 }
  }, async ({ ctx, runtime }) => {
    runtime.setWordsPerCard(1);
    assert.equal(ctx.state.summaryMaxWords, USABLE_CARD_WORDS_FLOOR,
      'the floor makes every reachable position on this control usable by construction');
    assert.equal(ctx.state.readingBudget?.belowFloor ?? false, false);
  });
});

test('a profile with no usable cards clears cleanly back to the default pace, rather than crashing', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' }),
      summaryIntervalInput: createElement({ value: '0' }),
      summaryIntervalValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryMaxWords: 17, summaryIntervalSeconds: 20 }
  }, async ({ ctx, runtime }) => {
    runtime.applyReadingPaceProfile('empty', { cards: [] });
    assert.equal(ctx.state.readingPaceProfile, null);
    // Clearing a profile is a pace-only reset -- the chosen word count is untouched, only the
    // interval re-derives against the app's default assumed pace.
    assert.equal(ctx.state.summaryMaxWords, 17);
    assert.equal(ctx.state.summaryIntervalSeconds, recommendSummaryIntervalSeconds(DEFAULT_MEDIAN_WPM, 17).seconds);
  });
});

test('applyLastReadingPaceProfile with no remembered name leaves the app working exactly as with none set', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' })
    },
    stateOverrides: { summaryMaxWords: 14, summaryIntervalSeconds: 20, readingPaceProfileName: '' },
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
    stateOverrides: { summaryMaxWords: 14, summaryIntervalSeconds: 20, readingPaceProfileName: 'ansel' },
    fetchImpl: async () => { throw new Error('network down'); }
  }, async ({ ctx, runtime }) => {
    await runtime.applyLastReadingPaceProfile();
    // A rejected fetch must be swallowed, not surfaced -- the app must work with none set exactly as
    // it did before this feature existed, which includes surviving a dead network at boot.
    assert.ok(ctx.state.readingPaceProfile == null, 'no profile -- the app still works exactly as before this feature existed');
  });
});

test('#56: a word count the reader is too slow for reports exceedsMax and says so on both controls', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' }),
      summaryIntervalInput: createElement({ value: '0' }),
      summaryIntervalValue: createElement({ textContent: '' })
    },
    stateOverrides: {}
  }, async ({ ctx, runtime }) => {
    // At the app default pace (30 wpm), a 20-word card takes 40s to read, which exceeds the app's own
    // 30s interval ceiling -- the derived interval still clamps to something reachable, but that clamp
    // is a lie about how long the card actually takes unless exceedsMax says so.
    runtime.setWordsPerCard(20);
    assert.equal(ctx.state.summaryIntervalBudget.exceedsMax, true,
      'a 20-word card at the default pace genuinely cannot fit inside the interval ceiling');
    assert.equal(ctx.state.summaryIntervalSeconds, 30, 'the derived interval still clamps to the reachable ceiling');
    assert.match(ctx.dom.summaryIntervalValue.textContent, /too short for this reader/,
      'the sighted note beside the disabled interval control must say so');
    assert.match(ctx.dom.summaryMaxWordsInput.getAttribute('aria-valuetext'), /too many for this reader/,
      'a screen-reader operator on the words control -- the only one still reachable by keyboard -- must be told too');
  });
});

test('#56: a word count comfortably inside the interval ceiling reports no exceedsMax warning anywhere', async () => {
  await withRuntimeHarness({
    elementOverrides: {
      summaryMaxWordsInput: createElement({ value: '0' }),
      summaryMaxWordsValue: createElement({ textContent: '' }),
      summaryIntervalInput: createElement({ value: '0' }),
      summaryIntervalValue: createElement({ textContent: '' })
    },
    stateOverrides: {}
  }, async ({ ctx, runtime }) => {
    // 14 words at 30 wpm takes 28s, comfortably under the 30s ceiling.
    runtime.setWordsPerCard(14);
    assert.equal(ctx.state.summaryIntervalBudget.exceedsMax, false);
    assert.doesNotMatch(ctx.dom.summaryIntervalValue.textContent, /too short for this reader/);
    assert.doesNotMatch(ctx.dom.summaryMaxWordsInput.getAttribute('aria-valuetext'), /too many for this reader/);
  });
});

test('a measured 30wpm profile at a 20-word card lands on brief, and a faster reader lands on condense', () => {
  // The end-to-end point of #44 (and now #56): the chosen budget feeds straight into the level
  // Cato's guard protects, with no separate call needed to keep them in sync.
  const slow = readingBudget(30, 20).words;
  assert.equal(chooseSummaryLevel({ cardWords: slow, mode: 'speaker' }), 'brief');

  const fast = readingBudget(90, 20).words;
  assert.equal(chooseSummaryLevel({ cardWords: fast, mode: 'speaker' }), 'condense');
});
