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

test('helper panel exposes secondary disclosure styling hooks', async () => {
  const css = await readFile(new URL('../../public/style.css', import.meta.url), 'utf8');

  assert.match(css, /\.app-shell/);
  assert.match(css, /\.panel-main/);
  assert.match(css, /\.panel-footer/);
  assert.match(css, /\.helper-primary/);
  assert.match(css, /\.section\.helper-primary/);
  assert.match(css, /\.helper-disclosure/);
  assert.match(css, /summary\.helper-disclosure-summary/);
  assert.match(css, /\.helper-disclosure-body/);
  assert.match(css, /summary\.helper-disclosure-summary:focus-visible/);
  assert.match(css, /details\.helper-disclosure\[open\]/);
  assert.doesNotMatch(css, /\.helper-primary > \.section/);
});

test('display text is centered in the viewing area', async () => {
  const css = await readFile(new URL('../../public/style.css', import.meta.url), 'utf8');

  assert.match(css, /\.display-panel\s*\{[^}]*place-items:\s*stretch;/s);
  assert.match(css, /\.transcript-viewport\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.transcript-stack\s*\{[^}]*justify-content:\s*flex-end;/s);
  assert.match(css, /\.transcript-item\s*\{/s);
  assert.match(css, /\.transcript-text\s*\{[^}]*font-size:\s*clamp\(2\.25rem, 5vw, 5\.5rem\);/s);
});

test('layout stacks and scrolls on narrower screens', async () => {
  const css = await readFile(new URL('../../public/style.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*body\s*\{\s*overflow:\s*auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.app-shell\s*\{\s*grid-template-columns:\s*1fr;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.display-panel\s*\{\s*min-height:\s*52svh;/s);
});

test('range sliders use discrete Apple-style tick marks', async () => {
  const css = await readFile(new URL('../../public/style.css', import.meta.url), 'utf8');

  assert.match(css, /#fontSize\s*\{\s*--slider-points:\s*23;/);
  assert.match(css, /#displayMargin\s*\{\s*--slider-points:\s*21;/);
  assert.match(css, /#summaryInterval\s*\{\s*--slider-points:\s*4;/);
  assert.match(css, /::-webkit-slider-runnable-track/);
  assert.match(css, /::-moz-range-track/);
  assert.match(css, /radial-gradient\(circle at left center, var\(--slider-dot\)/);
  assert.match(css, /radial-gradient\(circle at right center, var\(--slider-dot\)/);
});
