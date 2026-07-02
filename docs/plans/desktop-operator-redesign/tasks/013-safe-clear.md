# 013 — Safe Clear: two-stage confirm, snapshot restore, remove bare C

Status: done
Map links: P8, P9; invariants I2, I7, I8, I9. Depends on: 008 (Clear styling), 011 (collapsed state exists). Blocks: 020.

## Goal

Clear currently wipes the whole transcript instantly (`runtime.js clearLines()` line ~103) via a one-click button next to Undo or a bare `C` keypress — in front of the congregation that is the app's worst possible failure. Make it deliberate and recoverable.

## Steps

1. **Two-stage button** (`#clear`): first activation arms it — label/`#clear .buttonLabel` becomes "Confirm?", destructive red treatment (`aria-label` updated, collapsed state shows red icon ring); auto-revert after 3s (injectable timer for tests) or on blur/Escape. Second activation within the window executes. Implement arming state in `runtime.js`/`view.js` per existing patterns (state on `ctx.state`, render via a small update fn).
2. **Snapshot restore:** in `clearLines()`, store the outgoing array as `ctx.state.lastClearedItems` before emptying (I9). `undoLine()` (line ~98): if `transcriptItems` is empty and `lastClearedItems` exists, restore the whole snapshot (one-shot — null it after restore); otherwise pop as today.
3. **Announce:** after clear, `updateStatus(ctx, 'Cleared N lines — press U or click Undo to bring them back.')` (I7).
4. **Shortcut:** remove the `c` branch from `bindKeyboardShortcuts` (start-app.js ~348-352). Keep `u/p/1-4/Escape` (I8). Remove the `C` `.shortcutBadge` from `#clear` in index.html.
5. Tests (`withRuntimeHarness`): arm→timeout reverts without clearing; arm→confirm clears + snapshot set + status message; undo after clear restores all lines exactly once; `c` keydown does nothing; existing undo behavior unchanged when not after a clear.

## Acceptance criteria

- Impossible to clear with a single interaction or a stray keypress; a mistaken clear is fully recoverable with one Undo; suite green.

## Out of scope

Undo feedback chip (014); multi-step history (never).
