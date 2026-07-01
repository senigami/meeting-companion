# Desktop Operator Redesign — Overview

> **TL;DR:** The TV transcript display works; the operator chrome around it still looks like a 10-foot TV interface. This plan makes the laptop side feel like a well-made dark Mac app, adds a collapse-to-icons rail, fixes the unsafe Clear path, makes failures visible at a glance, and hardens the AI providers — so a non-technical helper can run a real meeting with confidence.

## Goal

1. **Operator chrome reads as a dark macOS desktop app** (Apple HIG): flat opaque surfaces, hairline separators, macOS type scale, restrained accent, desktop focus rings — clearly distinct from the large-print TV canvas it controls.
2. **Collapsible rail**: an always-visible toggle collapses the rail to a 64px icon strip; the TV display genuinely reclaims the width; expanded-with-labels is the default; state persists locally.
3. **Safe + fast live workflow**: Clear can no longer destroy a meeting (two-stage confirm, snapshot restore, no bare `C` key); `/` jumps to manual input; undo shows what it removed; paused state is loud.
4. **Failures are visible, not silent**: a minimal always-visible status indicator (dot + word) in the rail; consecutive-failure escalation with one-step backoff; fetch timeouts; browser-speech restart visibility; a lean pre-meeting Ready check.

## Scope & Boundary

In scope: `public/styles/*.css`, `public/index.html`, `public/controller/*` (new `rail-collapse.js`), `public/services/transcription/*`, `public/services/summarization/*`, matching tests under `test/`, and reconciling `docs/` specs at the end.

Out of scope:

- No framework, no build step, no compiling, no new dependencies.
- No light mode or theme switching.
- No changes to the TV transcript canvas beyond the two sanctioned tweaks (map invariant I1).
- No new persisted features beyond the rail-collapsed flag.
- No retry libraries, service workers, or resilience frameworks.
- No multi-speaker, history, cloud, or mobile-first work.

## Hard constraints

- Vanilla JS ESM served statically by Express; runnable with `npm start`.
- `npm test` (`node --test`) green after every task.
- Operator is non-technical: simplicity trumps richness; nothing hover-only; targets ≥ 44px.
- User authorized updating `docs/` scope where this plan supersedes it (final task 019).

## Success criteria (definition of done)

- `npm start` → laptop UI looks like a refined dark Mac app; TV canvas unchanged in character (large print, high contrast, cards).
- Rail collapses to icons via a visible button, expands back, persists across reload; modes/undo/pause stay one click when collapsed; manual bar always available.
- Clear requires confirmation and is undoable; `C` alone does nothing.
- Mic drop, AI failure, or paused state is visible within a glance at the rail; after 3 consecutive summarize failures the operator sees an alert and the loop backs off.
- Ready check shows green for mic + AI key before the meeting; sample line can be shown on the TV to tune size.
- Full test suite green; docs in `docs/` match shipped behavior.
