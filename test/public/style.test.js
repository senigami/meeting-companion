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
  // Mode buttons are a compact icon grid (square-ish, sit next to each
  // other) rather than a single-column list of full-width rows.
  assert.match(css, /\.modeGrid[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(4\.75rem, 1fr\)\);/s);
  assert.match(css, /\.modeGrid \.mode[\s\S]*grid-template-rows:\s*24px auto;/s);
  assert.match(css, /\.modeGrid \.mode[\s\S]*min-height:\s*clamp\(44px, 5\.5vh, 58px\);/s);
  assert.match(css, /\.settingsOverlay\.settingsModal[\s\S]*width:\s*min\(960px, calc\(100vw - 2rem\)\);/s);
  assert.match(css, /\.settingsCard[\s\S]*display:\s*grid;/s);
  assert.match(css, /\.settingsBody[\s\S]*grid-template-columns:\s*180px minmax\(0, 1fr\);/s);
  assert.match(css, /\.settingsDetail \[data-settings-section\]\[hidden\][\s\S]*display:\s*none !important;/s);
  assert.match(css, /\.providerOption\[hidden\][\s\S]*display:\s*none !important;/s);
  assert.match(css, /\.settingsOverlay\.settingsModal::backdrop[\s\S]*background:\s*rgba\(0, 0, 0, 0\.5\);/s);
  assert.match(css, /\.displayPanel::before[\s\S]*\.displayPanel::after\s*\{/s);
  assert.match(css, /\.displayPanel\[data-margin-guides='true'\]::before[\s\S]*opacity:\s*0\.9;/s);
  assert.match(css, /html\.is-adjusting-display-margin \.displayPanel[\s\S]*opacity:\s*0\.5;/s);
  // While dragging Text size or Margins, the drawer's own chrome (not
  // its whole-element opacity, which would also dim the active slider)
  // goes fully transparent so the TV canvas underneath is fully visible.
  assert.match(css, /\.viewDrawerShell\.is-adjusting-slider-shell\s*\{[^}]*background:\s*transparent;/s);
  // The header (title + Close button) fades out too -- it's a sibling
  // of .viewDrawerBody, not an ancestor of the active field, so this
  // carries no opacity-compounding risk.
  assert.match(css, /\.viewDrawerShell\.is-adjusting-slider-shell \.viewDrawerHeader\s*\{[^}]*opacity:\s*0;/s);
  // Every field except the one being dragged disappears completely
  // (opacity 0); the active field stays at 80% opacity -- clearly
  // visible and operable without fully blocking the view behind it.
  // The fade targets .range-field directly (not a shared wrapping
  // container like .settingsStack) -- opacity compounds down the tree,
  // so fading an ancestor of the active field would silently drag its
  // 0.8 down with it.
  assert.match(css, /\.viewDrawerBody\.is-adjusting-slider \.range-field:not\(\.is-active-slider-field\)[\s\S]*opacity:\s*0;/s);
  assert.match(css, /\.range-field\.is-active-slider-field\s*\{[^}]*opacity:\s*0\.8;/s);
  assert.match(css, /\.transcript-viewport\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.transcript-viewport\s*\{[^}]*padding-inline:\s*var\(--display-margin\);/s);
  assert.match(css, /\.transcript-stack\s*\{[^}]*width:\s*100%;/s);
  assert.match(css, /\.transcript-stack\s*\{[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.transcript-item\s*\{[^}]*animation:\s*transcriptIn 420ms ease-out both;/s);
  assert.match(css, /\.transcript-text\s*\{[^}]*font-size:\s*var\(--font-size\);/s);
});

test('mobile is a full-screen home: display fills the screen, Mode and manual bar are pinned chrome', async () => {
  const css = await readSplitCss();

  assert.match(css, /@media \(max-width: 900px\)/);
  // A fixed-height (100dvh), non-scrolling page -- the display panel is
  // the only thing that grows; everything else is fixed-size chrome
  // stacked around it via flex `order`, not position:fixed/page-scroll.
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*html,\s*body,\s*#root\s*\{\s*height:\s*100dvh;\s*min-height:\s*100dvh;\s*overflow:\s*hidden;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.meetingShell\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.displayPanel\s*\{\s*order:\s*2;\s*flex:\s*1 1 auto;/s);
  // .operatorRail/.railBody go `display:contents` on mobile so their
  // children (.railTopBar, .modeBar, .drawerContent) become independent
  // flex items of .meetingShell instead of one fixed-height side rail.
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.operatorRail,\s*\n\s*\.railBody\s*\{\s*display:\s*contents;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.railTopBar\s*\{[^}]*order:\s*1;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.modeBar\s*\{[^}]*order:\s*3;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*#manualBar\s*\{[^}]*order:\s*4;/s);
  // The Quick Controls/transcript drawer is a bottom sheet overlay,
  // shown via .is-open, taken out of the flex flow entirely via
  // position:fixed so it doesn't consume a flex slot.
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.drawerContent\s*\{[^}]*position:\s*fixed;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.drawerContent\.is-open\s*\{\s*transform:\s*translateY\(0\);/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.railResizeHandle[\s\S]*display:\s*none;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.manualBarInner[\s\S]*grid-template-columns:\s*1fr auto;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.settingsModal[\s\S]*width:\s*100%;/s);
  // The "Manual"/listening status pill sits inline in the brand row as a
  // compact badge (not a stretched full-width row of its own) so it
  // doesn't cost the display panel a whole extra line.
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.railTop\s*\{[^}]*flex-direction:\s*row;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.railStatus\s*\{[^}]*flex:\s*0 0 auto;/s);
  // Mode sits directly above the manual-line bar with a tightened gap,
  // not the wider spacing used between the other chrome pieces.
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.modeBar\s*\{[^}]*margin-bottom:\s*-0\.4rem;/s);
});

test('very narrow screens collapse the rail header and quick controls', async () => {
  const css = await readSplitCss();

  assert.match(css, /@media \(max-width: 640px\)/);
  // Quick Controls stays a compact multi-column icon grid at this width
  // too (sits next to Mode's grid, same compact treatment) rather than
  // being forced back to one full-width button per row.
  assert.doesNotMatch(css, /@media \(max-width: 640px\)[\s\S]*\.quickControlsGrid[^}]*grid-template-columns:\s*1fr;/s);
});

test('short windows compress the rail chrome without touching the TV canvas', async () => {
  const css = await readSplitCss();

  assert.match(css, /@media \(max-height: 760px\) and \(min-width: 901px\)/);
  assert.match(
    css,
    /@media \(max-height: 760px\) and \(min-width: 901px\)[\s\S]*\.railButton[\s\S]*min-height:\s*44px;/s
  );
  assert.match(
    css,
    /@media \(max-height: 760px\) and \(min-width: 901px\)[\s\S]*\.manualBar input,\s*\.manualBar button[\s\S]*height:\s*34px;/s
  );
  assert.match(css, /@media \(max-height: 600px\) and \(min-width: 901px\)/);
  assert.match(
    css,
    /@media \(max-height: 600px\) and \(min-width: 901px\)[\s\S]*\.quickControlsGrid \.buttonLabel[\s\S]*display:\s*none;/s
  );
  assert.match(
    css,
    /@media \(max-height: 600px\) and \(min-width: 901px\)[\s\S]*\.railTranscriptSection \.railTranscript[\s\S]*max-height:\s*3\.5rem;/s
  );
});

test('quick controls panel is an iOS-style sheet with a drag handle, not a full-screen panel', async () => {
  const css = await readSplitCss();

  // No more full-screen inset -- the sheet's height is JS-driven (see
  // quick-panel-sheet.js) between two measured snap points.
  assert.doesNotMatch(css, /@media \(max-width: 900px\)[\s\S]*\.drawerContent[^}]*inset:\s*0;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.drawerContent\s*\{[^}]*border-radius:\s*1\.1rem 1\.1rem 0 0;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.drawerContent\.is-dragging\s*\{\s*transition:\s*none;/s);
  // The handle is a small centered pill, not a header with a title/close
  // button. It's a short ~24px flat strip (Apple's real sheet-grabber
  // proportion), not a tall padded bar reserving 44px of blank visual
  // space -- the primary 44px open/close target is the icon in the top
  // bar; this is a supplementary drag/tap affordance.
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.quickPanelHandle\s*\{[^}]*height:\s*24px;/s);
  // base.css's shared `button` rule sets min-height:48px, which silently
  // wins over height:24px unless explicitly zeroed here -- that was
  // doubling the handle's real height and leaving a dead gap above
  // Quick Controls.
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.quickPanelHandle\s*\{[^}]*min-height:\s*0;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.quickPanelHandle\s*\{[^}]*align-items:\s*flex-start;/s);
  // Thinner than the textbook 36x5pt spec -- a flat CSS rectangle at the
  // exact spec size reads chunkier on the web than the native grabber's
  // subtler anti-aliasing, so this leans thinner/fainter to match how it
  // actually looks rather than just how it measures.
  assert.match(css, /\.quickPanelHandleGrip\s*\{[^}]*width:\s*34px;/s);
  assert.match(css, /\.quickPanelHandleGrip\s*\{[^}]*height:\s*3px;/s);
  assert.match(css, /\.quickPanelHandleGrip\s*\{[^}]*border-radius:\s*999px;/s);
  // The base `button` rule paints a light fill on :hover/:active -- that
  // would otherwise show through here too, turning the whole 24px strip
  // into a visible bar on hover/press. Must stay transparent explicitly.
  assert.match(
    css,
    /@media \(max-width: 900px\)[\s\S]*\.quickPanelHandle:hover,\s*\n\s*\.quickPanelHandle:active,\s*\n\s*\.quickPanelHandle:focus-visible\s*\{\s*background:\s*transparent;/s
  );
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.quickPanelScroll\s*\{[^}]*overflow-y:\s*auto;/s);
  // The header/close-button markup and the transcript's old collapsible
  // <details> disclosure are both gone -- confirm no CSS still targets
  // either dead class.
  assert.doesNotMatch(css, /\.quickPanelHeader\b/);
  assert.doesNotMatch(css, /\.helper-disclosure\b/);
});

test('range sliders are native inputs with a big custom-styled thumb', async () => {
  const css = await readSplitCss();

  // Native <input type="range">, heavily styled -- not a hand-rolled
  // JS slider -- so touch drag, tap-to-jump, and keyboard support all
  // come from the browser for free.
  assert.match(css, /\.sliderInput\s*\{[^}]*appearance:\s*none;/s);
  assert.match(css, /\.sliderInput\s*\{[^}]*background:\s*linear-gradient\(/s);
  assert.match(css, /\.sliderInput\s*\{[^}]*var\(--slider-fill, 50%\)/s);
  assert.match(css, /\.sliderInput::-webkit-slider-thumb\s*\{[^}]*width:\s*2rem;/s);
  assert.match(css, /\.sliderInput::-moz-range-thumb\s*\{[^}]*width:\s*2rem;/s);
  assert.match(css, /\.sliderInput:focus-visible\s*\{[^}]*outline:/s);
});

test('collapsed rail narrows the grid track and hides labels', async () => {
  const css = await readSplitCss();

  assert.match(css, /html\.is-rail-collapsed \.meetingShell[\s\S]*--operator-rail-width:\s*64px;/s);
  assert.match(css, /html\.is-rail-collapsed \.meetingShell[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 64px;/s);
  assert.match(css, /html\.is-rail-collapsed \.buttonLabel[\s\S]*display:\s*none;/s);
  assert.match(css, /html\.is-rail-collapsed \.railResizeHandle[\s\S]*display:\s*none;/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*#railCollapseToggle[\s\S]*display:\s*none;/s);
  assert.match(css, /html\.is-rail-collapsed \.railActions\s*\{[^}]*position:\s*static;[^}]*flex-direction:\s*column;/s);
  assert.match(css, /html\.is-rail-collapsed \.railSection,[\s\S]*background:\s*transparent;/s);
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

test('inactive transcript cards render at 0.8 opacity on the TV canvas', async () => {
  const css = await readSplitCss();

  assert.match(css, /\.transcript-item:not\(\[data-active="true"\]\)\s*\{[^}]*opacity:\s*0\.8;/s);
});

test('in-flight (sent, not yet consumed) transcript text is dimmed on the rail and honors reduced motion', async () => {
  const css = await readSplitCss();

  // Distinct from the TV canvas's inactive-card opacity (0.8) above -- this is an operator-only
  // rail affordance for text that has left for the summarizer but has not yet actually left the
  // bucket (INV-11), so it must read as "in flight," not merely "less important."
  assert.match(css, /\.transcriptChunk--inFlight\s*\{[^}]*opacity:\s*0\.45;/s);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: no-preference\)[\s\S]*\.transcriptChunk--inFlight[\s\S]*transition:\s*opacity 200ms/s
  );
});

test('rail status indicator exposes a dot and word, hiding only the word when collapsed', async () => {
  const css = await readSplitCss();

  assert.match(css, /\.railStatus\s*\{/);
  assert.match(css, /\.railStatusDot\s*\{/);
  assert.match(css, /\.railStatusDot\.is-level-listening[\s\S]*\{/);
  assert.match(css, /\.railStatusDot\.is-level-paused[\s\S]*\{/);
  assert.match(css, /\.railStatusDot\.is-level-manual[\s\S]*\{/);
  assert.match(css, /\.railStatusDot\.is-level-problem[\s\S]*\{/);
  assert.match(
    css,
    /html\.is-rail-collapsed \.buttonLabel[\s\S]*\.railStatusWord[\s\S]*display:\s*none;/s
  );
  assert.doesNotMatch(css, /html\.is-rail-collapsed \.railStatusDot\s*\{[^}]*display:\s*none;/s);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: no-preference\)[\s\S]*\.railStatusDot\.is-level-listening[\s\S]*animation:\s*railStatusPulse/s
  );
});

test('live transcript progress bar is scoped to the operator rail, honest about idle/overrun, and honors reduced motion', async () => {
  const css = await readSplitCss();

  assert.match(css, /\.railTranscriptFrame\s*\{[^}]*position:\s*relative;[^}]*\}/s);
  assert.match(css, /\.railTranscriptProgress\s*\{[^}]*position:\s*absolute;[^}]*\}/s);
  // Sweeping is gated under no-preference, not declared unconditionally -- the repo's blanket
  // `@media (prefers-reduced-motion: reduce) { *, ... { transition: none !important; } }` rule
  // (base.css) covers disabling it, so this new element inherits that contract for free rather
  // than needing its own override.
  assert.match(
    css,
    /@media \(prefers-reduced-motion: no-preference\)[\s\S]*\.railTranscriptProgressFill[\s\S]*transition-property:\s*width;/s
  );
  // Paused/stopped reads idle (not sweeping as if work were coming), and an overrun tick freezes
  // full rather than silently restarting a fresh, healthy-looking sweep (INV-10 applied here).
  assert.match(css, /\.railTranscriptProgress\[data-state="idle"\][\s\S]*\.railTranscriptProgressFill[\s\S]*width:\s*0%;/s);
  assert.match(css, /\.railTranscriptProgress\[data-state="overrun"\][\s\S]*\.railTranscriptProgressFill[\s\S]*width:\s*100%;/s);
});

test('ready check rows expose a dot, label, and optional fix/action for the tools section pre-flight', async () => {
  const css = await readSplitCss();

  assert.match(css, /\.readyCheckRow\s*\{/);
  assert.match(css, /\.readyCheckDot\s*\{/);
  assert.match(css, /\.readyCheckDot\.is-ready[\s\S]*\{/);
  assert.match(css, /\.readyCheckDot\.is-not-ready[\s\S]*\{/);
});

test('live transcript box is natively resizable on desktop and locked down on mobile', async () => {
  const css = await readSplitCss();

  assert.match(
    css,
    /\.railTranscript\s*\{[^}]*resize:\s*vertical;[^}]*\}/s
  );
  assert.match(
    css,
    /\.railTranscript\s*\{[^}]*min-height:\s*4\.5rem;[^}]*\}/s
  );
  assert.doesNotMatch(
    css,
    /\.railTranscript\s*\{[^}]*max-height:\s*10rem;[^}]*\}/s
  );
  assert.match(
    css,
    /@media \(max-width: 900px\)[\s\S]*\.railTranscriptSection \.railTranscript\s*\{\s*resize:\s*none;\s*height:\s*auto !important;\s*\}/s
  );
});

// The interval slider shipped with max="15" while SUMMARY_INTERVAL_MAX_SECONDS was 30, so the app
// could not be set to the 20s interval its own reader actually works at -- and nothing caught it,
// because no test compared the markup against the constant it is supposed to express. A range input
// is a claim about the allowed values; if it disagrees with the code's clamp, one of them is a lie.
test('the timing sliders span exactly the range their own constants allow', async () => {
  const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  const { SUMMARY_INTERVAL_MIN_SECONDS, SUMMARY_INTERVAL_MAX_SECONDS, summaryMaxWordsOptions } =
    await import('../../public/services/view-settings.js');

  const interval = html.match(/<input id="summaryInterval"[^>]*>/)[0];
  assert.match(interval, new RegExp(`min="${SUMMARY_INTERVAL_MIN_SECONDS}"`), 'interval min must match the constant');
  assert.match(interval, new RegExp(`max="${SUMMARY_INTERVAL_MAX_SECONDS}"`), 'interval max must match the constant');

  // The words slider is an index into the options array, not a word count.
  const words = html.match(/<input id="summaryMaxWords"[^>]*>/)[0];
  assert.match(words, new RegExp(`max="${summaryMaxWordsOptions.length - 1}"`), 'words slider indexes the option set');
});

// Issue #52. The speaker label had no font-size of its own, so it inherited .transcript-meta's
// clamp() -- the OPERATOR CHROME scale -- and measured 12.48px against 84px card text. The part of
// the card that says WHO was the part a low-vision reader was least able to read, and it did not move
// when he changed the font-size control.
//
// Ansel's numbers, 2026-08-04: 0.4 of the card text, with an absolute floor because the fraction
// alone fails at small calibrations (0.4 of a 32px card is 12.8px, straight back to unreadable).
test('the speaker label scales with the card text and cannot shrink below a readable floor', async () => {
  const css = await readSplitCss();
  const rule = css.slice(css.indexOf('.transcript-speaker'), css.indexOf('}', css.indexOf('.transcript-speaker')) + 1);

  assert.match(rule, /font-size:/, 'it must set its own size, not inherit the chrome scale');
  assert.match(rule, /var\(--font-size\)/,
    'it must be derived from the reader calibrated size, or it stops moving when he changes it');
  assert.match(rule, /max\(\s*1\.35rem/,
    'and it needs the absolute floor, because the fraction alone fails at small calibrations');
});

// The test above pins the SHAPE of the rule and not its numbers, which Cato pointed out is the
// assert-on-a-name failure again: `max(1.35rem, ...)` passes with any ratio, so someone could change
// 0.4 to 0.1 and stay green. This resolves the declaration to actual pixels across the real range of
// the font-size control and checks the result, which is the property Ansel actually ruled on.
test('the label resolves to a readable size across the whole font-size control range', async () => {
  const css = await readSplitCss();
  const rule = css.slice(css.indexOf('.transcript-speaker'), css.indexOf('}', css.indexOf('.transcript-speaker')) + 1);
  const match = rule.match(/font-size:\s*max\(\s*([\d.]+)rem\s*,\s*calc\(\s*var\(--font-size\)\s*\*\s*([\d.]+)\s*\)\s*\)/);
  assert.ok(match, `could not parse the size declaration from: ${rule.trim()}`);
  const [, floorRem, ratio] = match;
  const floorPx = Number(floorRem) * 16; // no root font-size is declared anywhere, so rem is 16px
  const resolve = (cardPx) => Math.max(floorPx, cardPx * Number(ratio));

  const { FONT_SIZE_MIN, FONT_SIZE_MAX } = await import('../../public/services/view-settings.js');

  // Never unreadable, at any setting. 12.48px is what #52 was: the number to stay well clear of.
  for (let cardPx = FONT_SIZE_MIN; cardPx <= FONT_SIZE_MAX; cardPx += 4) {
    assert.ok(resolve(cardPx) >= 20,
      `at a ${cardPx}px card the label resolves to ${resolve(cardPx)}px, which is back toward the 12.48px this fixed`);
  }

  // And it must actually track the reader's size rather than sitting on the floor forever.
  assert.ok(resolve(FONT_SIZE_MAX) > resolve(FONT_SIZE_MIN) * 2,
    'a reader who doubles their text size must see the name grow with it');
  assert.equal(resolve(84), 33.6, 'the measured case, pinned so the ratio cannot drift silently');
});

test('the mode chip deliberately stays at chrome scale, so it does not track the reader size', async () => {
  // Ansel was asked directly whether the size mismatch on that row bothered him. It does not: the
  // mode is operator status, not content the reader is identifying a person by.
  const css = await readSplitCss();
  // Every .transcript-meta block, not the first one found -- there are two, and the first is an
  // opacity-only rule. A test that slices to the first match silently checks the wrong thing.
  const blocks = [...css.matchAll(/\.transcript-meta\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 1, 'sanity: the rule must exist to be checked');
  for (const block of blocks) {
    assert.doesNotMatch(block, /var\(--font-size\)/, 'the chip must not scale with the reader size');
  }
  assert.ok(blocks.some((block) => /clamp\(/.test(block)), 'it stays on the chrome clamp');
});
