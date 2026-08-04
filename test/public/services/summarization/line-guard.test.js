import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAISummarizer } from '../../../../public/services/summarization/openai.js';
import { createClaudeSummarizer } from '../../../../public/services/summarization/claude.js';
import { RUNAWAY_LINE_GUARD, MAX_LINES_PER_CALL } from '../../../../public/services/summary-prompt.js';

// The layer nobody tested, and the reason #49's fix shipped without working.
//
// #59 raised the SERVER's information-mode cap to 12. Both client drivers then re-ran cleanModelLines
// on the server's already-cleaned reply with no maxLines, so they re-capped at the
// MAX_LINES_PER_CALL default of 3. Measured after #59 merged: server returned five announcements, the
// display got three, and "Ward council meets at 6:30" was dropped exactly as #49 described.
//
// A server-side test cannot catch this and neither can a display test. It only shows up at the seam.
const FIVE_ANNOUNCEMENTS = [
  'Closing hymn is 301.',
  'Sister Ellsworth offers the benediction.',
  'Working bee Saturday at 9:00.',
  'Youth activity moved to Thursday.',
  'Ward council meets at 6:30.'
].join('\n');

const okWith = (line) => async () => ({ ok: true, json: async () => ({ line }) });

for (const [name, create] of [['openai', createOpenAISummarizer], ['claude', createClaudeSummarizer]]) {
  test(`the ${name} driver passes the server's lines through instead of re-capping them`, async () => {
    const driver = create({ fetchImpl: okWith(FIVE_ANNOUNCEMENTS) });
    const result = await driver.summarize({ mode: 'information', recentTranscript: 'Announcements.', maxWords: 10 });
    const lines = result.line.split('\n').filter(Boolean);

    assert.equal(lines.length, 5, `the driver dropped ${5 - lines.length} of the server's five lines`);
    // The specific facts a cap of 3 ate, all on the verbatim-protected list.
    assert.match(result.line, /6:30/, 'the last announcement is the one a re-cap silently removes');
    assert.match(result.line, /Thursday/);
  });

  test(`the ${name} driver still bounds a runaway reply`, async () => {
    // Passing the guard through must not mean passing everything through: a provider that returns
    // fifty lines is a fault, not a long list of announcements.
    const many = Array.from({ length: 40 }, (_, i) => `Announcement number ${i + 1}.`).join('\n');
    const driver = create({ fetchImpl: okWith(many) });
    const result = await driver.summarize({ mode: 'information', recentTranscript: 'x', maxWords: 10 });
    assert.equal(result.line.split('\n').filter(Boolean).length, RUNAWAY_LINE_GUARD);
  });
}

test('the two constants are deliberately different numbers and must not be merged', () => {
  // MAX_LINES_PER_CALL is the CONTRACT of buildSummarizePrompt, which genuinely asks for three lines.
  // RUNAWAY_LINE_GUARD is a fault bound on a prompt that asks for one thought per line. Collapsing
  // them would either re-break #49 or silently change what the older prompt promises.
  assert.equal(MAX_LINES_PER_CALL, 3);
  assert.ok(RUNAWAY_LINE_GUARD > MAX_LINES_PER_CALL);
});
