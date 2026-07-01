# 005 — Summarize failure counter, alert escalation, one-step backoff

Status: done
Map links: P9, P10; invariants I7, I13. Depends on: nothing (parallel with W1; coordinate with 004 if same catch block). Blocks: 016, 020.

## Goal

A revoked key / rate limit / outage mid-meeting currently retries every interval tick forever and only flickers a status string. Make repeated failure visible and calmer: after 3 consecutive `summarizeCurrentText` failures, escalate to the alerts surface and back the loop off one step.

## Files

- `public/controller/runtime.js` — `summarizeCurrentText` (line ~167, catch at ~191), `startLoop` (line ~161).
- `test/public/controller/runtime.test.js` — new cases via `withRuntimeHarness`.

## Steps

1. Add `ctx.state.summarizeFailureCount` (init 0). Increment in the catch; reset to 0 on any successful driver result.
2. At count === 3: (a) set the alerts surface — `ctx.dom.alertsSection.hidden = false`, write a plain-language message to `ctx.dom.apiWarning` ("AI summaries are failing. Manual lines still work."), un-hide `ctx.dom.settingsAlertBadge` (mirror the existing pattern in `loadRuntimeConfig` catch, runtime.js ~438-445); (b) back off: restart the loop at `min(summaryIntervalSeconds * 2, 30)` seconds WITHOUT changing `ctx.state.summaryIntervalSeconds` (the operator's chosen value) — track the effective interval separately (e.g. `ctx.state.effectiveIntervalSeconds`).
3. On next success: clear the failure alert it set (only if it set it), restore the normal interval, reset counter.
4. Status text stays informative via `updateStatus` on each failure (existing behavior).
5. Tests: 3 consecutive failures → alert visible + interval doubled; success after failures → counter reset + interval restored + alert cleared.

## Acceptance criteria

- Behavior above verified by tests; no retry library; loop still honors pause.
- `npm test` green.

## Out of scope

The rail status indicator (016 — it will read the same state); transcription-side counters (006 covers speech restarts).
