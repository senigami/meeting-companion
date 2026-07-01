# 015 — Loud paused state + honest pause wording

Status: todo
Map links: P8, P9; invariants I2, I7, I11. Depends on: 007, 011. Blocks: 016, 020.

## Goal

Paused is currently a quiet label swap on one button; a helper who glances away can miss that nothing is being captured for the rest of the meeting. Make paused unmissable, and honest about the mic.

## Steps

1. **Visual state:** when `ctx.state.paused`, add `is-paused` class at a rail-visible level (e.g. on `#panel` via `updatePauseButton` view.js ~295): amber treatment on `#pauseAi` (filled amber, white icon) + a thin amber top border or header tint on the rail — visible in BOTH expanded and collapsed states (collapsed: amber ring on the icon). Animate only the state CHANGE (one pulse, I11), then hold steady.
2. **Wording:** `togglePauseAi` (runtime.js ~282) status text on pause must say the microphone also stopped: e.g. "AI paused — microphone stopped. Manual lines still work." Resume text confirms listening state honestly (it only restarts if it was listening before).
3. Tests: pausing toggles the class + status wording; resuming clears both; collapsed-state selector exists (style.test.js pin for the amber collapsed indicator rule).

## Acceptance criteria

- Paused state identifiable from across the room in either rail state; wording states the mic consequence; suite green.

## Out of scope

Decoupling pause-AI from stop-mic (explicitly rejected — status wording is the fix); the status dot itself (016).
