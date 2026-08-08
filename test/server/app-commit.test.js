import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveAppCommit } from '../../server/app-commit.js';

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'app-commit-test-'));
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  run('init', '-q');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(path.join(dir, 'a.txt'), 'one\n', 'utf8');
  run('add', 'a.txt');
  run('commit', '-qm', 'first');
  return { dir, run };
}

test('a clean checkout resolves to the bare commit hash', () => {
  const { dir, run } = makeRepo();
  const head = run('rev-parse', 'HEAD').trim();
  assert.equal(resolveAppCommit(dir), head);
});

test('a working tree with uncommitted changes is marked -dirty, so a recording cannot claim a provenance it does not have (issue #4)', () => {
  const { dir, run } = makeRepo();
  const head = run('rev-parse', 'HEAD').trim();
  writeFileSync(path.join(dir, 'a.txt'), 'two\n', 'utf8');
  assert.equal(resolveAppCommit(dir), `${head}-dirty`);
});

test('an untracked file also counts as dirty', () => {
  const { dir, run } = makeRepo();
  const head = run('rev-parse', 'HEAD').trim();
  writeFileSync(path.join(dir, 'b.txt'), 'new\n', 'utf8');
  assert.equal(resolveAppCommit(dir), `${head}-dirty`);
});

test('a directory that is not a git checkout resolves to "unknown", never an empty string or a throw', () => {
  const notARepo = mkdtempSync(path.join(tmpdir(), 'app-commit-nogit-'));
  assert.equal(resolveAppCommit(notARepo), 'unknown');
});
