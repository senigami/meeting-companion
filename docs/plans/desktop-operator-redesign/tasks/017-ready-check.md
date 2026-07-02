# 017 — Lean Ready check

Status: done
Map links: P11, P5; invariants I2, I7, I10; risk R5. Depends on: 010, 016. Blocks: 020.

## Goal

Front-load the meeting: three green/red rows the helper can check before anything starts, so mid-meeting needs near-zero decisions. Lean — NOT a guided wizard.

## Placement

A "Ready check" block at the top of the **Tools** section of the settings modal (from task 010), PLUS its summary reflected through the rail status indicator (016): if any row is red before the first line is shown, the indicator shows "Problem" with the settings alert badge lit.

## Rows

1. **Microphone** — green if `browserSpeechAvailable()` (view.js ~611) OR the selected transcription source is OpenAI-ready; red otherwise, with the plain fix ("This browser can't listen. Choose OpenAI transcription or type lines manually.").
2. **AI summaries** — green if the selected summary source's provider is ready (`ctx.state.openAiReady`/`anthropicReady` from `loadRuntimeConfig`); a "Test" button reuses `testProviderKey` (runtime.js ~359) for the active provider; red with plain fix otherwise.
3. **TV display** — a "Show sample line" button: if the transcript is empty, `renderDisplay` already shows the sample card — the button focuses/flashes it by calling `renderDisplay(ctx)` and closing the modal, so the helper can check readability on the TV (reuse existing sample behavior at view.js ~31-39; no new display logic).

## Steps

1. `index.html`: static rows (`<div class="readyCheckRow" data-ready="mic|ai|display">` with dot span + label + action button).
2. `view.js`: `renderReadyCheck(ctx)` computes row states from existing ctx state; call it when settings opens and after config/key changes.
3. `start-app.js`: bind the two action buttons in `bindEvents()`.
4. Tests: row states across ready/not-ready ctx permutations; test button calls through to `testProviderKey`; sample button triggers `renderDisplay` and closes settings.

## Acceptance criteria

- With no keys and no speech support: mic + AI rows red with actionable text; with browser speech + valid key: all green.
- No new endpoints, no wizard, no polling; suite green.

## Out of scope

Audio level meters (R5), auto-fixing problems, onboarding flows.
