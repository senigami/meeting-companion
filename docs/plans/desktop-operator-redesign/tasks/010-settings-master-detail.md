# 010 — Settings modal → System-Settings-style master-detail

Status: todo
Map links: P5, P9; invariants I2, I3, I4, I10; risk R1 (highest blast radius — run FULL suite). Depends on: 007. Blocks: 017, 019.

## Goal

Replace the 2-column card wall inside `<dialog id="settingsPanel">` with a shallow macOS-System-Settings-style layout: a ~180px section list on the left, a single-column detail pane on the right, plain-language section names, NO nested navigation. A non-technical helper should find "make summaries slower" without reading API jargon.

## Sections (order, plain language)

1. **Alerts** — existing `#alertsSection` content (auto-selected when the alert badge is lit).
2. **Timing** — `#summaryInterval` range field.
3. **Transcription** — `#transcriptionBrowser/#transcriptionOpenAi` options + `#transcriptionHint`.
4. **Summaries** — `#summaryOpenAi/#summaryClaude` options + `#summaryHint`.
5. **AI services** — the service-registration card (`#serviceRegistration*`, `.apiKeyBox`).
6. **Tools** — diagnostics: `#status`, `#pasteTranscript` + `#summarizeOnce`, `#liveTranscript`.

## Constraints (read first)

- Every id in the I2 list survives — sections MOVE nodes, never recreate them with new ids.
- Keep the native `<dialog>` + `setSettingsOpen` behavior (view.js:104) — no hand-rolled modal.
- `style.test.js` pins `.settingsGrid { grid-template-columns: repeat(2, ...) }`, `.settingsViewCard/.serviceRegistrationCard { grid-column: 1 / -1; }`, `.settingsOverlay.settingsModal { width: min(960px, ...) }` — the first three become obsolete: update those assertions to pin the NEW structure (e.g. `.settingsNav` width, `.settingsDetail` single column). Keep `.settingsGrid`-class present or update the selector-existence list accordingly — state every pin change in the completion note.
- `test/public/helper-panel-structure.test.js` and `app-bootstrap.test.js` likely assert modal DOM — update them deliberately to the new structure.

## Steps

1. `index.html`: inside `#settingsBody`, add `<nav class="settingsNav">` (list of 6 section buttons, 13px labels, icon optional) + `<div class="settingsDetail">` containing the six sections (existing nodes moved, each wrapped in `<section data-settings-section="...">`).
2. New small module or extension in `view.js`: section switching (show one section, `aria-current` on nav item; default section = Alerts if badge lit else Timing). Wire in `start-app.js bindEvents()` (I10).
3. `settings.css`: nav column (flat, selected item `--chrome-bg-control` fill + accent text), detail pane single column, modal `--chrome-radius-lg` (12px), header 44px with plain `×` close (keep `#closeSettings` id — restyle to icon button with `aria-label="Close settings"`).
4. Responsive: ≤900px the nav collapses to a horizontal scrolling row above the detail (keep the pinned `.settingsModal { width: 100%; }` at 900px).
5. Run FULL `npm test`; update the named tests deliberately.

## Acceptance criteria

- Six flat sections, one visible at a time; no nesting; all I2 ids functional (provider switching, key save/test/delete, summarize-once still work).
- Keyboard: nav items tabbable, Escape still closes, focus returns per existing `focusReturn` behavior.
- Full suite green with intentional, documented test updates only.

## Out of scope

Ready check (017 adds its row later); moving status OUT of settings (016 dual-writes; `#status` stays here too).
