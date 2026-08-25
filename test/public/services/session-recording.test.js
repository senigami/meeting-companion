import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRecordingSessionId,
  buildChunkRecord,
  buildSummaryRecord,
  buildHeaderRecord,
  buildCorrectionRecord,
  buildSpeakerBreakRecord,
  buildManualLineRecord
} from '../../../public/services/session-recording.js';

test('session id is derived from a timestamp and contains only filesystem/URL-safe characters', () => {
  const id = createRecordingSessionId(Date.UTC(2026, 6, 29, 10, 0, 0));
  assert.match(id, /^[A-Za-z0-9_-]+$/);
});

test('two different timestamps produce two different session ids', () => {
  const a = createRecordingSessionId(Date.UTC(2026, 6, 29, 10, 0, 0));
  const b = createRecordingSessionId(Date.UTC(2026, 6, 29, 10, 0, 1));
  assert.notEqual(a, b);
});

test('buildChunkRecord shapes a chunk with its own capture id, mode, and ISO timestamp', () => {
  const record = buildChunkRecord({ at: Date.UTC(2026, 6, 29, 10, 0, 0), mode: 'speaker', text: 'A neighbor was forgiven.' });
  assert.equal(record.t, 'chunk');
  assert.equal(record.id, String(Date.UTC(2026, 6, 29, 10, 0, 0)));
  assert.equal(record.mode, 'speaker');
  assert.equal(record.text, 'A neighbor was forgiven.');
  assert.equal(record.at, new Date(Date.UTC(2026, 6, 29, 10, 0, 0)).toISOString());
});

test('buildSummaryRecord carries consumedIds, provider, and wasShortened through untouched', () => {
  const record = buildSummaryRecord({
    at: Date.UTC(2026, 6, 29, 10, 0, 5),
    mode: 'speaker',
    consumedIds: [111, 222],
    hadPreviousBlock: true,
    sent: 'A neighbor was forgiven.',
    returned: 'Forgiven neighbor',
    provider: 'openai',
    ok: true,
    latencyMs: 842,
    wasShortened: true
  });

  assert.equal(record.t, 'summary');
  assert.deepEqual(record.consumedIds, ['111', '222']);
  assert.equal(record.hadPreviousBlock, true);
  assert.equal(record.provider, 'openai');
  assert.equal(record.ok, true);
  assert.equal(record.latencyMs, 842);
  assert.equal(record.wasShortened, true);
});

test('buildSummaryRecord defaults a failed call to ok:false with no returned text', () => {
  const record = buildSummaryRecord({
    at: Date.now(),
    mode: 'speaker',
    consumedIds: [],
    sent: 'text',
    provider: 'openai',
    ok: false,
    error: 'ECONNRESET'
  });

  assert.equal(record.ok, false);
  assert.equal(record.returned, '');
  assert.equal(record.error, 'ECONNRESET');
  assert.equal(record.wasShortened, false);
});

test('buildSummaryRecord defaults verbatim to false when not passed', () => {
  const record = buildSummaryRecord({
    at: Date.now(),
    mode: 'speaker',
    consumedIds: [],
    sent: 'text',
    provider: 'openai',
    ok: true
  });

  assert.equal(record.verbatim, false);
});

test('buildSummaryRecord carries verbatim: true through when passed', () => {
  const record = buildSummaryRecord({
    at: Date.now(),
    mode: 'speaker',
    consumedIds: [],
    sent: 'text',
    provider: 'passthrough',
    ok: true,
    verbatim: true
  });

  assert.equal(record.verbatim, true);
});

test('buildHeaderRecord carries commit, prompt hash, word limit, provider and interval verbatim', () => {
  const record = buildHeaderRecord({
    at: Date.UTC(2026, 6, 29, 10, 0, 0),
    appCommit: 'abc123',
    promptHash: 'deadbeef',
    maxWords: 15,
    provider: 'openai',
    intervalSeconds: 5
  });

  assert.equal(record.t, 'header');
  assert.equal(record.appCommit, 'abc123');
  assert.equal(record.promptHash, 'deadbeef');
  assert.equal(record.maxWords, 15);
  assert.equal(record.provider, 'openai');
  assert.equal(record.intervalSeconds, 5);
  assert.equal(record.at, new Date(Date.UTC(2026, 6, 29, 10, 0, 0)).toISOString());
});

test('buildHeaderRecord defaults an unknown commit/hash to the literal string "unknown", never empty', () => {
  const record = buildHeaderRecord({});
  assert.equal(record.appCommit, 'unknown');
  assert.equal(record.promptHash, 'unknown');
});

test('buildHeaderRecord never carries transcript text or any key material -- metadata fields only', () => {
  const record = buildHeaderRecord({
    appCommit: 'abc123',
    promptHash: 'deadbeef',
    maxWords: 15,
    provider: 'openai',
    intervalSeconds: 5,
    displayCap: 24
  });
  const keys = Object.keys(record).sort();
  // displayCap added with the card records (#142): a number, metadata about the DISPLAY rather than
  // about anything anyone said, so it does not widen what this record can leak. Growing this list is
  // supposed to hurt -- an exact key set is the only thing standing between "add one useful field"
  // and transcript text arriving in a header nobody re-reads. Anything added here needs the same
  // question answered out loud: could this field ever hold a word somebody spoke?
  assert.deepEqual(keys, ['appCommit', 'at', 'displayCap', 'intervalSeconds', 'maxWords', 'promptHash', 'provider', 't']);
  assert.equal(typeof record.displayCap, 'number', 'and it stays a number, never free text');
});

test('an older recording with no display cap reports null, which a replay must not read as "no cap"', () => {
  const record = buildHeaderRecord({});
  assert.equal(record.displayCap, null);
});

test('buildCorrectionRecord points at the corrected summary by its own timestamp, and carries the reason', () => {
  const targetAt = Date.UTC(2026, 7, 23, 17, 2, 18, 839);
  const record = buildCorrectionRecord({
    at: Date.UTC(2026, 7, 24, 2, 0, 0),
    targetAt,
    reason: 'setup noise, not real meeting content'
  });
  assert.equal(record.t, 'correction');
  assert.equal(record.targetAt, new Date(targetAt).toISOString());
  assert.equal(record.reason, 'setup noise, not real meeting content');
  assert.equal(record.at, new Date(Date.UTC(2026, 7, 24, 2, 0, 0)).toISOString());
});

test('buildCorrectionRecord defaults reason to empty string and targetAt to null, never undefined', () => {
  const record = buildCorrectionRecord({});
  assert.equal(record.reason, '');
  assert.equal(record.targetAt, null);
});

test('buildSpeakerBreakRecord points at the summary starting the new speaker, same targetAt idiom as a correction', () => {
  const targetAt = Date.UTC(2026, 7, 23, 16, 50, 24, 863);
  const record = buildSpeakerBreakRecord({ at: Date.UTC(2026, 7, 24, 2, 0, 0), targetAt });
  assert.equal(record.t, 'speaker-break');
  assert.equal(record.targetAt, new Date(targetAt).toISOString());
});

test('buildSpeakerBreakRecord defaults targetAt to null, never undefined', () => {
  const record = buildSpeakerBreakRecord({});
  assert.equal(record.targetAt, null);
});

// #135
test('buildManualLineRecord carries the mode, speaker and text of the card the operator typed', () => {
  const record = buildManualLineRecord({
    at: Date.parse('2026-08-24T16:20:00.000Z'),
    mode: 'song',
    text: 'Music is playing.',
    speaker: 'Sis. Whitmer'
  });

  assert.equal(record.t, 'manual');
  assert.equal(record.at, '2026-08-24T16:20:00.000Z');
  assert.equal(record.mode, 'song');
  assert.equal(record.speaker, 'Sis. Whitmer');
  assert.equal(record.text, 'Music is playing.');
  assert.equal(record.isHeader, false);
});

test('a manual record with no speaker stores null, never an empty string or a placeholder', () => {
  const record = buildManualLineRecord({ at: 0, mode: 'information', text: 'Ward council at 5.', speaker: '' });
  assert.equal(record.speaker, null);
});

test('a header send is marked as one, so a replay can tell a program header from a typed line', () => {
  const record = buildManualLineRecord({ at: 0, mode: 'speaker', text: 'Opening Hymn', isHeader: true });
  assert.equal(record.isHeader, true);
});
