# 020 — Final verification sweep

Status: todo
Map links: all parts; invariants I1–I13. Depends on: everything. Blocks: nothing (last).

## Goal

Prove the plan's success criteria (00-overview.md) against the real app, not against task completion notes.

## Steps

1. `npm test` — full suite green, zero skips.
2. **TV-freeze audit:** `git diff ff78760 -- public/styles/layout.css` — every hunk in `.display-panel/.displayPanel/.transcript-*` rules must be either the sanctioned opacity tweak (016) or provably chrome-only. List any violation as a defect.
3. **Manual smoke (run `npm start`, use a browser):**
   - Rail: collapse → 64px icons, TV widens, tooltips show, expand restores width, reload preserves state; drag-resize still works expanded; dblclick divider toggles.
   - Modes: click + keys `1–4` switch; segmented selection visible.
   - Manual flow: `/` focuses input; Enter and "Show now" render instantly; focus returns to input.
   - Clear: single click arms (red "Confirm?"), waits 3s → reverts; confirm → clears with status message; `U` restores everything; bare `c` does nothing.
   - Pause: `P` → amber state obvious in both rail states; status says mic stopped; resume restores.
   - Status dot: manual (gray) → listening (green, if speech available) → paused (amber); kill the network or use a bad key → red "Problem" + alert badge after 3 failures, interval backs off.
   - Settings: six plain sections, switching works, Escape closes, provider switching + key save/test/delete work; Ready check rows reflect reality; "Show sample line" displays the sample card.
   - Reduced motion (OS setting or emulation): no transitions.
   - Narrow window ≤900px: layout stacks as before; collapse toggle hidden.
4. Record results as a checklist in the completion note; any failure → file the defect against the owning task and fix there (root cause), not with a local patch here.

## Acceptance criteria

- Every smoke item passes; TV-freeze audit clean; suite green. The plan's 00-overview success criteria can each be answered "yes" with evidence.
