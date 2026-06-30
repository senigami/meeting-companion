import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mode icons use svg masks', async () => {
  const css = await readFile(new URL('../../public/style.css', import.meta.url), 'utf8');

  assert.match(css, /speaker\.svg/);
  assert.match(css, /information\.svg/);
  assert.match(css, /song\.svg/);
  assert.match(css, /prayer\.svg/);
  assert.doesNotMatch(css, /speaker\.png/);
  assert.doesNotMatch(css, /information\.png/);
  assert.doesNotMatch(css, /song\.png/);
  assert.doesNotMatch(css, /prayer\.png/);
});
