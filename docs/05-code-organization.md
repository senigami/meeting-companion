# Code Organization

> **TL;DR:** Keep structure, behavior, and presentation separate. The tests live in a separate tree that mirrors the source layout.

## Overview

The codebase is intentionally small, so the folder layout must do the job of making ownership obvious. The display controller lives in the browser entry file, reusable service logic lives under `public/services/`, and the server stays thin.

The source tree is organized by responsibility, not by build artifact. The client view and CSS remain in `public/`, the source wrappers live beside the client, and the server entry point remains at the repo root.

## Layout

| Path | Purpose |
| --- | --- |
| `server.js` | Express entry point and API proxy. |
| `public/index.html` | Static shell for the TV display and helper panel. |
| `public/style.css` | Visual skin for the page. |
| `public/app.js` | Tiny browser entry point that boots the controller. |
| `public/controller/app-controller.js` | Re-export that keeps the entry point stable. |
| `public/controller/start-app.js` | Bootstrap and event binding. |
| `public/controller/runtime.js` | Controller state machine and app actions. |
| `public/controller/view.js` | DOM/view updates for the display and helper panel. |
| `public/services/` | Shared prompts, catalogs, registry, and provider adapters. |
| `public/services/summarization/claude.js` | Claude summarization client wrapper. |
| `server/summarization.js` | Server-side provider switch for OpenAI and Claude summarization. |
| `summarizer.js` | Compatibility re-export for the summarizer helpers. |
| `test/` | Separate test tree that mirrors source paths. |

## Frontend layering

- `public/index.html` defines the semantic structure.
- `public/style.css` handles the skin and readability tuning.
- `public/app.js` only starts the controller.
- `public/controller/start-app.js` handles bootstrap and event wiring.
- `public/controller/runtime.js` handles state, shortcuts, source wiring, and AI loop behavior.
- `public/controller/view.js` handles rendering and DOM updates.
- `public/services/` handles prompt construction and provider adapters.
- `server/summarization.js` keeps provider-specific summarization code out of the route handler.

Do not put provider-specific logic in the HTML or the display renderer. The view should only know about the registry and the current state.

## Test layout

Mirror the source tree under `test/`:

| Source | Test path |
| --- | --- |
| `summarizer.js` | `test/summarizer.test.js` |
| `public/app.js` | `test/public/app-bootstrap.test.js` |
| `public/controller/start-app.js` | `test/public/app-bootstrap.test.js` |
| `public/controller/runtime.js` | `test/public/app-bootstrap.test.js` |
| `public/controller/view.js` | `test/public/app-bootstrap.test.js` |
| `public/services/summary-prompt.js` | `test/public/services/summary-prompt.test.js` |
| `public/services/catalog.js` | `test/public/services/catalog.test.js` |
| `public/services/transcription/prompt.js` | `test/public/services/transcription/prompt.test.js` |
| `public/services/transcription/openai.js` | `test/public/services/transcription/openai.test.js` |
| `public/services/view-settings.js` | `test/public/services/view-settings.test.js` |
| `public/services/summarization/claude.js` | `test/public/services/summarization/claude.test.js` |
| `server.js` | `test/server/app.test.js` |
| `server/summarization.js` | `test/server/summarization.test.js` |

This layout makes it obvious which tests cover which source file and keeps coverage easy to scan.

## File size and responsibility

- Keep files single-purpose.
- Split modules before they become hard to skim.
- Prefer short functions with explicit names over large inline logic blocks.
- Keep comments for reasons and constraints, not for narrating obvious code.

## Related specs

- [docs/06-test-strategy.md](06-test-strategy.md) - what should be tested where.
- [docs/02-system-architecture.md](02-system-architecture.md) - the runtime boundary between parts.
