import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function readHtml() {
  return readFile(new URL('../../public/reading-pace.html', import.meta.url), 'utf8');
}

test('reading-pace page is not linked from the main app UI', async () => {
  const indexHtml = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(indexHtml, /reading-pace/);
});

test('reading-pace page has an intro screen with a START button and no timer/score language', async () => {
  const html = await readHtml();

  assert.match(html, /id="introScreen"/);
  assert.match(html, /id="startButton"/);
  assert.match(html, /START/);

  // Never call it a test, trial, or measurement in anything he sees; never a timer/score/speed.
  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(visibleText, /\btest\b/i);
  assert.doesNotMatch(visibleText, /\btrial\b/i);
  assert.doesNotMatch(visibleText, /\bmeasur\w*\b/i);
  assert.doesNotMatch(visibleText, /\bscore\b/i);
  assert.doesNotMatch(visibleText, /\btoo slow\b/i);
  assert.doesNotMatch(visibleText, /<audio\b/i);
});

test('reading-pace page has a card screen reusing the real transcript-item/transcript-text card styling', async () => {
  const html = await readHtml();
  assert.match(html, /id="cardScreen"/);
  assert.match(html, /class="[^"]*transcript-item[^"]*"/);
  assert.match(html, /class="[^"]*transcript-text[^"]*"/);
  assert.match(html, /id="nextButton"/);
});

test('reading-pace page has a closing screen', async () => {
  const html = await readHtml();
  assert.match(html, /id="doneScreen"/);
  assert.match(html, /All done/);
});

test('reading-pace page has a results view gated behind rendering, not linked from the flow', async () => {
  const html = await readHtml();
  assert.match(html, /id="resultsScreen"/);
  assert.match(html, /id="resultsRawJson"/);
  assert.match(html, /id="downloadResults"/);
  assert.match(html, /id="resultsMedian"/);
  // No link or button in the markup points at ?results -- it's reached only by typing the URL.
  assert.doesNotMatch(html, /href="[^"]*\?results/);
});

test('reading-pace page loads its own stylesheet and module script, not app.js', async () => {
  const html = await readHtml();
  assert.match(html, /styles\/reading-pace\.css/);
  assert.match(html, /type="module" src="reading-pace\.js"/);
  assert.doesNotMatch(html, /app\.js/);
});
