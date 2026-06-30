# Helper Panel Reorganization — Overview

> **TL;DR:** Reorganize the existing plain HTML/CSS/JS helper panel so only live operating controls stay visible, while settings and diagnostics move into clear secondary disclosure areas without changing the transcript-card TV display or source-driver contracts.

## Goal

The helper panel should be easier to operate under pressure. The default visible surface should prioritize mode selection, manual entry, AI start/stop/pause, undo/clear, and viewer adjustments. Configuration choices such as transcription source and summary source should move into Settings. The summary interval should stay in the visible view options area. Runtime status and recent transcript text should move into Diagnostics.

## Scope & Boundary

In scope:

- Reorganize `public/index.html` helper panel markup.
- Add CSS for a cleaner Apple-inspired hierarchy using existing visual language.
- Keep the current plain HTML/CSS/JS stack.
- Preserve existing control ids, `data-*` contracts, keyboard shortcuts, source selections, summary interval behavior, and localStorage keys unless a task explicitly updates tests and docs for the change.
- Add or update tests under `test/` using the mirrored layout.
- Update docs/specs when user-visible behavior or organization changes.

Out of scope:

- No React, Next.js, build tooling, or design-system dependency.
- No provider API changes.
- No transcript/audio persistence.
- No changes to the transcript-card TV display behavior.
- No large redesign of transcription, summarization, or prompt logic.

## Constraints

- The app must remain local and runnable with `npm start`.
- The TV display must show a small, readable stack of large-print transcript cards and no labels.
- Manual typed lines must appear immediately.
- The helper panel must remain hideable with `H`.
- Keyboard operation and visible focus must remain intact.
- Viewer-facing accessibility has the stricter bar; controller UI can be visually richer but still needs usable semantics.
- Keep files small and single-purpose; avoid large monolithic JS functions or CSS sections.

## Success Criteria

- The default helper panel no longer constantly displays transcription source, summary source, status, or recent transcript.
- Settings contains transcription source and summary source controls.
- View options contains the summary interval slider alongside the text size and margin sliders.
- Diagnostics contains status and recent transcript output.
- Live controls remain fast to reach: mode buttons, manual entry, start/stop/pause, undo, clear, font size, margin, summary interval, and fullscreen.
- Existing keyboard shortcuts continue to work.
- Existing source and interval state continues to persist through the current localStorage keys.
- Accessibility basics pass: native disclosure semantics or equivalent ARIA, accessible names, visible focus, no keyboard trap, logical tab order.
- Tests cover the structural change and controller bindings.
- `npm test` and `git diff --check` pass after implementation.
