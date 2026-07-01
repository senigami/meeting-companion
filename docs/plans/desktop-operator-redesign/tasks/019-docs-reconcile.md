# 019 — Reconcile docs/ with shipped behavior

Status: todo
Map links: P13. Depends on: all of W1–W5. Blocks: 020.

## Goal

The specs in `docs/` are the source of truth for future work; several statements are now superseded (user explicitly authorized this). Update them to describe what actually shipped — no aspirational content.

## Steps

1. `docs/01-scope.md`: update the Overview paragraph — status is no longer Settings-only ("Status and transcript tools live inside Settings behind a compact alert affordance" is superseded by the rail status indicator + Tools section); add the collapsible rail, two-stage Clear with snapshot undo, `/` hotkey, Ready check, and the chrome/TV two-tier design language to In scope. Keep the success boundary honest.
2. `docs/02-system-architecture.md`: add `rail-collapse.js`, `fetch-timeout.js`, the settings master-detail structure, and the status pipeline (level-aware `updateStatus` dual-write).
3. `docs/05-code-organization.md` + `docs/06-test-strategy.md`: new modules and their mirrored tests; the pinned-CSS-contract convention including the chrome token tier.
4. `docs/00-index.md`: refresh entries if it summarizes the above files.
5. `docs/07-ai-and-privacy.md`: only if reliability changes altered any statement (timeouts/backoff don't change data handling — verify, likely no-op).
6. Check `docs/decisions/` for ADRs contradicted by the redesign; if one exists (e.g. status-in-settings), add a superseding note rather than rewriting history.
7. Keep each file's existing voice/format (TL;DR blockquote style).

## Acceptance criteria

- A new reader of `docs/` gets an accurate picture of the shipped app; no doc claims the old glass/TV-chrome design or Settings-only status; `npm test` still green (docs don't affect tests, but run it anyway).

## Out of scope

Rewriting docs wholesale; documenting future ideas.
