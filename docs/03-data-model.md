# Data Model

> **TL;DR:** There is no database. The model is the client runtime state, short transcript chunks, and the small JSON payloads sent to the server.

## Overview

The app keeps its working state in memory in the browser. A small amount of user preference state is stored in `localStorage` so the helper does not have to reset font size or source selection on every refresh.

The server keeps no durable business data. It only receives JSON payloads for config, transcription, and summarization, then returns compact JSON responses.

The important model rule is that the display state is append-only from the user's point of view. Lines can be added, undone, or cleared, but the latest five lines are what matter.

## Runtime state

| Field | Type | Purpose |
| --- | --- | --- |
| `lines` | `string[]` | The ordered output lines shown on the TV, capped to the latest twenty in memory and rendered as the latest five. |
| `mode` | `speaker` \| `information` \| `song` \| `prayer` | The summarization mode chosen by the helper. |
| `paused` | `boolean` | Whether AI summarization and transcription should stop producing new lines. |
| `fontSize` | `number` | The large-print size used by the TV display. |
| `transcriptChunks` | `{ text: string, at: number }[]` | Recent final transcript chunks used to build summary context. |
| `transcriptPreview` | `string` | The latest partial transcription text shown in the helper panel. |
| `listening` | `boolean` | Whether transcription is active. |
| `transcriptionSource` | `browser` \| `openai` | Which transcription driver is active. |
| `summarizationSource` | `openai` | Which summarization driver is active. |
| `openAiReady` | `boolean` | Whether the server reported an OpenAI key. |

## Display line shape

The display layer treats each line as a cleaned string, not as a structured object. A line must be normalized before storage so duplicates and accidental spacing differences do not create repeated output.

## Transcript chunk shape

Transcript chunks are stored as:

```json
{ "text": "short cleaned transcript text", "at": 1710000000000 }
```

Only recent chunks are used to build the summary input. Old chunks are pruned opportunistically, not persisted.

## API payload shapes

The server accepts and returns these JSON shapes:

| Route | Request | Response |
| --- | --- | --- |
| `POST /api/transcribe` | `{ audioBase64, mimeType, filename, mode }` | `{ text }` |
| `POST /api/summarize` | `{ mode, recentTranscript, visibleLines }` | `{ line, reason? }` |
| `GET /api/config` | none | `{ hasOpenAIKey, model, sources }` |

## Related specs

- [docs/04-api-conventions.md](04-api-conventions.md) - exact route behavior and error handling.
- [docs/07-ai-and-privacy.md](07-ai-and-privacy.md) - when text may be sent to a provider.

