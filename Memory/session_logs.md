# Session Log

## 2026-06-30

- Seeded the missing local `Memory/` folder with rules, state, and active context.
- Recorded the current verified state: Apple-style UI pass, demo mode, live transcript preview, and temporary margin guides.
- Confirmed the test suite passes with `npm test --silent`.
- Added `.agent/rules.md` so future sessions know to read and update the Memory files explicitly.

## 2026-07-01

- Reworked Settings so source selectors only show configured services and a separate registration card adds and validates provider keys before they appear in the available lists.
- Kept the transcription source selector limited to ready services while preserving browser transcription as the local default.
- Verified the full suite with `npm test --silent` after updating the DOM, controller, styles, docs, and test harnesses.
- Updated manual transcript cards so they render with a neutral human silhouette icon instead of the active summary mode icon, and documented the behavior in the scope spec.
- Widened the operator rail grid column and stacked the rail header actions so the alert and settings buttons stay visible instead of clipping off the right edge.
- Added a draggable rail-resize handle that stores the chosen width in browser storage and clamps it to the current viewport so the operator can tune the helper column live.
- Replaced fragile native margin-slider dragging with a custom track-width pointer controller, expanded display margins to 40%, and tied display/drawer transparency to active margin adjustment.
- Added temporary sample text for empty-display tuning while Display controls are open, and documented the empty-state fallback contract.
- Hardened margin-slider cleanup and disabled display-drawer hit-testing during active margin drag so a faded drawer cannot trap pointer interaction.
- Wired display margins into the transcript viewport padding so the red guides match the actual text-flow width for sample and live transcript cards.
- Wired the transcript text size to the `--font-size` viewer setting so the text-size slider changes sample and live display text.
- Lowered the viewer font-size minimum from 56px to 32px for larger screens while keeping the 144px maximum.
- Removed the sample-text checkbox; opening Display controls now automatically previews sample text only when no real transcript cards exist, and closing the controls clears that preview.
- Lowered the viewer font-size minimum again from 32px to 24px while keeping the 144px maximum.
- Manual line submission now clears and refocuses the entry after a non-empty line is accepted through Enter or the Show now button.
- New transcript lines now use a controlled scroll animation plus a slower card entrance so manual submissions are easier to visually follow.
