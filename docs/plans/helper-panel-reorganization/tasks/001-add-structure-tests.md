# 001 — Add Structure Tests

- **Status:** not-started
- **Workload:** Contract Lock
- **Effort:** S
- **Blocked by:** nothing
- **Blocks:** 002

## Map Links

- **Parts touched:** P2, P3, P4, P6
- **Connections affected:** P2->P3 selector binding, P4->view update ids, P6->all DOM contracts
- **Invariants that apply:** INV-3, INV-4, INV-5, INV-7

## Goal

Add tests that fail until the helper panel has Settings and Diagnostics disclosure regions with the right controls inside them, with view options separated from both.

## Why This Matters

The panel restructure is mostly markup and CSS, but the controller depends on stable DOM selectors. Tests should catch accidental changes to ids, classes, and `data-*` hooks before runtime code breaks during a meeting.

## Context An Executor Needs

- `public/index.html` currently keeps settings, diagnostics, and live controls all visible in one fixed panel.
- `public/controller/start-app.js` queries controls by id and by selectors: `.mode`, `[data-kind="transcription"]`, and `[data-kind="summarization"]`.
- `public/controller/view.js` updates `#status` and `#liveTranscript`.
- `test/public/app-bootstrap.test.js` already mocks DOM access for bootstrap behavior.
- Tests should live under `test/public/` and can inspect `public/index.html` as static text or DOM if the current test setup supports it.

## Target Shape / Contract

Tests should assert:

- There is a Settings disclosure/region with an accessible name containing `Settings`.
- Transcription source and summary source controls are inside Settings.
- Summary interval controls are in the visible view options area, not inside Settings.
- There is a Diagnostics disclosure/region with an accessible name containing `Diagnostics`.
- `#status` and `#liveTranscript` are inside Diagnostics.
- Primary live controls remain outside Settings and Diagnostics: mode buttons, manual entry, start/stop/pause, undo, clear, display margin, font size, summary interval, fullscreen.
- Existing ids and `data-*` hooks still exist.

## Steps

1. Add or extend a test file under `test/public/` for static helper panel structure.
2. Load `public/index.html` in the test using `node:fs`.
3. Prefer lightweight assertions that are stable against copy changes; assert structure, ids, and selectors rather than exact visual text.
4. Run the targeted test and confirm it fails because the current markup has no Settings/Diagnostics grouping.

## Acceptance Criteria

- [ ] A failing test exists for the desired Settings and Diagnostics structure.
- [ ] The failure is meaningful, not a test setup error.
- [ ] Tests explicitly protect ids and `data-*` hooks used by the controller.
- [ ] No production code is changed in this task.

## Out Of Scope

- Do not change `public/index.html` yet.
- Do not change CSS yet.
- Do not change controller behavior unless the test setup itself needs a harmless fixture improvement.
