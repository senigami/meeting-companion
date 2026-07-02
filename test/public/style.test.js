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
  assert.match(css, /human\.svg/);
  assert.match(css, /\.mode-icon/);
  assert.match(css, /\.mode-icon\.icon-speaker/);
  assert.match(css, /\.mode-icon\.icon-information/);
  assert.match(css, /\.mode-icon\.icon-song/);
  assert.match(css, /\.mode-icon\.icon-prayer/);
  assert.match(css, /\.transcript-item--manual/);
  assert.match(css, /\.transcript-item\s+\.icon-human/);
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
  assert.match(css, /\.railResizeHandle/);
  assert.match(css, /\.manualBar/);
  assert.match(css, /\.railTranscript/);
  assert.match(css, /\.settingsOverlay/);
  assert.match(css, /\.settingsModal/);
  assert.match(css, /\.settingsBody/);
  assert.match(css, /\.settingsNav/);
  assert.match(css, /\.settingsDetail/);
  assert.match(css, /\.settingsCard/);
  assert.match(css, /\.settingsViewCard/);
  assert.match(css, /\.providerCard/);
  assert.match(css, /\.providerReveal/);
  assert.match(css, /\.apiKeyBox/);
  assert.match(css, /\.iconButton/);
  assert.match(css, /\.settingsOverlay\[hidden\]/);
});

test('operator rail header stacks so alert and settings buttons do not clip', async () => {
  const css = await readSplitCss();

  assert.match(css, /\.railTop[\s\S]*flex-direction:\s*column;/s);
  assert.match(css, /\.railActions[\s\S]*flex-wrap:\s*wrap;/s);
  assert.match(css, /\.railActions[\s\S]*justify-content:\s*flex-start;/s);
});

test('display text stays centered and viewport-safe', async () => {
  const css = await readSplitCss();

  assert.match(css, /html,\s*body,\s*#root\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /--operator-rail-width:\s*220px;/);
  assert.match(css, /\.meetingShell[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) clamp\(180px, var\(--operator-rail-width, 220px\), calc\(100dvw - 320px\)\);/s);
  assert.match(css, /\.meetingShell[\s\S]*grid-template-areas:\s*"display rail"/s);
  assert.match(css, /\.displayPanel[\s\S]*height:\s*100%;/s);
  assert.match(css, /\.operatorRail[\s\S]*overflow:\s*hidden;/s);
  assert.match(css, /\.railResizeHandle[\s\S]*cursor:\s*col-resize;/s);
  assert.match(css, /\.railBody[\s\S]*overflow-y:\s*auto;/s);
  assert.match(css, /\.manualBar[\s\S]*grid-area:\s*manual;/s);
  assert.match(css, /\.manualBarInner[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/s);
  assert.match(css, /\.quickControlsGrid[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(5\.5rem, 1fr\)\);/s);
  assert.match(css, /\.quickControlsGrid[\s\S]*grid-auto-flow:\s*row dense;/s);
  assert.match(css, /\.quickControlsGrid button[\s\S]*grid-template-rows:\s*24px auto;/s);
  assert.match(css, /\.railButton[\s\S]*min-height:\s*48px;/s);
  assert.match(css, /\.modeGrid[\s\S]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /\.settingsOverlay\.settingsModal[\s\S]*width:\s*min\(960px, calc\(100vw - 2rem\)\);/s);
  assert.match(css, /\.settingsCard[\s\S]*display:\s*grid;/s);
  assert.match(css, /\.settingsBody[\s\S]*grid-template-columns:\s*180px minmax\(0, 1fr\);/s);
  assert.match(css, /\.settingsDetail \[data-settings-section\]\[hidden\][\s\S]*display:\s*none !important;/s);
  assert.match(css, /\.providerOption\[hidden\][\s\S]*display:\s*none !important;/s);
  assert.match(css, /\.settingsOverlay\.settingsModal::backdrop[\s\S]*background:\s*rgba\(0, 0, 0, 0\.5\);/s);
  assert.match(css, /\.displayPanel::before[\s\S]*\.displayPanel::after\s*\{/s);
  assert.match(css, /\.displayPanel\[data-margin-guides='true'\]::before[\s\S]*opacity:\s*0\.9;/s);
  assert.match(css, /html\.is-adjusting-display-margin \.displayPanel[\s\S]*opacity:\s*0\.5;/s);
  assert.match(css, /html\.is-adjusting-display-margin \.viewDrawer\.is-open \.viewDrawerShell[\s\S]*opacity:\s*0\.5;/s);
  assert.match(css, /html\.is-adjusting-display-margin \.viewDrawer\.is-open \.viewDrawerShell[\s\S]*pointer-events:\s*none;/s);
  assert.match(css, /\.transcript-viewport\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.transcript-viewport\s*\{[^}]*padding-inline:\s*var\(--display-margin\);/s);
  assert.match(css, /\.transcript-stack\s*\{[^}]*width:\s*100%;/s);
  assert.match(css, /\.transcript-stack\s*\{[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.transcript-item\s*\{[^}]*animation:\s*transcriptIn 420ms ease-out both;/s);
  assert.match(css, /\.transcript-text\s*\{[^}]*font-size:\s*var\(--font-size\);/s);
});

test('layout stacks and scrolls on narrower screens', async () => {
  const css = await readSplitCss();

  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*html,\s*body,\s*#root\s*\{\s*overflow:\s*auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.meetingShell[\s\S]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.meetingShell[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.operatorRail[\s\S]*flex-direction:\s*row;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.railResizeHandle[\s\S]*display:\s*none;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.manualBarInner[\s\S]*grid-template-columns:\s*1fr auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.settingsModal[\s\S]*width:\s*100%;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.railTranscriptDisclosure[\s\S]*min-width:/s);
});

test('very narrow screens collapse the rail header and quick controls', async () => {
  const css = await readSplitCss();

  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.railTop[\s\S]*flex-direction:\s*column;/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.railActions[\s\S]*flex-wrap:\s*wrap;/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.quickControlsGrid[\s\S]*grid-template-columns:\s*1fr;/s);
});

test('range sliders use discrete Apple-style tick marks', async () => {
  const css = await readSplitCss();

  assert.match(css, /#fontSize\s*\{\s*--slider-points:\s*31;/);
  assert.match(css, /#displayMargin\s*\{\s*--slider-points:\s*21;/);
  assert.match(css, /#summaryInterval\s*\{\s*--slider-points:\s*4;/);
  assert.match(css, /\.sliderVisual/);
  assert.match(css, /\.sliderTrack/);
  assert.match(css, /\.sliderThumb/);
  assert.match(css, /radial-gradient\(circle at left center, var\(--slider-dot\)/);
  assert.match(css, /radial-gradient\(circle at right center, var\(--slider-dot\)/);
});

test('collapsed rail narrows the grid track and hides labels', async () => {
  const css = await readSplitCss();

  assert.match(css, /html\.is-rail-collapsed \.meetingShell[\s\S]*--operator-rail-width:\s*64px;/s);
  assert.match(css, /html\.is-rail-collapsed \.meetingShell[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 64px;/s);
  assert.match(css, /html\.is-rail-collapsed \.buttonLabel[\s\S]*display:\s*none;/s);
  assert.match(css, /html\.is-rail-collapsed \.railResizeHandle[\s\S]*display:\s*none;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*#railCollapseToggle[\s\S]*display:\s*none;/s);
});

test('rail collapse transitions are smooth and honor reduced motion', async () => {
  const css = await readSplitCss();

  assert.match(
    css,
    /@media \(prefers-reduced-motion: no-preference\)[\s\S]*grid-template-columns 220ms cubic-bezier\(0\.25, 0\.1, 0\.25, 1\)/s
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: no-preference\)[\s\S]*\.buttonLabel[\s\S]*transition:\s*opacity 150ms/s
  );
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition:\s*none !important;/s);
});

test('chrome token tier is declared for operator surfaces', async () => {
  const css = await readSplitCss();

  assert.match(css, /--chrome-bg:/);
  assert.match(css, /--chrome-bg-elevated:/);
  assert.match(css, /--chrome-bg-control:/);
  assert.match(css, /--chrome-bg-control-hover:/);
  assert.match(css, /--chrome-separator:/);
  assert.match(css, /--chrome-text:/);
  assert.match(css, /--chrome-text-secondary:/);
  assert.match(css, /--chrome-accent:/);
  assert.match(css, /--chrome-radius-sm:/);
  assert.match(css, /--chrome-radius-md:/);
  assert.match(css, /--chrome-radius-lg:/);
  assert.match(css, /--chrome-space-1:/);
  assert.match(css, /--chrome-space-2:/);
  assert.match(css, /--chrome-space-3:/);
  assert.match(css, /--chrome-space-4:/);
  assert.match(css, /--chrome-space-5:/);
  assert.match(css, /--chrome-focus-ring-width:/);
  assert.match(css, /--chrome-focus-ring-offset:/);
});

test('paused state is loud on the pause button and the rail in both expanded and collapsed layouts', async () => {
  const css = await readSplitCss();

  assert.match(css, /#pauseAi\.is-paused[\s\S]*background:\s*var\(--pause-amber\);/s);
  assert.match(css, /\.operatorRail\.is-paused[\s\S]*border-top-color:\s*var\(--pause-amber, #ffc15c\);/s);
  assert.match(
    css,
    /html\.is-rail-collapsed \.operatorRail\.is-paused #pauseAi[\s\S]*box-shadow:\s*0 0 0 2px var\(--pause-amber, #ffc15c\);/s
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: no-preference\)[\s\S]*#pauseAi\.is-paused[\s\S]*animation:\s*pauseAmberPulse/s
  );
});
