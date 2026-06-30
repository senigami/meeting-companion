# ADR-0001: Local Express app with static browser UI

> **TL;DR:** Keep the app as a tiny local Express server serving plain HTML/CSS/JS. That keeps setup simple, avoids framework churn, and matches the one-screen helper use case.

## Status

Accepted

## Date

2026-06-29

## Context

Retro-documented; this decision was made earlier in the project's life. The app only needs a local laptop and TV, so a heavy web framework would add maintenance cost without solving a real problem.

## Decision

Use Express to serve the static UI and the small JSON API, with plain browser JavaScript for the helper controller and display rendering.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Next.js / React | Too much structure for a tiny local helper. |
| Electron / desktop wrapper | Not needed because the browser already provides the kiosk-like surface. |
| Server-rendered templates only | The helper panel needs rich interaction and source switching that is easier to keep in client JS. |

## Consequences

The app stays easy to start with `npm start` and easy to reason about. UI and behavior remain in plain files that a human can inspect quickly.

## Spec docs affected

- [docs/01-scope.md](../01-scope.md)
- [docs/02-system-architecture.md](../02-system-architecture.md)
- [docs/05-code-organization.md](../05-code-organization.md)

