# 016 — Rail status indicator + TV inactive-card opacity tweak

Status: done
Map links: P1 (sanctioned tweak), P9; invariants I1, I2, I7, I11. Depends on: 005, 011, 015. Blocks: 017, 020.

## Goal

One glanceable line in the always-visible rail answering "is it working?": colored dot + one word. Plus the single sanctioned TV tweak.

## Steps

1. **DOM:** small `<div id="railStatus" class="railStatus" role="status">` in the rail header area (under `.railTop`, above the quick controls): `<span class="railStatusDot">` + `<span id="railStatusWord">`. In collapsed state, the dot alone remains visible (word hides with labels).
2. **Pipeline (I7):** extend `updateStatus(ctx, text, { level } = {})` (view.js:21) — it keeps writing `#status` (diagnostics) verbatim, and ALSO sets the indicator when `level` is provided. Derive/update level at the real state changes: `listening` (green) on successful start; `manual` (neutral gray) when idle/not listening; `paused` (amber) from 015's pause path; `problem` (red) from the failure escalation in 005 and speech failure in 006. Words: "Listening", "Manual", "Paused", "Problem". Callers not passing `level` change only the diagnostics text.
3. **Animation:** dot transitions color and pulses ONCE on change (I11); no continuous animation.
4. **TV tweak (I1 sanctioned):** in `layout.css`, raise inactive transcript-card opacity from `.62` to `.8` (the `scale(.992)` may stay). Touch nothing else in frozen rules.
5. Tests: `updateStatus` with level sets dot class + word and still writes `#status`; without level, indicator unchanged; pause/failure paths set amber/red (extend the 005/015 tests); style.test.js pins `.railStatus` existence + the new `opacity: 0.8` (replacing any `.62` pin if present — state the change).

## Acceptance criteria

- Dot+word reflects listening/manual/paused/problem accurately through start→pause→resume→failure flows; diagnostics `#status` unchanged in behavior; TV inactive cards render at 0.8 opacity; suite green.

## Out of scope

Toast systems; multiple live regions; any other TV rule.
