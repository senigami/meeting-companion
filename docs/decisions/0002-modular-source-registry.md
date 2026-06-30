# ADR-0002: Modular source registry for transcription and summarization

> **TL;DR:** Route transcription and summarization through a standardized source registry so browser and OpenAI implementations stay interchangeable. That makes the app extensible without rewriting the UI.

## Status

Accepted

## Date

2026-06-29

## Context

Retro-documented; this decision was made earlier in the project's life. The user wanted browser and OpenAI to sit under the same wrapper so future providers can be added without changing the calling code.

## Decision

Define stable source ids in a catalog, instantiate drivers through a registry, and keep the client calling the registry rather than concrete provider modules.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Hardcode browser and OpenAI branching in the UI | The display controller would become provider-aware and harder to extend. |
| Build a provider-specific plugin system | Too much machinery for the current app size. |
| Keep only OpenAI | Would lose the local browser transcription fallback that the user wanted. |

## Consequences

Adding a provider now means adding a new driver module and registering it. The UI can stay stable while the implementation behind each source changes.

## Spec docs affected

- [docs/02-system-architecture.md](../02-system-architecture.md)
- [docs/04-api-conventions.md](../04-api-conventions.md)
- [docs/07-ai-and-privacy.md](../07-ai-and-privacy.md)

