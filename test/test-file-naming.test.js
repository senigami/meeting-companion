import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #111. `npm test` is a bare `node --test`, which collects files by NAME, so a script that merely
// happens to be called `*-test.js` becomes part of the suite. That is how `scripts/battering-test.js`
// (a real-API tool costing real tokens) ended up failing the whole suite for anyone without an
// OPENAI_API_KEY, while its own header said it was not part of `npm test`.
//
// Renaming that file fixed the instance. This fixes the class: the next person to pick such a name
// fails here, at the moment they pick it, rather than on a machine with no key where it looks like a
// genuine test failure.
//
// Patterns are node --test's own defaults, restated here because there is no API to ask node what it
// would collect. If a future node adds a pattern this list will be short, which fails safe: the guard
// gets weaker, never wrong.
const COLLECTED_PATTERNS = [
  /\.test\.[cm]?js$/,
  /-test\.[cm]?js$/,
  /_test\.[cm]?js$/,
  /^test-.*\.[cm]?js$/,
  /^test\.[cm]?js$/
];

const REPO_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// node --test also collects everything under a `test/` directory regardless of name, which is exactly
// where tests belong, so `test/` is the one place these names are correct.
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'vendor', 'recordings', 'test-reports', '.agent', 'coverage']);

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, found);
      continue;
    }
    if (COLLECTED_PATTERNS.some((pattern) => pattern.test(entry))) {
      found.push(path.relative(REPO_DIR, full));
    }
  }
  return found;
}

test('no file outside test/ is named so that `node --test` would collect it as a test', () => {
  const offenders = walk(REPO_DIR);

  assert.deepEqual(
    offenders,
    [],
    `These files are not tests but \`npm test\` will run them as tests, because it collects by name:\n` +
      `  ${offenders.join('\n  ')}\n` +
      `Rename them (scripts/battering-run.js is the precedent) or move them under test/.`
  );
});

test('the guard actually recognises the name that caused #111', () => {
  // Supplied from outside the walk, so this checks the patterns rather than the current tree being
  // clean. A guard whose only evidence is "nothing found" cannot tell working from broken.
  const wouldBeCollected = (name) => COLLECTED_PATTERNS.some((pattern) => pattern.test(name));

  assert.equal(wouldBeCollected('battering-test.js'), true, 'the original #111 filename');
  assert.equal(wouldBeCollected('foo.test.js'), true);
  assert.equal(wouldBeCollected('foo_test.mjs'), true);
  assert.equal(wouldBeCollected('test-helpers.js'), true);
  assert.equal(wouldBeCollected('test.js'), true);

  assert.equal(wouldBeCollected('battering-run.js'), false, 'the name it was renamed to');
  assert.equal(wouldBeCollected('list-recordings.js'), false);
  assert.equal(wouldBeCollected('latest.js'), false, 'ends in "test" but not "-test"');
  assert.equal(wouldBeCollected('protest.js'), false);
});
