import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

function readHtml() {
  return readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
}

async function readSplitCss() {
  const base = new URL('../../public/', import.meta.url);
  const files = ['style.css'];
  const stylesDir = new URL('styles/', base);

  for (const entry of await readdir(stylesDir)) {
    if (entry.endsWith('.css')) files.push(`styles/${entry}`);
  }

  files.sort();
  const contents = await Promise.all(files.map((file) => readFile(new URL(file, base), 'utf8')));
  return contents.join('\n');
}

test('#railNote is a live region mounted in the accessibility tree from page load, not hidden by default', async () => {
  const html = await readHtml();
  const match = html.match(/<div id="railNote"[^>]*>/);

  assert.ok(match, '#railNote should exist');
  const tag = match[0];
  // No `hidden` attribute: toggling `hidden` in step with the text (appear + speak in the same
  // tick) is a known AT announcement race -- the region must already be registered before content
  // lands in it. Visibility when empty is handled purely by CSS (see .railNote:empty).
  assert.doesNotMatch(tag, /\bhidden\b/);
  assert.match(tag, /role="status"/);
  assert.match(tag, /aria-live="polite"/);
});

test('.railNote collapses to zero footprint when empty instead of relying on `hidden`', async () => {
  const css = await readSplitCss();

  assert.match(css, /\.railNote:empty\s*\{[^}]*padding:\s*0;/s);
});

test('.railNote.is-problem is legible at AA contrast and not colour-only (WCAG 1.4.3 / 1.4.1)', async () => {
  const css = await readSplitCss();

  // #ff453a on --chrome-bg (#1e1e1e) measures 4.89:1 in-browser -- verified live, not just
  // computed -- clearing the 4.5:1 AA threshold for this 12px text.
  assert.match(css, /\.railNote\.is-problem\s*\{[^}]*color:\s*#ff453a;/s);
});
