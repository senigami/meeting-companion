# 011 — rail-collapse.js core

Status: done
Map links: P7; invariants I2, I3, I5, I6, I10, I11, I12; risk R4. Depends on: 007, 008. Blocks: 012, 016.

## Goal

The rail collapses to a 64px icon-only strip and back, via an always-visible toggle button; state persists; the TV display genuinely reclaims the width.

## Files

- `public/controller/rail-collapse.js` — NEW module (sibling of `rail-resize.js`; do not modify rail-resize.js in this task).
- `public/index.html` — toggle button in `.railActions` (before `#viewButton`): `<button id="railCollapseToggle" class="iconButton" aria-pressed="false" title="Hide labels" aria-label="Collapse the control rail">` with a new `#icon-panel-right` sprite symbol.
- `public/styles/layout.css` + `controls.css` — collapsed-state rules.
- `public/controller/start-app.js` — call `bindRailCollapse(ctx)` in `bindEvents()` next to `bindRailResize` (line ~132).
- Tests: NEW `test/public/controller/rail-collapse.test.js` (mirror `rail-resize.test.js` fake-DOM patterns); extend `style.test.js`.

## Steps

1. Module exports `loadRailCollapsed(storage)`, `setRailCollapsed(ctx, collapsed)`, `bindRailCollapse(ctx)`. Persistence key `operatorRailCollapsed`, try/catch idiom copied from `rail-resize.js:39-45` (I5). Default: expanded (I6 — expanded is the designed state).
2. `setRailCollapsed` toggles `html.is-rail-collapsed` on `document.documentElement` (convention of `is-resizing-rail`), sets `aria-pressed`, swaps `title`/`aria-label` ("Hide labels" ↔ "Show labels"), and stores `ctx.state.railCollapsed`.
3. CSS: under `html.is-rail-collapsed` — `--operator-rail-width: 64px` on `:root`-level override (the pinned default `--operator-rail-width: 220px;` declaration stays, I3); hide `.buttonLabel`, `.shortcutBadge`, `.section-label` text, `.railBrand` text, and the `.railTranscriptDisclosure`; center icons; keep every quick-control and mode button visible and ≥44px hit (I12); hide `.railResizeHandle`.
4. Every icon-only button must carry `title` (add where missing: Start/Stop/Pause/Undo/Clear/Full/mode buttons — static HTML change).
5. At ≤900px, `html.is-rail-collapsed` rules are inert and the toggle is hidden (R4).
6. Tests: toggle sets/unsets class + persists; load restores collapsed; default expanded; `style.test.js` pins `html.is-rail-collapsed` width override and the label-hiding rule.

## Acceptance criteria

- Click toggle → 64px icon strip, TV canvas visibly widens (grid track shrinks); click again → previous width restored; survives reload via localStorage; modes/undo/pause still one click.
- Full suite green.

## Out of scope

Double-click snap, transitions, resize interplay (012).
