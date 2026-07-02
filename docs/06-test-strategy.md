# Test Strategy

> **TL;DR:** Unit-test the prompt and registry logic, mirror tests beside source paths, and verify the browser UI manually because the layout and keyboard flow matter here.

## Overview

This is a tiny app, so tests should stay focused and cheap. The most valuable automated coverage is the shared prompt logic, the registry/catalog contract, and the server-side API helpers.

The browser UI still needs manual verification because the TV display, helper panel, keyboard shortcuts, and browser permissions are easier to judge in a real browser than in a text-only test.

## What to test automatically

- Prompt construction for speaker, information, song, and prayer modes.
- Model line cleanup and duplicate rejection.
- Source catalog ids and the source registry contract.
- App bootstrap smoke tests that catch module-load failures, the controller split, viewer controls, and missing OpenAI warnings.
- Runtime tests for pause/resume, mode propagation, and source fallback behavior.
- OpenAI transcription driver cancellation when a chunk is stopped in flight.
- Claude summarization wrapper and server-side provider routing.
- Express route behavior for `/api/config`, malformed JSON, and oversized payloads.
- View-setting clamping for text size, margins, and the summary interval slider.
- Percentage-based display-margin guides and the small operator-rail raw transcript preview.
- Helper panel structure tests that keep Settings, Diagnostics, and View options separate from the main control surface.
- Server API behavior for `/api/transcribe` and `/api/summarize` route contracts.
- Rail collapse/expand behavior, its localStorage persistence, and its interplay with rail resizing.
- `fetch-timeout.js` wrapping behavior, including that a timed-out request rejects instead of hanging.
- The status pipeline (`updateStatus`) writing to both the diagnostics status line and the rail status indicator.
- The pinned CSS contract in `test/public/style.test.js`, including the `--chrome-*` token tier values and the settings master-detail selectors, alongside the existing rail-width, grid, and slider pins.

## What to verify manually

- The transcript-card TV display from a distance.
- `H` to hide/show the helper panel.
- The red margin guide lines at different display sizes.
- The compact raw transcript preview in the operator rail and its disclosure toggle.
- Keyboard and pointer interaction for the Settings master-detail nav (switching between Alerts, Timing, Transcription, Summaries, AI services, and Tools).
- `Undo`, the two-stage `Clear` confirm and its snapshot restore, `Pause AI`, and the view sliders.
- The `/` shortcut focusing the manual input from anywhere, and that the removed bare `C` shortcut no longer clears the transcript.
- The collapsible rail: collapse/expand via the toggle button and via double-click on the resize divider, and that state survives a reload.
- The rail status indicator (dot + word) reflecting Listening/Paused/Manual/Problem states, alongside the same status in Settings > Tools.
- The Ready check rows in Settings > Tools (microphone, AI summaries with its Test button, TV display with its Show-sample-line button).
- Browser transcription fallback and OpenAI disabled state when `OPENAI_API_KEY` is missing.
- Summarization fallback to Claude when OpenAI is unavailable but Anthropic is configured.
- The warning banner when OpenAI is unavailable.
- Claude source availability when `ANTHROPIC_API_KEY` is missing.

## Test placement rules

- Put tests in `test/`.
- Mirror the source path as much as possible.
- Keep one behavior family per file.
- Prefer node:test and standard assertions.

## Acceptance rhythm

Every new behavior should land with a failing test first, then the minimum implementation, then a passing test run. Refactors that do not change behavior can skip the red step, but any new contract or endpoint must start with a test.

## Related specs

- [docs/05-code-organization.md](05-code-organization.md) - where the mirrored tests live.
- [docs/04-api-conventions.md](04-api-conventions.md) - the server shapes the tests should assert.
