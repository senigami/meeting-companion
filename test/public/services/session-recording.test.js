import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRecordingSessionId,
  buildChunkRecord,
  buildSummaryRecord,
  buildHeaderRecord
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
    intervalSeconds: 5
  });
  const keys = Object.keys(record).sort();
  assert.deepEqual(keys, ['appCommit', 'at', 'intervalSeconds', 'maxWords', 'promptHash', 'provider', 't']);
});
