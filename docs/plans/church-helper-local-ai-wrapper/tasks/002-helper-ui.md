# 002 - Keep the helper UI fast and readable

- **Status:** done
- **Workload:** Helper UI
- **Effort:** M
- **Blocked by:** 001
- **Blocks:** 003

## Map links

- **Parts touched:** P1, P7
- **Connections affected:** P1->P3, P1->P7
- **Invariants that apply:** INV-1, INV-2, INV-4, INV-5

## Goal

Keep the helper panel easy to operate under pressure and keep the transcript-card TV display readable from a distance.

## Why this matters

The app is only useful if the helper can use it while a meeting is already in progress. The UI must favor fast keyboard use and very large output text.

## Context an executor needs

`public/index.html` holds the semantic structure. `public/style.css` controls the large-print look. `public/controller/start-app.js` binds the UI. `public/controller/runtime.js` manages shortcuts, source selection, and the transcript-item state. `public/controller/view.js` keeps the display updates separate. The extras can be hidden with `H`.

## Target shape / contract

The visible display should stay label-free and contain only a small stack of readable cards. The helper panel should expose mode buttons, source buttons, manual input, undo, clear, pause AI, and text-size controls.

## Steps

1. Keep the keyboard shortcuts on native button and input controls.
2. Keep the source buttons and mode buttons pressed-state aware.
3. Keep the warning banner visible when OpenAI is missing.
4. Keep the line display large enough for TV use and balanced for wrapping.
5. Keep manual lines immediate and independent of AI state.

## Acceptance criteria

- [x] The extras can be hidden and restored with `H`.
- [x] Manual lines appear immediately.
- [x] Undo, clear, pause AI, and the view sliders are available by button and shortcut.
- [x] The display remains a readable stack of transcript cards.

## Out of scope

Do not change the source contract or provider wrappers here. That belongs to task 001.
