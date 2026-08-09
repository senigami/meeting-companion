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
| `public/controller/demo-feed.js` | Demo/sample stream used for live visual debugging. |
| `public/controller/rail-collapse.js` | Toggles the operator rail between full width and a 64px icon-only strip and persists the choice. |
| `public/services/` | Shared prompts, catalogs, registry, and provider adapters. |
| `public/services/transcript-bucket.js` | Partitions and trims the live transcript preview into sentence-complete "consumable" text vs. an in-progress tail, so the rail preview only drains finished sentences. |
| `public/services/fetch-timeout.js` | Wraps `fetch` with an `AbortController`-based timeout for the transcribe/summarize/provider-test call sites. |
| `public/services/summarization/claude.js` | Claude summarization client wrapper. |
| `server/summarization.js` | Server-side provider switch for OpenAI and Claude summarization. Owns the prompt, the reply budget and the post-processing; calls `packages/ai-provider` for the network. |
| `packages/ai-provider/` | Portable provider adapters (issue #9). Deliberately NOT part of the app: a directory another repo copies. It takes an already-resolved key and a message array and returns text or a typed failure. Key resolution, prompts and reading-load maths stay in this app on purpose. |
| `summarizer.js` | Compatibility re-export for the summarizer helpers. |
| `test/` | Separate test tree that mirrors source paths. |

## Frontend layering

- `public/index.html` defines the semantic structure for the full-window display and helper rail.
- `public/style.css` handles the skin and readability tuning.
- `public/app.js` only starts the controller.
- `public/controller/start-app.js` handles bootstrap and event wiring.
- `public/controller/runtime.js` handles state, shortcuts, source wiring, and AI loop behavior.
- `public/controller/view.js` handles rendering and DOM updates.
- `public/services/transcript-bucket.js` keeps the sentence-boundary consumption logic for the live transcript preview separate from the controller.
- `public/controller/demo-feed.js` keeps sample-data playback out of the production transcript path.
- `public/controller/rail-collapse.js` keeps the collapse/expand toggle, its CSS-state class, and its persistence separate from `rail-resize.js`, which continues to own drag-resize only.
- `public/services/` handles prompt construction and provider adapters.
- `public/services/fetch-timeout.js` keeps the shared request-timeout behavior out of each individual provider driver.
- `server/summarization.js` keeps provider-specific summarization code out of the route handler.

Do not put provider-specific logic in the HTML or the display renderer. The view should only know about the registry and the current state.

## Test layout

Mirror the source tree under `test/`:

| Source | Test path |
| --- | --- |
| `summarizer.js` | No dedicated test; it is a trivial re-export covered indirectly through `test/public/services/summary-prompt.test.js`. |
| `packages/ai-provider/` | `packages/ai-provider/test/call-provider.test.js`, kept beside the source rather than under `test/` so a repo copying the directory gets the tests with it. |
| `public/app.js` | `test/public/app-bootstrap.test.js` |
| `public/controller/start-app.js` | `test/public/app-bootstrap.test.js` |
| `public/controller/runtime.js` | `test/public/app-bootstrap.test.js` |
| `public/controller/view.js` | `test/public/app-bootstrap.test.js` |
| `public/services/summary-prompt.js` | `test/public/services/summary-prompt.test.js` |
| `public/services/catalog.js` | `test/public/services/catalog.test.js` |
| `public/services/transcription/openai.js` | `test/public/services/transcription/openai.test.js` |
| `public/services/view-settings.js` | `test/public/services/view-settings.test.js` |
| `public/services/summarization/claude.js` | `test/public/services/summarization/claude.test.js` |
| `public/services/fetch-timeout.js` | `test/public/services/fetch-timeout.test.js` |
| `public/services/transcript-bucket.js` | `test/public/services/transcript-bucket.test.js` |
| `public/controller/rail-collapse.js` | `test/public/controller/rail-collapse.test.js` |
| `public/controller/rail-resize.js` | `test/public/controller/rail-resize.test.js` |
| `public/controller/view.js` | `test/public/controller/view.test.js` |
| `public/index.html` | `test/public/helper-panel-structure.test.js` |
| `public/style.css` (and the split `*.css` files it composes) | `test/public/style.test.js` |
| `server.js` | `test/server/app.test.js` |
| `server/summarization.js` | `test/server/summarization.test.js` |

This layout makes it obvious which tests cover which source file and keeps coverage easy to scan.

`test/public/style.test.js` is a pinned CSS contract: it regex-asserts specific selectors and literal values rather than snapshotting the whole file. This now includes the `--chrome-*` token tier (colors, radii, spacing) alongside the pre-existing pins for rail width, grid layout, and slider behavior. A change that touches a pinned value must update that specific assertion in the same change, with the reason stated; the file should never be rewritten wholesale to make a test pass.

## File size and responsibility

- Keep files single-purpose.
- Split modules before they become hard to skim.
- Prefer short functions with explicit names over large inline logic blocks.
- Keep comments for reasons and constraints, not for narrating obvious code.

## Related specs

- [docs/06-test-strategy.md](06-test-strategy.md) - what should be tested where.
- [docs/02-system-architecture.md](02-system-architecture.md) - the runtime boundary between parts.
