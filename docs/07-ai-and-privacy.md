# AI and Privacy

> **TL;DR:** AI is optional, modular, and source-driven. The app should not store audio or transcripts by default, and OpenAI should only see the minimum text or audio chunk needed for the current action.

## Overview

The app uses AI in two places: speech transcription and summary generation. Those are separate responsibilities and are routed through separate source adapters so they can evolve independently.

The browser source is preferred when it is available because it keeps transcription local to the laptop. OpenAI is available as a modular source for transcription, and OpenAI or Claude can provide summaries.

## Source rules

- Browser transcription is a first-class source option.
- OpenAI transcription is a first-class source option and is disabled when the key is missing.
- OpenAI summarization and Claude summarization are both first-class summary source options.
- Adding another source must happen by adding a module and registering it in the catalog and registry.

## Prompt rules

- Speaker mode must summarize the specific story, event, teaching, feeling, invitation, or example.
- Information mode must prioritize exact dates, times, places, hymn numbers, assignments, and announcements.
- Song mode must only describe hymn or song status.
- Prayer mode must not summarize line by line.
- The model must not emit vague filler like "He is talking about faith."

## Privacy rules

- Do not save audio by default.
- Do not save transcript history by default.
- Keep the UI usable in manual-only mode when OpenAI is unavailable.
- Limit provider calls to the current task context rather than sending a long history.

## Related specs

- [docs/02-system-architecture.md](02-system-architecture.md) - where the source modules fit.
- [docs/04-api-conventions.md](04-api-conventions.md) - how provider calls are sent.
