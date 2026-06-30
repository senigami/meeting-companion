# Helper Panel Reorganization Plan

This is the live execution plan for reorganizing the Meeting Companion helper panel after the design critique in `docs/design-critique/`.

Plan location: `docs/plans/helper-panel-reorganization/`

Every executor should read `01-map.md` with the task file they pick up. The map is the shared context for the panel structure, controller bindings, styling contracts, accessibility invariants, and test/doc expectations.

## Status Legend

- `not-started` - ready to pick up when blockers are done.
- `in-progress` - actively being worked.
- `blocked` - cannot continue without a decision or dependency.
- `done` - implemented, verified, and docs/map updated if needed.

## Pickup Protocol

1. Read `02-roadmap.md`.
2. Take the next unblocked task in the current workload.
3. Open that task file and `01-map.md`.
4. Follow the task steps using red -> green -> refactor where behavior changes.
5. Update the task status when complete.
6. Update `01-map.md` if the implementation changes a contract, selector, state shape, or connection.

