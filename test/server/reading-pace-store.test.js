import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createReadingPaceStore, isValidReaderName, listReadingPaceProfiles, readReadingPaceProfile } from '../../server/reading-pace-store.js';

// Issue #44, first slice of named reader profiles: a reading-pace result is a one-time, in-person
// measurement of a real person's reading speed, so it must survive a cleared browser and be movable
// between machines. Same defensive spirit as session-recorder.test.js -- round-trip, missing
// directory, path-traversal rejection, and a real filesystem failure degrading rather than throwing.

test('save then read round-trips the payload', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reading-pace-test-'));
  try {
    const store = createReadingPaceStore({ dir });
    const payload = { recordedAt: '2026-07-31T10:00:00.000Z', fontSizePx: 84, cards: [{ text: 'A neighbor was forgiven.', words: 4, chars: 24, ms: 3200 }] };
    const result = await store.save('jane-doe', payload);

    assert.equal(result.ok, true);
    const read = await store.read('jane-doe');
    assert.deepEqual(read, payload);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a second save under the same name overwrites rather than appending', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reading-pace-test-'));
  try {
    const store = createReadingPaceStore({ dir });
    await store.save('jane-doe', { recordedAt: 'a', cards: [] });
    await store.save('jane-doe', { recordedAt: 'b', cards: [] });

    const read = await store.read('jane-doe');
    assert.equal(read.recordedAt, 'b');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('list() resolves to [] when the directory does not exist', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reading-pace-test-'));
  await rm(dir, { recursive: true, force: true });
  const profiles = await listReadingPaceProfiles(dir);
  assert.deepEqual(profiles, []);
});

test('list() sorts newest recordedAt first and ignores non-json files and invalid names', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reading-pace-test-'));
  try {
    await writeFile(path.join(dir, 'jane.json'), JSON.stringify({ recordedAt: '2026-07-30T10:00:00.000Z', cards: [] }));
    await writeFile(path.join(dir, 'john.json'), JSON.stringify({ recordedAt: '2026-07-31T10:00:00.000Z', cards: [] }));
    await writeFile(path.join(dir, 'notes.txt'), 'ignore me');
    await writeFile(path.join(dir, 'bad name!.json'), 'should be ignored');

    const profiles = await listReadingPaceProfiles(dir);
    assert.deepEqual(profiles.map((p) => p.name), ['john', 'jane']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects a name that could path-traverse, without touching the filesystem', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reading-pace-test-'));
  try {
    const store = createReadingPaceStore({ dir });
    const result = await store.save('../../etc/passwd', { recordedAt: 'x', cards: [] });
    assert.equal(result.ok, false);
    assert.ok(!isValidReaderName('../../etc/passwd'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('read() returns null for a traversal attempt and for an unknown name', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reading-pace-test-'));
  try {
    assert.equal(await readReadingPaceProfile('../../etc/passwd', dir), null);
    assert.equal(await readReadingPaceProfile('does-not-exist', dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a filesystem failure degrades to { ok: false } rather than throwing', async () => {
  // Same technique as session-recorder.test.js: block the directory with a file so mkdir/writeFile
  // both fail, proving the "never throw" contract against a real failure, not just bad input.
  const parent = await mkdtemp(path.join(tmpdir(), 'reading-pace-test-'));
  try {
    const blockerFile = path.join(parent, 'blocker');
    await writeFile(blockerFile, 'x');
    const store = createReadingPaceStore({ dir: path.join(blockerFile, 'nested') });

    await assert.doesNotReject(async () => {
      const result = await store.save('jane-doe', { recordedAt: 'x', cards: [] });
      assert.equal(result.ok, false);
      assert.ok(result.error);
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
