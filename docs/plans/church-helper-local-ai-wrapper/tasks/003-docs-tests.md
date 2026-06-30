# 003 - Write the docs, ADRs, and mirrored tests

- **Status:** done
- **Workload:** Docs and tests
- **Effort:** M
- **Blocked by:** 002
- **Blocks:** nothing

## Map links

- **Parts touched:** P8
- **Connections affected:** all public-facing contracts by documentation
- **Invariants that apply:** INV-1, INV-3, INV-5, INV-6

## Goal

Create the spec docs, ADRs, agent instructions, and mirrored test layout that make the implementation easy to pick up later.

## Why this matters

The code is small, so the main risk is future drift. Good docs and mirrored tests make the project easier for a human and a small model to maintain without re-learning the whole app from scratch.

## Context an executor needs

The repo currently has the implementation in place, but it still needs the source-of-truth docs, a repo-level agent instruction file, and tests arranged under `test/` in a mirrored structure.

## Target shape / contract

The repository should contain `docs/00-index.md`, numbered specs, `docs/decisions/README.md`, at least three ADRs, `AGENTS.md`, and tests under a tree that mirrors the source layout.

## Steps

1. Write the spec set and ADRs from the current code.
2. Add `AGENTS.md` with the repo instruction block.
3. Move or add tests so they mirror the source tree.
4. Update the README with setup and Sunday-use instructions.

## Acceptance criteria

- [x] The docs index exists and points to the numbered specs.
- [x] ADRs explain the main architectural decisions.
- [x] `AGENTS.md` points to the docs index first.
- [x] Tests live under a separate mirrored tree.

## Out of scope

Do not add new runtime behavior in this task unless a doc/test gap forces it.
