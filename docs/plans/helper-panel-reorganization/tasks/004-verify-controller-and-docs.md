# 004 — Verify Controller And Docs Alignment

- **Status:** not-started
- **Workload:** Integration And Docs
- **Effort:** S
- **Blocked by:** 002, 003
- **Blocks:** nothing

## Map Links

- **Parts touched:** P1, P2, P3, P4, P6
- **Connections affected:** P2->P1 behavior, P2->P3 settings state, P4->view update ids, P6->all
- **Invariants that apply:** INV-1, INV-2, INV-3, INV-4, INV-5, INV-6, INV-7, INV-8

## Goal

Confirm the reorganized panel still works as the same local meeting tool and update specs/docs to match the new layout.

## Why This Matters

The project treats specs as source of truth. A UI reorganization that is not reflected in docs will confuse the next agent or human maintainer.

## Context An Executor Needs

- Likely docs to update: `docs/00-index.md`, `docs/01-scope.md`, `docs/05-code-organization.md`, and `README.md` if Sunday-use instructions mention where controls live.
- Controller files to inspect: `public/controller/start-app.js`, `public/controller/runtime.js`, `public/controller/view.js`.
- Tests to run: `npm test` and `git diff --check`.
- Manual browser check may be useful if the app is already running, but should not replace automated tests.

## Target Shape / Contract

Final system behavior:

- Settings controls are still bound by existing JS selectors.
- Status and recent transcript updates still target the moved elements.
- Keyboard shortcuts still work:
  - `H` hides/shows panel.
  - Existing manual, pause, undo, clear, size, and fullscreen shortcuts keep their documented behavior.
- `apiWarning` remains visible when provider keys are missing.
- Docs describe the reorganized helper panel accurately.

## Steps

1. Inspect controller files after markup/style changes and verify no bindings silently broke.
2. Add or update controller/bootstrap tests if any moved element is no longer represented in test fixtures.
3. Update docs/specs that describe helper panel controls.
4. Run `npm test`.
5. Run `git diff --check`.
6. If a browser manual check is possible, verify Settings and Diagnostics can be opened with keyboard and mouse, and that `H` still hides the panel.

## Acceptance Criteria

- [ ] `npm test` passes.
- [ ] `git diff --check` passes.
- [ ] Docs reflect the new Settings and Diagnostics grouping.
- [ ] Controller tests cover moved source, interval, status, and transcript elements.
- [ ] No provider, storage, or five-line display behavior changed.
- [ ] Any map changes caused by implementation are reflected in `01-map.md`.

## Out Of Scope

- Do not add new providers.
- Do not change AI prompt behavior.
- Do not add persistent settings beyond the existing localStorage-backed controls unless explicitly requested later.

