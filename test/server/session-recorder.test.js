import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSessionRecorder, isValidSessionId, listRecordings, readRecording } from '../../server/session-recorder.js';

// ADR-0004 / backlog items 2-3: the debugging/tuning recorder must (a) actually write both sides of
// the pipeline as ndjson, (b) never throw or leak content on a bad session id, and (c) degrade to
// { ok: false } on a real filesystem failure without throwing -- the one thing that must never reach
// into the live transcribe/summarize loop.

test('appends chunk and summary records as one ndjson line each, in one batched write', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  try {
    const recorder = createSessionRecorder({ dir });
    const result = await recorder.appendRecords('2026-07-29T10-00-00-000Z', [
      { t: 'chunk', at: '2026-07-29T10:00:00.000Z', id: '1', mode: 'speaker', text: 'A neighbor was forgiven.' },
      { t: 'summary', at: '2026-07-29T10:00:05.000Z', mode: 'speaker', consumedIds: ['1'], sent: 'A neighbor was forgiven.', returned: 'Forgiven neighbor', provider: 'openai', ok: true, wasShortened: false }
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.written, 2);

    const contents = await readFile(path.join(dir, '2026-07-29T10-00-00-000Z.ndjson'), 'utf8');
    const lines = contents.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].t, 'chunk');
    assert.equal(lines[1].t, 'summary');
    assert.deepEqual(lines[1].consumedIds, ['1']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a second batch appends rather than overwriting the first', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  try {
    const recorder = createSessionRecorder({ dir });
    await recorder.appendRecords('session-a', [{ t: 'chunk', at: 'x', id: '1', mode: 'speaker', text: 'first' }]);
    await recorder.appendRecords('session-a', [{ t: 'chunk', at: 'y', id: '2', mode: 'speaker', text: 'second' }]);

    const contents = await readFile(path.join(dir, 'session-a.ndjson'), 'utf8');
    const lines = contents.trim().split('\n');
    assert.equal(lines.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects a session id that could path-traverse, without touching the filesystem', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  try {
    const recorder = createSessionRecorder({ dir });
    const result = await recorder.appendRecords('../../etc/passwd', [{ t: 'chunk', text: 'x' }]);
    assert.equal(result.ok, false);
    assert.ok(!isValidSessionId('../../etc/passwd'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an empty batch is a no-op success, not an error', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  try {
    const recorder = createSessionRecorder({ dir });
    const result = await recorder.appendRecords('session-b', []);
    assert.equal(result.ok, true);
    assert.equal(result.written, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a filesystem failure degrades to { ok: false } rather than throwing', async () => {
  // Point at a path that cannot possibly be created (a file, not a directory, sits where the
  // recordings dir would go) so mkdir/appendFile both fail -- proving the "never throw" contract
  // against a real failure, not merely an invalid-input one.
  const parent = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  try {
    const blockerFile = path.join(parent, 'blocker');
    await (await import('node:fs/promises')).writeFile(blockerFile, 'x');
    const recorder = createSessionRecorder({ dir: path.join(blockerFile, 'nested') });

    await assert.doesNotReject(async () => {
      const result = await recorder.appendRecords('session-c', [{ t: 'chunk', text: 'x' }]);
      assert.equal(result.ok, false);
      assert.ok(result.error);
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('listRecordings resolves to [] when the directory does not exist', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  await rm(dir, { recursive: true, force: true });
  const recordings = await listRecordings(dir);
  assert.deepEqual(recordings, []);
});

test('listRecordings sorts newest modifiedAt first and ignores non-ndjson files and invalid ids', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  try {
    await writeFile(path.join(dir, 'session-a.ndjson'), '{"t":"chunk"}\n');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(path.join(dir, 'session-b.ndjson'), '{"t":"chunk"}\n{"t":"chunk"}\n');
    await writeFile(path.join(dir, 'notes.txt'), 'ignore me');
    await writeFile(path.join(dir, 'bad name!.ndjson'), 'should be ignored');

    const recordings = await listRecordings(dir);
    assert.deepEqual(recordings.map((r) => r.id), ['session-b', 'session-a']);
    assert.equal(recordings[0].bytes, Buffer.byteLength('{"t":"chunk"}\n{"t":"chunk"}\n'));
    assert.ok(typeof recordings[0].modifiedAt === 'string');
    assert.ok(!Number.isNaN(Date.parse(recordings[0].modifiedAt)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readRecording returns file contents for a valid id', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  try {
    await writeFile(path.join(dir, 'session-a.ndjson'), '{"t":"chunk"}\n');
    const contents = await readRecording('session-a', dir);
    assert.equal(contents, '{"t":"chunk"}\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readRecording returns null for a traversal attempt and for an unknown id', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  try {
    assert.equal(await readRecording('../../etc/passwd', dir), null);
    assert.equal(await readRecording('does-not-exist', dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
