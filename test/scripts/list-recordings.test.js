import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every expected count in this file is hand-counted from the literal fixture above it, never derived
// from the code under test. An expectation computed the same way the implementation computes it
// passes at any value of both.

function writeDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'list-recordings-test-'));
  for (const [name, lines] of Object.entries(files)) {
    const body = typeof lines === 'string'
      ? lines
      : lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
    writeFileSync(path.join(dir, name), body, 'utf8');
  }
  return dir;
}

function run(dir, ...flags) {
  try {
    return execFileSync('node', ['scripts/list-recordings.js', dir, ...flags], { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`list-recordings.js failed: ${error.stdout || ''}${error.stderr || ''}`);
  }
}

// 3 chunks, 2 summarize calls, 1 of them failed, 1 shortened, 2 lines discarded (2 + 0).
const WELL_FORMED = [
  { t: 'header', at: '2026-08-01T10:00:00.000Z', appCommit: 'aaaaaaaabbbbbbbb', promptHash: 'feedface', provider: 'openai' },
  { t: 'chunk', at: '2026-08-01T10:00:10.000Z', id: 'c1', text: 'one' },
  { t: 'chunk', at: '2026-08-01T10:00:20.000Z', id: 'c2', text: 'two' },
  { t: 'chunk', at: '2026-08-01T10:00:30.000Z', id: 'c3', text: 'three' },
  { t: 'summary', at: '2026-08-01T10:00:40.000Z', consumedIds: ['c1'], ok: true, wasShortened: true, discardedByCap: 2, discardedByCapClient: 0 },
  { t: 'summary', at: '2026-08-01T10:06:00.000Z', consumedIds: ['c2'], ok: false, error: 'boom', wasShortened: false, discardedByCap: 0, discardedByCapClient: 0 }
];

test('counts chunks, calls, failures, shortenings and discarded lines from one recording', () => {
  const dir = writeDir({ 'session-a.ndjson': WELL_FORMED });
  const out = run(dir);

  assert.match(out, /1 recording\(s\)/);
  // Hand-counted from WELL_FORMED: 3 chunks, 2 calls, 0 typed, 1 failed, 1 short, 2 lost.
  assert.match(out, /session-a\s+6m\s+3\s+2\s+0\s+1\s+1\s+2\b/);
});

test('a recording predating the discard count reports n/r, which is not the same as zero', () => {
  const dir = writeDir({
    'old.ndjson': [
      { t: 'chunk', at: '2026-08-01T10:00:00.000Z', id: 'c1', text: 'one' },
      // No discardedByCap field at all: this is a pre-#58 recording. Nobody was counting.
      { t: 'summary', at: '2026-08-01T10:00:10.000Z', consumedIds: ['c1'], ok: true, wasShortened: false }
    ],
    'new.ndjson': [
      { t: 'chunk', at: '2026-08-01T10:00:00.000Z', id: 'c1', text: 'one' },
      { t: 'summary', at: '2026-08-01T10:00:10.000Z', consumedIds: ['c1'], ok: true, wasShortened: false, discardedByCap: 0 }
    ]
  });

  const out = run(dir);
  const oldLine = out.split('\n').find((line) => line.startsWith('old'));
  const newLine = out.split('\n').find((line) => line.startsWith('new'));

  assert.match(oldLine, /n\/r/);
  assert.ok(!/n\/r/.test(newLine), 'a recording that DID count discards must print the number, not n/r');
  assert.match(newLine, /\s0\s/);
});

test('a partial last line does not stop the listing, and the counts say they are a floor', () => {
  // A recording is appended a line at a time while a meeting runs, so a session that ended in a hard
  // quit leaves a truncated final line. That is a normal file, not a corrupt one.
  const truncated = WELL_FORMED.map((line) => JSON.stringify(line)).join('\n') + '\n{"t":"chunk","at":"2026-08-01T10:07:0';
  const dir = writeDir({ 'crashed.ndjson': truncated, 'fine.ndjson': WELL_FORMED });

  const out = run(dir);
  assert.match(out, /crashed/);
  assert.match(out, /1 unreadable line\(s\)/);
  assert.match(out, /floor, not a total/);
  // The other file must still be listed with its real counts.
  assert.match(out, /fine\s+6m\s+3\s+2\s+0\s+1\s+1\s+2\b/);
});

test('one unreadable file does not hide every other file, which is the point of a listing', () => {
  const dir = writeDir({ 'good.ndjson': WELL_FORMED, 'locked.ndjson': WELL_FORMED });
  chmodSync(path.join(dir, 'locked.ndjson'), 0o000);

  const out = run(dir);
  assert.match(out, /locked\s+UNREADABLE/);
  assert.match(out, /good\s+6m\s+3\s+2\s+0\s+1\s+1\s+2\b/);
});

test('a recording made under a different commit is marked stale', () => {
  const dir = writeDir({ 'stale.ndjson': WELL_FORMED });
  const out = run(dir);
  // WELL_FORMED's appCommit is a literal that cannot be this checkout's HEAD.
  assert.match(out, /aaaaaaaa\*/);
  assert.match(out, /recorded under a different commit/);
});

test('a headerless recording says unknown rather than reading as a match', () => {
  const dir = writeDir({
    'headerless.ndjson': [{ t: 'chunk', at: '2026-08-01T10:00:00.000Z', id: 'c1', text: 'one' }]
  });
  const out = run(dir);
  assert.match(out, /headerless.*unknown/);
  assert.ok(!/headerless.*\*/.test(out), 'unknown is not the same as stale and must not be marked as such');
});

test('an empty recordings directory says so instead of printing an empty table', () => {
  assert.match(run(writeDir({})), /No recordings in/);
});

test('--json carries the same counts as the table', () => {
  const dir = writeDir({ 'session-a.ndjson': WELL_FORMED });
  const parsed = JSON.parse(run(dir, '--json'));
  const row = parsed.recordings[0];

  assert.equal(row.chunkCount, 3);
  assert.equal(row.summaryCount, 2);
  assert.equal(row.failedCount, 1);
  assert.equal(row.shortenedCount, 1);
  assert.equal(row.linesLost, 2);
  assert.equal(row.countWasRecorded, true);
});

// The reason scripts/lib/recording-summary.js exists. Two tools printing the same numbers from two
// implementations is how they come to disagree, and the cheap one is the one people trust: a listing
// that calls a session clean while the detail view reports four discarded lines is worse than having
// no listing at all. This compares the two programs' actual output, so it fails if either drifts.
test('list-recordings and replay-recording report the same counts for the same file', () => {
  const dir = writeDir({ 'session-a.ndjson': WELL_FORMED });
  const file = path.join(dir, 'session-a.ndjson');

  const listed = JSON.parse(run(dir, '--json')).recordings[0];
  const replayed = execFileSync('node', ['scripts/replay-recording.js', file], { encoding: 'utf8' });

  assert.match(replayed, new RegExp(`${listed.chunkCount} chunk\\(s\\)`));
  assert.match(replayed, new RegExp(`${listed.summaryCount} summarize call\\(s\\)`));
  assert.match(replayed, new RegExp(`${listed.failedCount} failed`));
  assert.match(replayed, new RegExp(`${listed.shortenedCount} shortened`));
  assert.match(replayed, new RegExp(`${listed.linesLost} line\\(s\\) DISCARDED`));
});

// #139: manual lines have been recorded since #135 but were counted nowhere, so a session's stats
// described the AI's half of the meeting and quietly left out the operator's -- the half that is
// guaranteed correct, and often typed precisely BECAUSE the AI got something wrong.
test('lines the operator typed are counted, not left out of the session stats', () => {
  const dir = writeDir({
    'typed-session.ndjson': [
      { t: 'header', at: '2026-08-01T10:00:00.000Z', appCommit: 'aaaaaaaabbbbbbbb', promptHash: 'feedface', provider: 'openai' },
      { t: 'chunk', at: '2026-08-01T10:00:10.000Z', id: 'c1', text: 'one' },
      { t: 'summary', at: '2026-08-01T10:00:40.000Z', consumedIds: ['c1'], ok: true, wasShortened: false, discardedByCap: 0, discardedByCapClient: 0 },
      { t: 'manual', at: '2026-08-01T10:01:00.000Z', mode: 'information', text: 'Ward council at five.', speaker: null, isHeader: false },
      { t: 'manual', at: '2026-08-01T10:02:00.000Z', mode: 'song', text: 'Music is playing.', speaker: null, isHeader: false },
      { t: 'manual', at: '2026-08-01T10:06:00.000Z', mode: 'speaker', text: 'Closing remarks.', speaker: null, isHeader: false }
    ]
  });

  const out = run(dir);

  assert.match(out, /typed/, 'the listing must have a column for them at all');
  // Hand-counted from the fixture above: 1 chunk, 1 call, 3 typed, 0 failed, 0 short, 0 lost.
  assert.match(out, /typed-session\s+6m\s+1\s+1\s+3\s+0\s+0\s+0\b/);
});
