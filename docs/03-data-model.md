# Data Model

> **TL;DR:** There is no database. The model is the client runtime state, short transcript chunks, and the small JSON payloads sent to the server.

## Overview

The app keeps its working state in memory in the browser. A small amount of user preference state is stored in `localStorage` so the helper does not have to reset font size or source selection on every refresh.

The server keeps no durable business data. It only receives JSON payloads for config, transcription, and summarization, then returns compact JSON responses.

The important model rule is that the display state is append-only from the user's point of view. Transcript cards can be added, undone, or cleared, but the newest items are what matter.

Provider keys are treated as browser-local configuration when the helper saves them in Settings. The app stores only a masked local copy, never echoes the full secret in diagnostics, and uses the saved value when testing or sending provider requests from this browser.

## Runtime state

| Field | Type | Purpose |
| --- | --- | --- |
| `transcriptItems` | `TranscriptItem[]` | The ordered output cards shown on the TV, capped in memory and rendered as a scrollable stack. |
| `mode` | `speaker` \| `information` \| `song` \| `prayer` | The summarization mode chosen by the helper. |
| `paused` | `boolean` | Whether AI summarization and transcription should stop producing new lines. |
| `fontSize` | `number` | The large-print size used by the TV display. |
| `transcriptChunks` | `{ text: string, at: number }[]` | Recent final transcript chunks used to build summary context. |
| `transcriptPreview` | `string` | The latest partial transcription text shown in the helper panel. |
| `listening` | `boolean` | Whether transcription is active. |
| `transcriptionSource` | `browser` \| `openai` | Which transcription driver is active. |
| `summarizationSource` | `openai` \| `claude` | Which summarization driver is active. The runtime falls back to an available provider when the selected one is not configured. |
| `openAiReady` | `boolean` | Whether the server reported an OpenAI key. |
| `anthropicReady` | `boolean` | Whether the server reported an Anthropic key. |
| `providerKeys` | `{ openai?: string, claude?: string }` | Browser-local provider overrides saved in Settings. |

## Transcript item shape

The display layer treats each visible item as a structured object so the UI can show mode, source, and time metadata without parsing a raw string.

```ts
type TranscriptItem = {
  id: string;
  mode: 'speaker' | 'information' | 'song' | 'prayer';
  text: string;
  createdAt: number;
  source?: 'ai' | 'manual';
};
```

Transcript text must be normalized before storage so duplicates and accidental spacing differences do not create repeated output.

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
| `POST /api/summarize` | `{ source, mode, recentTranscript, visibleLines }` | `{ line, reason? }` |
| `GET /api/config` | none | `{ hasOpenAIKey, hasAnthropicKey, model, sources }` |
| `POST /api/provider/test` | `{ provider, apiKey }` | `{ ok: true }` or `{ error }` |

## Related specs

- [docs/04-api-conventions.md](04-api-conventions.md) - exact route behavior and error handling.
- [docs/07-ai-and-privacy.md](07-ai-and-privacy.md) - when text may be sent to a provider.
