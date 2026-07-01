# 007 — macOS palette + surface/material restyle

Status: todo
Map links: P2, P3, P4, P5, P6; invariants I1, I3, I4, I11, I12. Depends on: 001–003. Blocks: 008–012.

## Goal

The visual pivot: swap chrome token values to the macOS dark palette and replace glass materials with flat desktop surfaces. After this task the chrome should read as a dark Mac app; the TV canvas keeps its glow/depth.

## Steps

1. In `base.css`, set chrome tokens to final values (I4): bg `#1e1e1e`, elevated `#262626`, control `#323234`, control-hover `#3a3a3c`, separator `rgba(255,255,255,0.08)`, text `rgba(255,255,255,0.92)`, secondary `rgba(255,255,255,0.55)`, accent `#0A84FF`, radii 6/10/12px.
2. Sweep every `/* chrome-restyle: flatten in 007 */` marker (from 002/003): replace gradients with flat token fills; remove `backdrop-filter` from all operator chrome (`.panel`, `.manualBar`, `.viewDrawerShell`, settings surfaces). The settings `::backdrop` becomes a plain dim (`rgba(0,0,0,0.5)`) — update the pinned `::backdrop { backdrop-filter: blur(18px); }` assertion in `style.test.js` to pin the new dim instead (I3, intentional change).
3. Rail reads as window chrome: remove its outer drop shadow; add `border-left: 1px solid var(--chrome-separator)` at the canvas boundary; flat `--chrome-bg` fill. Floating layers only (settings dialog, view drawer) keep one soft shadow `0 8px 24px rgba(0,0,0,0.35)`.
4. Type scale (I4): section labels 11px/600/uppercase/`--chrome-text-secondary`; rail button labels 12px/500; control text 13px; modal titles 15–17px/600. Remove negative letter-spacing from chrome rules (TV rules untouched — I1).
5. Focus rings in chrome: `2px solid var(--chrome-accent)`, offset 1px, no box-shadow glow. Keep `:focus-visible` gating.
6. Verify targets still ≥44px (I12) and pinned layout values unchanged except the `::backdrop` pin.

## Acceptance criteria

- No `backdrop-filter` or `linear-gradient` remains in operator chrome (`grep` controls.css/settings.css + chrome rules of layout.css); TV canvas rules untouched (`git diff` shows no frozen-selector hunks).
- `npm test` green with the one intentional pin update.
- Visual check: rail/manual bar/settings/drawer are flat dark gray with hairlines; TV canvas unchanged.

## Out of scope

Button/mode component patterns (008), sliders (009), settings DOM (010).
