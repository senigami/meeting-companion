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

  assert.match(css, /\.meetingShell/);
  assert.match(css, /\.operatorRail/);
  assert.match(css, /\.railHeader/);
  assert.match(css, /\.railBody/);
  assert.match(css, /\.railButton/);
  assert.match(css, /\.manualBar/);
  assert.match(css, /\.settingsPanel/);
  assert.match(css, /\.settingsBackdrop/);
  assert.match(css, /\.settingsSection/);
  assert.match(css, /\.settingsStack/);
  assert.match(css, /\.settingsDetailsBody/);
  assert.match(css, /\.iconButton/);
});

test('display text is centered in the viewing area', async () => {
  const css = await readFile(new URL('../../public/style.css', import.meta.url), 'utf8');

  assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.meetingShell[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) clamp\(140px, 12vw, 180px\);/s);
  assert.match(css, /\.meetingShell[\s\S]*grid-template-areas:\s*"display rail"/s);
  assert.match(css, /\.displayPanel[\s\S]*height:\s*100%;/s);
  assert.match(css, /\.operatorRail[\s\S]*overflow:\s*hidden;/s);
  assert.match(css, /\.railBody[\s\S]*overflow-y:\s*auto;/s);
  assert.match(css, /\.manualBar[\s\S]*grid-area:\s*manual;/s);
  assert.match(css, /\.manualBarInner[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/s);
  assert.match(css, /\.quickControlsGrid[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
  assert.match(css, /\.modeGrid[\s\S]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /\.settingsPanel[\s\S]*position:\s*fixed;/s);
  assert.match(css, /\.settingsStack[\s\S]*flex-direction:\s*column;/s);
  assert.match(css, /\.transcript-viewport\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.transcript-text\s*\{[^}]*font-size:\s*clamp\(2rem, min\(5vw, 7vh\), 5\.25rem\);/s);
});

test('layout stacks and scrolls on narrower screens', async () => {
  const css = await readFile(new URL('../../public/style.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*html,\s*body,\s*#root\s*\{\s*overflow:\s*auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.meetingShell[\s\S]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.meetingShell[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.operatorRail[\s\S]*flex-direction:\s*row;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.manualBarInner[\s\S]*grid-template-columns:\s*1fr auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.settingsPanel[\s\S]*bottom:\s*0\.5rem;/s);
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
