# 020 — Final verification sweep

Status: done
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

## Completion note (orchestrator-run sweep)

Machine-verified against the live app (Chromium preview, ports vary):
- Full suite 120/120 green.
- TV-freeze audit vs ff78760: only 3 removed lines in layout.css, all sanctioned (railTranscript retoken; ::before radius removal + overflow clip per user request; inactive opacity .62->.8).
- Collapse: toggle -> html.is-rail-collapsed, grid track animates to a true 64px, expand restores, localStorage persists.
- Clear: arm shows red "Confirm?", data intact while armed, confirm clears + status message (pluralization fixed in 1aab896), one Undo restores all.
- Pause: is-paused on rail + button, honest wording, status word Paused/Manual.
- '/' focuses manual input; settings opens to Alerts when badge lit; six sections switch; Ready check rows reflect real state (mic green via browser speech, AI red + fix text with no key, display green).
- Height tiers at 1280x580: nothing clipped, manual bar 34px, dense icon grid, 44px targets (fixed in 1aab896).

Deferred to the operator's human checklist (needs real hardware):
- Live microphone listening + browser speech restart behavior.
- Real TV mirror readability + fullscreen button behavior.
- Reduced-motion behavior (CSS pinned by tests; OS-level toggle untested here).
