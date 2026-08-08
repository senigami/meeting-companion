import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Recomputed straight from git rather than from server/app-commit.js -- this is the "outside the
// code under test" value the match/mismatch behaviour is checked against. The -dirty suffix matters
// here: run in a working tree with uncommitted edits, a recording stamped with the bare hash SHOULD
// warn, because the code that produced it is not the code at that commit (issue #4).
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const DIRTY = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
const CURRENT_COMMIT = DIRTY ? `${HEAD}-dirty` : HEAD;

function writeRecording(lines) {
  const dir = mkdtempSync(path.join(tmpdir(), 'replay-recording-test-'));
  const file = path.join(dir, 'session.ndjson');
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  return file;
}

function runReplay(file) {
  try {
    return execFileSync('node', ['scripts/replay-recording.js', file], { encoding: 'utf8' });
  } catch (error) {
    // The script never throws on a well-formed file; surfacing stdout+stderr here makes a genuine
    // failure legible instead of just "exit code 1".
    throw new Error(`replay-recording.js failed: ${error.stdout || ''}${error.stderr || ''}`);
  }
}

test('replay-recording prints the header and does not warn when the recorded commit matches the current one', () => {
  const file = writeRecording([
    { t: 'header', appCommit: CURRENT_COMMIT, promptHash: 'deadbeef', maxWords: 15, provider: 'openai', intervalSeconds: 5 }
  ]);

  const output = runReplay(file);
  assert.match(output, /header: commit=/);
  assert.match(output, /matches the current checkout/);
  assert.ok(!/WARNING/.test(output), 'a matching commit must not print a warning');
});

test('replay-recording WARNS when the recorded commit does not match the current checkout', () => {
  const file = writeRecording([
    { t: 'header', appCommit: 'not-a-real-commit-0000000', promptHash: 'deadbeef', maxWords: 15, provider: 'openai', intervalSeconds: 5 }
  ]);

  const output = runReplay(file);
  assert.match(output, /WARNING:.*commit .*not-a-real-commit-0000000/s);
});

test('replay-recording still replays a headerless (old) recording, and says so explicitly rather than pretending it matched', () => {
  const file = writeRecording([
    { t: 'chunk', at: new Date().toISOString(), id: '1', mode: 'speaker', text: 'hello' },
    { t: 'summary', at: new Date().toISOString(), mode: 'speaker', consumedIds: ['1'], sent: 'hello', returned: 'Hello.', provider: 'openai', ok: true }
  ]);

  const output = runReplay(file);
  assert.match(output, /No header record/);
  assert.ok(!/WARNING/.test(output), 'a headerless file has nothing to compare, so it must not fabricate a mismatch warning');
  assert.match(output, /1 chunk\(s\), 1 summarize call\(s\)/, 'the rest of the replay must still work with no header present');
});

test('a recording stamped with a bare commit warns when the checkout it is replayed in is dirty', { skip: DIRTY ? false : 'this checkout is clean' }, () => {
  const file = writeRecording([
    { t: 'header', appCommit: HEAD, promptHash: 'deadbeef', maxWords: 15, provider: 'openai', intervalSeconds: 5 }
  ]);

  const output = runReplay(file);
  assert.match(output, /WARNING/, 'a clean-hash recording must not read as matching a dirty checkout');
});
