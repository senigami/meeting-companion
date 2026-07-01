# AI and Privacy

> **TL;DR:** AI is optional, modular, and source-driven. The app should not store audio or transcripts by default, and OpenAI should only see the minimum text or audio chunk needed for the current action.

## Overview

The app uses AI in two places: speech transcription and summary generation. Those are separate responsibilities and are routed through separate source adapters so they can evolve independently.

The browser source is preferred when it is available because it keeps transcription local to the laptop. OpenAI is available as a modular source for transcription, and OpenAI or Claude can provide summaries. The UI only shows source choices that are ready to use; adding a key in Settings registers the provider and makes it available in the selector.
When the helper saves a provider key in Settings, the key stays in the running local server process unless the server is using an environment variable. The UI should show masked key status only and never reveal the full secret in diagnostics.

Generic UI icons are not part of the AI pipeline. They can come from Lucide or the local SVG sprite, but they should not introduce extra runtime behavior or network dependency.

## Source rules

- Browser transcription is a first-class source option.
- OpenAI transcription is a first-class source option and is disabled when the key is missing.
- OpenAI summarization and Claude summarization are both first-class summary source options.
- Adding another source must happen by adding a module and registering it in the catalog and registry.
- Provider selection should stay tied to configuration: if a provider has no key, the UI should hide it from the active source list and offer it in the registration card instead of pretending it is ready.
- Provider key setup should happen in the dedicated service-registration card and then promote the provider into the available source list.
- Provider keys are never written to browser storage.

## Prompt rules

- Speaker mode must summarize the specific story, event, teaching, feeling, invitation, or example.
- Information mode must prioritize exact dates, times, places, hymn numbers, assignments, and announcements.
- Song mode must only describe hymn or song status.
- Prayer mode must compress the prayer into a short prayer-shaped line, starting with a simple opening like "Heavenly Father" and ending with "Amen", without going line by line.
- The model must not emit vague filler like "He is talking about faith."

## Privacy rules

- Do not save audio by default.
- Do not save transcript history by default.
- Keep the UI usable in manual-only mode when OpenAI is unavailable.
- Limit provider calls to the current task context rather than sending a long history.
- Do not display full API keys in plain text by default.

## Related specs

- [docs/02-system-architecture.md](02-system-architecture.md) - where the source modules fit.
- [docs/04-api-conventions.md](04-api-conventions.md) - how provider calls are sent.
