import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

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

test('mode icons use svg masks', async () => {
  const css = await readSplitCss();

  assert.match(css, /speaker\.svg/);
  assert.match(css, /information\.svg/);
  assert.match(css, /song\.svg/);
  assert.match(css, /prayer\.svg/);
  assert.doesNotMatch(css, /speaker\.png/);
  assert.doesNotMatch(css, /information\.png/);
  assert.doesNotMatch(css, /song\.png/);
  assert.doesNotMatch(css, /prayer\.png/);
});

test('operator rail and settings modal expose compact responsive hooks', async () => {
  const css = await readSplitCss();

  assert.match(css, /\.meetingShell/);
  assert.match(css, /\.operatorRail/);
  assert.match(css, /\.railTop/);
  assert.match(css, /\.railActions/);
  assert.match(css, /\.railBody/);
  assert.match(css, /\.railButton/);
  assert.match(css, /\.manualBar/);
  assert.match(css, /\.railTranscript/);
  assert.match(css, /\.settingsOverlay/);
  assert.match(css, /\.settingsModal/);
  assert.match(css, /\.settingsBody/);
  assert.match(css, /\.settingsGrid/);
  assert.match(css, /\.settingsCard/);
  assert.match(css, /\.providerCard/);
  assert.match(css, /\.apiKeyBox/);
  assert.match(css, /\.iconButton/);
  assert.match(css, /\.settingsOverlay\[hidden\]/);
});

test('display text stays centered and viewport-safe', async () => {
  const css = await readSplitCss();

  assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.meetingShell[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) clamp\(140px, 12vw, 180px\);/s);
  assert.match(css, /\.meetingShell[\s\S]*grid-template-areas:\s*"display rail"/s);
  assert.match(css, /\.displayPanel[\s\S]*height:\s*100%;/s);
  assert.match(css, /\.operatorRail[\s\S]*overflow:\s*hidden;/s);
  assert.match(css, /\.railBody[\s\S]*overflow-y:\s*auto;/s);
  assert.match(css, /\.manualBar[\s\S]*grid-area:\s*manual;/s);
  assert.match(css, /\.manualBarInner[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/s);
  assert.match(css, /\.quickControlsGrid[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
  assert.match(css, /\.quickControlsGrid button[\s\S]*grid-template-rows:\s*24px auto;/s);
  assert.match(css, /\.railButton[\s\S]*min-height:\s*48px;/s);
  assert.match(css, /\.modeGrid[\s\S]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /\.settingsOverlay\.settingsModal[\s\S]*width:\s*min\(960px, calc\(100vw - 2rem\)\);/s);
  assert.match(css, /\.settingsCard[\s\S]*display:\s*grid;/s);
  assert.match(css, /\.settingsGrid[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
  assert.match(css, /\.settingsOverlay\.settingsModal::backdrop[\s\S]*backdrop-filter:\s*blur\(18px\);/s);
  assert.match(css, /\.displayPanel::before[\s\S]*\.displayPanel::after\s*\{/s);
  assert.match(css, /\.displayPanel\[data-margin-guides='true'\]::before[\s\S]*opacity:\s*0\.68;/s);
  assert.match(css, /\.transcript-viewport\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.transcript-text\s*\{[^}]*font-size:\s*clamp\(2rem, min\(4\.8vw, 7vh\), 5\.15rem\);/s);
});

test('layout stacks and scrolls on narrower screens', async () => {
  const css = await readSplitCss();

  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*html,\s*body,\s*#root\s*\{\s*overflow:\s*auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.meetingShell[\s\S]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.meetingShell[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.operatorRail[\s\S]*flex-direction:\s*row;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.manualBarInner[\s\S]*grid-template-columns:\s*1fr auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.settingsModal[\s\S]*width:\s*100%;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.railTranscriptDisclosure[\s\S]*min-width:/s);
});

test('range sliders use discrete Apple-style tick marks', async () => {
  const css = await readSplitCss();

  assert.match(css, /#fontSize\s*\{\s*--slider-points:\s*23;/);
  assert.match(css, /#displayMargin\s*\{\s*--slider-points:\s*21;/);
  assert.match(css, /#summaryInterval\s*\{\s*--slider-points:\s*4;/);
  assert.match(css, /::-webkit-slider-runnable-track/);
  assert.match(css, /::-moz-range-track/);
  assert.match(css, /radial-gradient\(circle at left center, var\(--slider-dot\)/);
  assert.match(css, /radial-gradient\(circle at right center, var\(--slider-dot\)/);
});
