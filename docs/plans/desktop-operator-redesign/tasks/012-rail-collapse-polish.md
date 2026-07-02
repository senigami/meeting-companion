# 012 — Rail collapse polish

Status: done
Map links: P7; invariants I5, I6, I11. Depends on: 011. Blocks: 020.

## Goal

Make collapse feel native and safe: double-click snap, resize interplay, animation, reduced motion.

## Steps

1. **Double-click snap:** `dblclick` on `#railResizeHandle` toggles collapse (call `setRailCollapsed`). Add via `rail-collapse.js` binding to the same handle node — still no edits to `rail-resize.js` logic; if a guard is needed to stop a drag from starting on dblclick, prefer handling in `rail-collapse.js` (e.g. suppress when `event.detail > 1` — a minimal, documented exception is acceptable if `rail-resize.js` must learn to ignore multi-click pointerdowns).
2. **Resize interplay:** while collapsed the handle is hidden (011); on expand, restore the pre-collapse width — read `ctx.state.operatorRailWidth`/`operatorRailWidth` storage; never persist 64px as the expanded width.
3. **Transitions:** rail width 220ms `cubic-bezier(0.25, 0.1, 0.25, 1)`; labels fade/clip ~150ms so text never wraps mid-animation. All inside a `@media (prefers-reduced-motion: no-preference)` guard or disabled by the existing reduce block (I11).
4. Tests: dblclick toggles; expand restores prior width; collapsed never writes 64 to `operatorRailWidth` key.

## Acceptance criteria

- Smooth collapse/expand, no label reflow artifacts, instant under reduced motion; width restore correct across collapse→resize→collapse cycles; suite green.

## Out of scope

New controls; touching TV canvas.
