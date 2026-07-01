# 009 — Sliders, view drawer, manual bar detail restyle

Status: todo
Map links: P4, P6; invariants I1, I2, I3, I4, I12. Depends on: 007. Blocks: 020.

## Goal

Finish the desktop feel on the remaining chrome components without changing any behavior or DOM.

## Steps

1. **Sliders** (`.sliderVisual/.sliderTrack/.sliderThumb`, ids `#fontSize`, `#displayMargin`, `#summaryInterval`): flatten thumb shadow to macOS weight (`0 1px 2px rgba(0,0,0,0.3)`); keep tick dots and `--slider-points` counts (pinned, I3); `<output>` readouts to 600 weight, `--chrome-accent` color.
2. **View drawer** (`#viewPanel`, `.viewDrawerShell/.viewDrawerHeader/.viewDrawerBody`): flat elevated surface, `--chrome-radius-lg`, 13px labels, hairline header separator; keep open/close behavior and `html.is-adjusting-display-margin` pinned rules untouched.
3. **Manual bar** (`.manualBar`, `.manualBarInner`, `#manualInput`, `#addManual`): input becomes a flat `--chrome-bg-control` field, `--chrome-radius-sm`, height ~38px, 13px text; `#addManual` becomes a standard `--chrome-accent` push button (flat, radius-sm). Keep the pinned `grid-area: manual` and `.manualBarInner` grid-template-columns (I3); keep the `Manual line` label visible (non-technical operator).
4. Settings modal chrome pieces that survive to 010 (header, close button) may be lightly aligned but the modal restructure itself is task 010.

## Acceptance criteria

- No DOM/id/class changes; no pinned value changes; `npm test` green.
- Visual check: sliders/drawer/manual bar match the 007 surface language.

## Out of scope

Settings restructure (010); any behavior change.
