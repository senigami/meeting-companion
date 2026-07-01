# 014 — `/` focus hotkey + undo feedback

Status: todo
Map links: P8, P9; invariants I2, I7, I8, I11. Depends on: 013. Blocks: 020.

## Goal

Two small speed wins for the mid-meeting operator: jump to typing from anywhere, and see what Undo removed.

## Steps

1. **Hotkey:** in `bindKeyboardShortcuts` (start-app.js ~322), add `/`: when not `isTypingTarget`, `event.preventDefault()` and `ctx.dom.manualInput.focus()` (I8). No-op while typing.
2. **Undo feedback:** after a successful `undoLine()` pop (not the snapshot restore from 013 — that has its own message), call `updateStatus(ctx, 'Removed: "<first ~40 chars of the removed line>…"')` (I7). Also give the manual bar a transient visual cue if cheap (e.g. brief input outline flash, ≤400ms, honoring reduced motion I11) — optional; status text is the requirement.
3. Tests: `/` focuses input and is swallowed; `/` while typing inserts normally; undo produces the "Removed:" status with truncation.

## Acceptance criteria

- Operator can be typing again from any focus state with one keystroke; undo is verifiable at a glance; suite green.

## Out of scope

New DOM chips/toast system (status pipeline is the surface); redo.
