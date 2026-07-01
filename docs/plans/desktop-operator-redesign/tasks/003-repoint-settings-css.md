# 003 — Repoint settings.css and rail chrome in layout/responsive.css

Status: done
Map links: P3, P5, P6; invariants I1, I2, I3, I4; risk R2. Depends on: 001. Blocks: 007, 010.

## Goal

Same retokening as task 002, applied to `public/styles/settings.css` (settings modal, provider cards, API key box, view drawer) and to the OPERATOR-CHROME rules only inside `public/styles/layout.css` and `public/styles/responsive.css` (e.g. `.operatorRail`, `.railTop`, `.manualBar` rules living there).

## Files

- `public/styles/settings.css`
- `public/styles/layout.css` — chrome rules only. **The TV canvas rules (`.display-panel`, `.displayPanel`, `.transcript-*`, margin-guide rules) are FROZEN (I1) — do not edit them, even to tokenise.**
- `public/styles/responsive.css` — chrome rules only.

## Steps

1. Apply the same literal→token mapping as task 002 (see that file's step 1).
2. In `layout.css`, before editing any rule, confirm its selector is chrome (rail/manual/settings), not TV canvas. When in doubt, leave it.
3. Leave gradients/blur with a `/* chrome-restyle: flatten in 007 */` comment as in 002.
4. `npm test` after each file.

## Acceptance criteria

- Chrome rules in the three files consume `var(--chrome-*)`; TV-canvas rules byte-identical to before this task (verify with `git diff` — no hunks in frozen selectors).
- No selector renamed; no pinned value changed.
- `npm test` green; app visually near-identical.

## Out of scope

controls.css (002); restyling (007+); settings DOM (010).
