# ADR-0003: No audio or transcript persistence by default

> **TL;DR:** Do not save audio or transcript history by default. The helper can always work in memory, which keeps the workflow private and simple on a shared church laptop.

## Status

Accepted

## Date

2026-06-29

## Context

Retro-documented; this decision was made earlier in the project's life. The app is for a live meeting workflow, not archival recording, and the user explicitly asked not to save audio or transcripts by default.

## Decision

Keep audio ephemeral, keep transcript text ephemeral, and limit persistence to local UI preferences such as font size and selected source.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Store transcript history locally | Adds privacy risk and more cleanup logic without helping the live workflow. |
| Store audio chunks for replay | Changes the app into a recorder, which is not the intended use case. |
| Sync state to a cloud service | Not needed and contrary to the local-first requirement. |

## Consequences

The app is easier to trust on a shared laptop and simpler to explain to helpers. Future archival features would need an explicit design decision.

## Spec docs affected

- [docs/01-scope.md](../01-scope.md)
- [docs/03-data-model.md](../03-data-model.md)
- [docs/07-ai-and-privacy.md](../07-ai-and-privacy.md)

