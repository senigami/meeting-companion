# 021 — Vertical responsiveness for the operator chrome

Status: done
Map links: P3, P4, P6; invariants I1, I2, I3, I4, I12. Depends on: 017, 018. Blocks: 020. (User-requested addition mid-execution.)

## Goal

The layout adapts to narrow widths but not to short windows: at reduced heights the rail scrolls early, quick controls waste vertical space, and the manual bar stays tall. Add height-based responsive tiers so the operator chrome compresses gracefully in short windows (small laptops, non-fullscreen use), without touching the TV canvas rules (I1 — the display already flexes).

## Steps

1. Add `@media (max-height: 760px)` tier in `responsive.css`: tighten rail section padding/gaps (`--chrome-space-*` steps down), reduce `.railButton` vertical padding (keep ≥44px hit target, I12), shrink section-label margins, slim the manual bar (input/button 32-34px), reduce `.railTop` padding.
2. Add `@media (max-height: 600px)` tier: quick-controls grid switches to a denser multi-column icon layout (labels may hide like the collapsed state — reuse the existing label-hiding selectors pattern, NOT a new mechanism), `.railTranscriptDisclosure` collapses by default (remove `open` via CSS is not possible — instead cap its max-height tighter).
3. Settings modal: at short heights ensure the dialog fits (`max-height: calc(100dvh - 2rem)`, internal scroll in `.settingsDetail` — verify existing behavior, fix if it overflows).
4. Verify no interaction with `html.is-rail-collapsed` (collapsed state already compact) and no TV-canvas rule changes (`git diff` audit on frozen selectors).
5. Pins: add style.test.js assertions for the two max-height media queries (additive).

## Acceptance criteria

- At 1280×700 and 1280×580 viewports: no clipped controls, rail scrolls only as a last resort, manual bar and status strip always visible, all targets ≥44px effective.
- TV canvas rules untouched; suite green with additive pins only.

## Out of scope

Width breakpoints (exist), TV canvas, new features.
