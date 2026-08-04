import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanModelLinesWithLoss, RUNAWAY_LINE_GUARD } from '../../../public/services/summary-prompt.js';
import { summarizeWithSource } from '../../../server/summarization.js';
import { buildSummaryRecord } from '../../../public/services/session-recording.js';
import { createOpenAISummarizer } from '../../../public/services/summarization/openai.js';

// #58. The only telemetry on a summarize call was wasShortened, which describes shortenToLimit
// trimming a line's CHARACTERS. A line DISCARDED because a cap was reached reported nothing, so it was
// indistinguishable from a clean call.
//
// That is why #49, #63 and #65 each survived being "fixed": every one was a bound throwing content
// away while the call reported success, and every one was found by a person tracing the path by hand.

test('a line dropped by the cap is counted, and a duplicate is not', () => {
  // The distinction is the whole value. A line matching something already on screen SHOULD go; that is
  // the duplicate filter working. A line dropped because the cap was reached is speech the reader never
  // gets. Counting them together would make the signal useless.
  const fifteen = Array.from({ length: 15 }, (_, i) => `Announcement number ${i + 1}.`).join('\n');
  const capped = cleanModelLinesWithLoss(fifteen, [], { maxLines: 12 });
  assert.equal(capped.accepted.length, 12);
  assert.equal(capped.discardedByCap, 3);

  const withDuplicates = cleanModelLinesWithLoss('One.\nOne.\nTwo.', [], { maxLines: 12 });
  assert.equal(withDuplicates.accepted.length, 2);
  assert.equal(withDuplicates.discardedByCap, 0, 'a duplicate is not a loss');

  const alreadyShown = cleanModelLinesWithLoss('Hymn 241 selected.\nFirst item.', ['Hymn 241 selected.'], { maxLines: 12 });
  assert.equal(alreadyShown.discardedByCap, 0, 'nor is a line already on the wall');

  const clean = cleanModelLinesWithLoss('One.\nTwo.', [], { maxLines: 12 });
  assert.equal(clean.discardedByCap, 0, 'and a call that lost nothing must report nothing');
});

test('the count survives the whole path, server through driver to the recording', async () => {
  // The seam is where #63 hid, so this asserts the number at the end of the path rather than at the
  // start of it.
  const tooMany = Array.from({ length: RUNAWAY_LINE_GUARD + 4 }, (_, i) => `Item ${i + 1}.`).join('\n');

  const fromServer = await summarizeWithSource({
    source: 'openai',
    mode: 'information',
    recentTranscript: 'Announcements.',
    maxWords: 10,
    openaiClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: tooMany } }] }) } } }
  });
  assert.equal(fromServer.discardedByCap, 4, 'the server must say how many it threw away');

  const driver = createOpenAISummarizer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ line: fromServer.line, discardedByCap: fromServer.discardedByCap }) })
  });
  const fromDriver = await driver.summarize({ mode: 'information', recentTranscript: 'x', maxWords: 10 });
  assert.equal(fromDriver.discardedByCap, 4, 'and the driver must carry it rather than swallowing it');

  const record = buildSummaryRecord({
    at: Date.now(), mode: 'information', sent: 'Announcements.', returned: fromDriver.line,
    provider: 'openai', ok: true, wasShortened: false, discardedByCap: fromDriver.discardedByCap
  });
  assert.equal(record.discardedByCap, 4, 'and it must reach the recording, which is where a person reads it');
  assert.equal(record.wasShortened, false, 'while staying distinct from shortening, which did not happen here');
});

test('a clean call records a zero rather than nothing at all', () => {
  // An absent field reads as "old recording" rather than "nothing was lost", and a replay cannot tell
  // those apart. Always write the number.
  const record = buildSummaryRecord({ at: Date.now(), mode: 'speaker', sent: 'x', returned: 'y', provider: 'openai', ok: true });
  assert.equal(record.discardedByCap, 0);
  assert.ok('discardedByCap' in record);
});
