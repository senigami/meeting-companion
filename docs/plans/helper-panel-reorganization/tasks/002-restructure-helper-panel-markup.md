# 002 — Restructure Helper Panel Markup

- **Status:** not-started
- **Workload:** Markup Reorganization
- **Effort:** M
- **Blocked by:** 001
- **Blocks:** 003, 004

## Map Links

- **Parts touched:** P2, P3, P4
- **Connections affected:** P2->P3 selector binding, P4->view update ids
- **Invariants that apply:** INV-1, INV-2, INV-3, INV-4, INV-5, INV-6, INV-7, INV-8

## Goal

Move configuration and diagnostics out of the always-visible helper surface without breaking existing runtime bindings.

## Why This Matters

The operator needs a calmer panel during live use. Settings and diagnostics are useful, but they should not compete visually with the controls used every few seconds.

## Context An Executor Needs

- Edit `public/index.html`.
- Keep the TV display section unchanged except for incidental formatting if needed.
- The helper panel currently has sections for viewer options, mode, transcription source, summary source, manual line, paste transcript, button grid, status, and transcript.
- Source buttons must keep their `data-kind` and `data-source` attributes.
- Runtime ids such as `fontSize`, `displayMargin`, `manualInput`, `status`, and `liveTranscript` must remain present.

## Target Shape / Contract

Suggested structure:

- Header with title and hide-panel button.
- Primary operation area:
  - Mode buttons.
  - Manual line entry.
  - Primary action button grid.
  - Viewer controls for font size and margin.
- View options:
  - Text size.
  - Margins.
  - Summary interval.
- Settings disclosure:
  - Transcription source.
  - Summary source.
- Diagnostics disclosure:
  - API warning may remain prominent if missing keys; do not bury critical warnings.
  - Status.
  - Recent transcript.
  - Paste transcript can either remain primary if often used or move to Diagnostics if tests/docs describe it. Prefer keeping manual typed entry primary and treating paste transcript as secondary.

Use native `<details>`/`<summary>` unless there is a concrete reason not to. Native disclosure semantics reduce custom JS and keyboard risk.

## Steps

1. Read the failing tests from task 001 and `01-map.md`.
2. Edit `public/index.html` to add clear primary, settings, and diagnostics groupings.
3. Move existing controls into the new groupings; do not duplicate controls.
4. Preserve every id and selector used by `public/controller/start-app.js` and `public/controller/view.js`.
5. Keep `#apiWarning` visible enough that missing API keys are not hidden inside a closed disclosure.
6. Run the targeted tests from task 001 and fix only structural issues needed to pass.

## Acceptance Criteria

- [ ] View options contains text size, margins, and interval controls.
- [ ] Settings contains transcription source and summary source.
- [ ] Diagnostics contains `#status` and `#liveTranscript`.
- [ ] Primary controls remain visible by default.
- [ ] Existing controller selectors still find the same controls.
- [ ] The display still renders a readable transcript-card stack.
- [ ] Targeted tests pass.

## Out Of Scope

- Do not restyle beyond minimal class additions needed for task 003.
- Do not alter source registry, provider code, or summarization prompts.
- Do not introduce JS disclosure state unless native behavior proves insufficient.
