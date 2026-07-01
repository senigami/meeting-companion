# 002 — Repoint controls.css to chrome tokens

Status: done
Map links: P3, P4; invariants I1, I2, I3, I4; risk R2. Depends on: 001. Blocks: 007, 008, 009.

## Goal

Replace hardcoded color/radius values in `public/styles/controls.css` (operator rail, quick controls, mode buttons, icon buttons, manual bar, sliders) with `var(--chrome-*)` references. Near-neutral visually: literals map to the closest chrome token.

## Files

- `public/styles/controls.css` — the only stylesheet edited.

## Steps

1. Map every color literal (`rgba(...)`, hex) in operator-chrome rules to a chrome token: panel/section fills → `--chrome-bg`/`--chrome-bg-elevated`; button fills → `--chrome-bg-control` (+hover); borders → `--chrome-separator`; text → `--chrome-text`/`--chrome-text-secondary`; blue accents → `--chrome-accent`. Radii → nearest `--chrome-radius-*`.
2. Where a gradient exists (e.g. `linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.032))`), keep the gradient FOR NOW but express its stops via tokens only if trivially possible; otherwise leave the gradient literal with a `/* chrome-restyle: flatten in 007 */` comment. Don't redesign here.
3. Do not touch layout values (grid, sizes, spacing) or any selector name. Do not touch TV-canvas rules (none should be in this file; if found, leave them).
4. Run `npm test` — no `style.test.js` pins reference color literals in this file, so no assertion changes expected.

## Acceptance criteria

- `grep -E 'rgba\(|#[0-9a-fA-F]{3,8}' public/styles/controls.css` returns only lines that are either inside commented `chrome-restyle` gradients or non-chrome exceptions you can justify in the task-completion note.
- No selector renamed; no layout/pinned value changed (I3 list).
- Visual spot check: app looks the same (near-neutral tolerance).
- `npm test` green.

## Out of scope

settings.css/layout.css (003); changing the actual look (007+).
