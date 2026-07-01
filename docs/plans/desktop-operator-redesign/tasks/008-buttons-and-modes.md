# 008 — Button consolidation + segmented-style mode group

Status: todo
Map links: P3; invariants I2, I3, I4, I12; risk R3. Depends on: 007. Blocks: 011.

## Goal

Collapse the three overlapping button treatments (`.railButton`, `.mode`, `.iconButton`) into two visual treatments — (a) rail item (icon + 12px label row) and (b) standard control button — and restyle the mode group as a unified vertical segmented control.

## Constraints (read first)

- Do NOT rename `.mode`, `.railButton`, `.iconButton`, ids, or `data-mode` attributes — JS binds them (I2). Consolidation is purely which CSS rules apply.
- `.railButton { min-height: 48px; }` and `.modeGrid { grid-template-columns: 1fr; }` are pinned (I3) — keep both.

## Steps

1. `controls.css`: one shared base rule for rail items (flat `--chrome-bg-control` fill on hover only, transparent at rest like macOS sidebar rows; icon 18–20px; label 12px/500; `--chrome-radius-sm`); quick-control buttons and mode buttons both consume it. `.iconButton` (header gear/sliders) becomes a borderless 28–32px icon button with hover fill, ≥44px hit area via padding.
2. Mode group: style `.modeGrid` as a single contained group — one `--chrome-bg-elevated` container, `--chrome-radius-md`, 1px separators between options; the active option (`aria-pressed="true"`) gets a full `--chrome-accent` flat fill with white text/icon. Keep vertical single-column (R3).
3. Clear button gets destructive-secondary styling: outline/muted treatment, visually separated from Undo by an extra `--chrome-space-3` gap (spacing only — DOM order unchanged; full safety in 013).
4. Update/extend `style.test.js` pins only where this task intentionally changes a pinned value (expected: none of the pinned layout values change).

## Acceptance criteria

- Exactly two button treatments visible in the rail; mode group reads as one segmented unit with a clear selected state.
- All ids/classes/data attributes intact; `npm test` green (including `helper-panel-structure.test.js` untouched).

## Out of scope

Collapse behavior (011); Clear confirm logic (013); settings buttons (010).
