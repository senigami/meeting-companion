# Desktop Operator Redesign — Plan

> **TL;DR:** Turn the operator-facing UI (rail, manual bar, settings, drawers) into a refined dark Mac-desktop experience, add a collapsible icon rail, make destructive/failure paths safe and visible, and harden the AI providers for live-meeting trust — without touching the TV transcript canvas or adding any build step.

## Where this lives

`docs/plans/desktop-operator-redesign/` — same layout as the other plans in `docs/plans/`.

- `00-overview.md` — goal, scope, success criteria.
- `01-map.md` — **read this first**: parts, connections, invariants. Every task links back to it.
- `02-roadmap.md` — workload order + dependency graph.
- `tasks/NNN-slug.md` — self-contained tasks. Each is executable with only that file + the map open.

## Status protocol

Mark progress in `02-roadmap.md` checkboxes and at the top of each task file (`Status: todo | in-progress | done`). Keep both in sync in the same change.

## How to pick up a task

1. Open `01-map.md`, read Big Picture + the invariants referenced by your task.
2. Open your task file. Do not exceed its Out of scope.
3. Verify with the commands in the task (minimum `npm test`), then update status.

Baseline commit for this plan: `ff78760`.
