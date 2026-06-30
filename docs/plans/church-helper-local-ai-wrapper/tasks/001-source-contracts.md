# 001 - Stabilize the source contracts

- **Status:** done
- **Workload:** Source contracts
- **Effort:** M
- **Blocked by:** nothing
- **Blocks:** 002

## Map links

- **Parts touched:** P2, P3, P4, P5, P6, P7
- **Connections affected:** P1->P3, P1->P4, P1->P5, P1->P6, P5->P7, P6->P7
- **Invariants that apply:** INV-3, INV-4, INV-5

## Goal

Keep browser and OpenAI transcription plus OpenAI summarization behind one standardized source wrapper.

## Why this matters

The helper UI should never know provider-specific details. If a future provider is added, the app should only need a new module and a registry entry.

## Context an executor needs

The source contracts live under `public/services/`. `catalog.js` defines the stable ids, `registry.js` creates driver objects, and the driver modules implement the actual provider behavior. `server.js` exposes `/api/config`, `/api/transcribe`, and `/api/summarize`.

## Target shape / contract

Drivers are selected by source id. Transcription drivers expose `start()` and `stop()`. Summarization drivers expose `summarize()`. The client should call the registry, not the concrete modules.

## Steps

1. Keep the source catalog as the single place that lists available source ids and human labels.
2. Keep browser transcription and OpenAI transcription behind the same driver contract.
3. Keep OpenAI summarization behind the same summary contract.
4. Keep the server routes focused on config and provider proxying.
5. Add or update tests for the prompt and catalog contracts as needed.

## Acceptance criteria

- [x] Source ids are stable and centralized.
- [x] The registry can create browser and OpenAI transcription drivers.
- [x] The registry can create the OpenAI summarizer.
- [x] `npm test` passes.

## Out of scope

Do not change the display layout or helper ergonomics in this task. That belongs to the UI task.
