# Meeting Companion Display Specs

> **TL;DR:** This repo is a tiny local Express app for live church accessibility support. Specs and code are jointly authoritative; when they drift, fix the drift explicitly in the same change. Related decisions: [ADR-0001](decisions/0001-local-express-static-app.md), [ADR-0002](decisions/0002-modular-source-registry.md), [ADR-0003](decisions/0003-no-audio-storage-by-default.md).

## Document Index

| File | Covers |
| --- | --- |
| [docs/01-scope.md](01-scope.md) | Product boundary, audience, and what is explicitly out of scope. |
| [docs/02-system-architecture.md](02-system-architecture.md) | Client/server split, source registry, transcription and summary flow. |
| [docs/03-data-model.md](03-data-model.md) | Runtime state, transcript card model, transcript chunks, and API payload shapes. |
| [docs/04-api-conventions.md](04-api-conventions.md) | HTTP endpoints, request/response shapes, env vars, and error behavior. |
| [docs/05-code-organization.md](05-code-organization.md) | Folder layout, module boundaries, and mirrored test layout. |
| [docs/06-test-strategy.md](06-test-strategy.md) | What is unit-tested, what is verified manually, and where tests live. |
| [docs/07-ai-and-privacy.md](07-ai-and-privacy.md) | Browser/OpenAI source model, prompt rules, and privacy defaults. |

## Product Summary

Meeting Companion Display is a tiny local helper for one deaf and low-vision person during a church meeting. The laptop runs a browser UI that drives a large-print transcript stack on the TV and a helper panel for manual entry, keyboard shortcuts, and AI-assisted transcription or summarization.

The app stays local and lightweight: Express serves the static UI and the JSON endpoints, the browser can transcribe speech locally when supported, and OpenAI can be used for transcription while OpenAI or Claude can be used for summarization when the helper chooses it. The display stays label-light and shows readable transcript cards rather than one dense wall of text.

The operator surface is intentionally slim so it can be scanned under pressure. It keeps icon-first quick controls, mode selection, and viewer adjustments visible in a right-side rail, while Settings keeps source selection limited to services that are already available and uses a separate service-registration card to add or validate new provider keys before they appear in the source lists. A compact live transcript preview can stay visible in the rail so the helper can see the raw incoming stream. Alerts and diagnostics stay inside Settings instead of occupying the live rail. Provider keys are managed by the local server session, not browser storage. Manual lines stay anchored at the bottom of the window. The visible output is always constrained to the five most recent lines.

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
- The visible display renders a scrollable stack of digestible transcript cards, with new items appearing at the bottom and older items moving up.
- Settings contains transcription source and summary source controls, a service-registration card for adding and validating provider keys, alerts, and diagnostics.
- The live transcript preview in the operator rail shows the raw stream tail and can be collapsed.
- View options contains text size, margins, and update interval controls.
- Display margins are percentage-based up to 40%, adjusted with a custom track-width slider, and they set the actual transcript text-flow width. Red guides show that same inset while the helper is dragging the margin control.
- When the Display controls are open and no transcript cards exist yet, the display shows temporary sample text for typography tuning. Closing the Display controls removes the sample text.
- Diagnostics is hidden behind Settings by default.
- Manual lines always take effect immediately, even if AI is paused.

## Open compliance items

None at the moment. The current code and the specs in this set are aligned.
