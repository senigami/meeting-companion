# Meeting Companion Display Specs

> **TL;DR:** This repo is a tiny local Express app for live church accessibility support. Specs and code are jointly authoritative; when they drift, fix the drift explicitly in the same change. Related decisions: [ADR-0001](decisions/0001-local-express-static-app.md), [ADR-0002](decisions/0002-modular-source-registry.md), [ADR-0003](decisions/0003-no-audio-storage-by-default.md).

## Document Index

| File | Covers |
| --- | --- |
| [docs/01-scope.md](01-scope.md) | Product boundary, audience, and what is explicitly out of scope. |
| [docs/02-system-architecture.md](02-system-architecture.md) | Client/server split, source registry, transcription and summary flow. |
| [docs/03-data-model.md](03-data-model.md) | Runtime state, line model, transcript chunks, and API payload shapes. |
| [docs/04-api-conventions.md](04-api-conventions.md) | HTTP endpoints, request/response shapes, env vars, and error behavior. |
| [docs/05-code-organization.md](05-code-organization.md) | Folder layout, module boundaries, and mirrored test layout. |
| [docs/06-test-strategy.md](06-test-strategy.md) | What is unit-tested, what is verified manually, and where tests live. |
| [docs/07-ai-and-privacy.md](07-ai-and-privacy.md) | Browser/OpenAI source model, prompt rules, and privacy defaults. |

## Product Summary

Meeting Companion Display is a tiny local helper for one deaf and low-vision person during a church meeting. The laptop runs a browser UI that drives a five-line large-print TV display and a helper panel for manual entry, keyboard shortcuts, and AI-assisted transcription or summarization.

The app stays local and lightweight: Express serves the static UI and the JSON endpoints, the browser can transcribe speech locally when supported, and OpenAI can be used for transcription while OpenAI or Claude can be used for summarization when the helper chooses it. The display never shows labels, only the five lines meant for the TV.

The helper panel is intentionally dense so it can be operated under pressure. It includes mode selection, source selection, manual lines, undo, clear, pause, and text-size controls. The visible output is always constrained to the five most recent lines.

## Key Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| App shape | Tiny local Express server with plain HTML/CSS/JS | Keeps startup simple and avoids framework overhead for a single-purpose helper. |
| AI wiring | Standardized source registry with browser, OpenAI, and Claude drivers | Lets the app swap or add sources without changing the UI contract. |
| Transcription default | Browser first | Keeps the default path local and avoids sending audio unless the helper selects OpenAI. |
| Summary source | OpenAI and Claude | The server already centralizes prompt policy and can reject vague lines consistently. |
| Storage | No transcript or audio persistence by default | Keeps the tool private and easy to run on a church laptop. |

## Assumed conventions - confirm these

- Transcription source ids are stable contract values: `browser` and `openai`.
- Summary source ids are stable contract values and currently `openai` and `claude`.
- The visible display remains exactly five lines, with new lines appended at the bottom and older lines moving up.
- Manual lines always take effect immediately, even if AI is paused.

## Open compliance items

None at the moment. The current code and the specs in this set are aligned.
