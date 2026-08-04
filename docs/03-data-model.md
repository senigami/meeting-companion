# Data Model

> **TL;DR:** There is no database. The model is the client runtime state, short transcript chunks, the small JSON payloads sent to the server, and — as of ADR-0004 — one local, gitignored NDJSON recording file per session, written for debugging/tuning rather than as a database.

## Overview

The app keeps its working state in memory in the browser. A small amount of user preference state is stored in `localStorage` so the helper does not have to reset font size on every refresh.

The server keeps no durable business data beyond the session recording described below. It only receives JSON payloads for config, provider-key management, transcription, and summarization, then returns compact JSON responses.

The important model rule is that the display state is append-only from the user's point of view. Transcript cards can be added, undone, or cleared, but the newest items are what matter.

The helper surface also keeps a compact sentence-aware transcript preview in the operator rail so the operator can see the incoming stream without scrolling the TV display. `public/services/transcript-bucket.js` only marks a chunk consumable once it ends at a sentence boundary or settles unpunctuated for 20s, so partial thoughts stay visible instead of vanishing mid-sentence.

Provider keys are treated as server-managed configuration when the helper saves them in Settings. The app stores them in the running local server process, never echoes the full secret in diagnostics, and only returns masked status to the browser.

## Runtime state

| Field | Type | Purpose |
| --- | --- | --- |
| `transcriptItems` | `TranscriptItem[]` | The ordered output cards shown on the TV, capped in memory and rendered as a scrollable stack. |
| `mode` | `speaker` \| `information` \| `song` \| `prayer` | The summarization mode chosen by the helper. |
| `speakerName` | `string` | Who is talking, typed by the helper next to the mode buttons. Empty is valid and means no label. Not persisted as a setting, deliberately, since it belongs to whoever is at the pulpit right now rather than to the machine. It IS written to the ADR-0004 session recording when recording is armed, which it is by default, so a name typed here does reach a file on disk (see the chunk record below). Never sent to a provider (see #40 and the display-only rule). |
| `paused` | `boolean` | Whether AI summarization and transcription should stop producing new lines. |
| `fontSize` | `number` | The large-print size used by the TV display, clamped from 24px to 144px. |
| `displayMargin` | `number` | Percentage-based inset, clamped from 0 to 40, used to set the transcript text-flow width and place matching red display guides. |
| `operatorRailWidth` | `number` | Preferred width of the helper rail in pixels, persisted in browser storage and clamped to the current viewport. |
| `transcriptChunks` | `{ text: string, at: number }[]` | Recent final transcript chunks used to build summary context. |
| `transcriptPreview` | `string` | The latest partial transcription text shown in the helper panel. |
| `summarizeInFlight` | `boolean` | Guards against overlapping summarize calls; a chunk is only marked consumed after its summarize call resolves. |
| `railNoteTimer` | `TimerHandle \| null` | Handle for the transient `#railNote` Clear/Undo feedback message, auto-hidden after 4s. |
| `listening` | `boolean` | Whether transcription is active. |
| `transcriptionSource` | `browser` \| `openai` | Which transcription driver is active. |
| `summarizationSource` | `openai` \| `claude` | Which summarization driver is active. The runtime falls back to an available provider when the selected one is not configured. |
| `openAiReady` | `boolean` | Whether the server reported an OpenAI key. |
| `anthropicReady` | `boolean` | Whether the server reported an Anthropic key. |
| `providerKeys` | `Record<'openai' | 'claude', { configured: boolean, origin: string, label: string, masked: string }>` | Masked provider configuration status returned by the server. |
| `recordingEnabled` | `boolean` | Whether the ADR-0004 debugging/tuning session recorder is armed; persisted in `localStorage`, defaults `true`. |
| `recordingSessionId` | `string` | The current session's recording filename stem (`recordings/<id>.ndjson`), derived from a capture-time timestamp. |

## Transcript item shape

The display layer treats each visible item as a structured object so the UI can show mode, source, and time metadata without parsing a raw string.

```ts
type TranscriptItem = {
  id: string;
  mode: 'speaker' | 'information' | 'song' | 'prayer';
  text: string;
  createdAt: number;
  source?: 'ai' | 'manual';
  speaker?: string;
};
```

Transcript text must be normalized before storage so duplicates and accidental spacing differences do not create repeated output.

## Transcript chunk shape

Transcript chunks are stored as:

```json
{ "text": "short cleaned transcript text", "at": 1710000000000, "mode": "speaker", "speaker": "Brother Ashcroft" }
```

`mode` and `speaker` are carried on the chunk rather than read from current state when the chunk is
finally used. Cards are released to the display one at a time now, several seconds apart, so a chunk
summarised after the helper has moved on must still be labelled with the mode and the person it was
actually said under.

Only recent chunks are used to build the summary input. Old chunks are pruned opportunistically, not persisted.

## Session recording file shape (ADR-0004)

`server/session-recorder.js` appends one line of JSON per record to `recordings/<sessionId>.ndjson`
(gitignored, never in the repo). This is a debugging/tuning instrument, not a durable business
record: it has no viewer, is not human-facing, and audio is never written to it (ADR-0003 still
governs audio). Two record shapes share the file, correlated by chunk `id`:

```json
{ "t": "chunk", "at": "2026-07-29T12:00:00.000Z", "id": "1710000000000", "mode": "speaker", "speaker": "Brother Ashcroft", "text": "..." }
```

```json
{
  "t": "summary",
  "at": "2026-07-29T12:00:01.000Z",
  "mode": "speaker",
  "consumedIds": ["1710000000000"],
  "hadPreviousBlock": false,
  "sent": "...",
  "returned": "...",
  "provider": "openai",
  "ok": true,
  "error": null,
  "latencyMs": 812,
  "wasShortened": false,
  "discardedByCap": 0,
  "discardedByCapClient": 0
}
```

`wasShortened` and `discardedByCap` are deliberately two fields rather than one. Shortening trims a
line's characters and the line still arrives; a discard means real speech never reached the reader.
Folding them together is what let three successive silent-loss defects (#49, #63, #65) each look like a
clean call. `discardedByCapClient` should always be 0: a non-zero value means the server and the client
disagree about how many lines may survive.

`consumedIds` is how a summary record ties back to the exact chunk record(s) it drained. A write
failure (full disk, bad path, missing directory) degrades to `{ ok: false, error }` and never
throws into the live transcription/summarize path.

## API payload shapes

The server accepts and returns these JSON shapes:

| Route | Request | Response |
| --- | --- | --- |
| `POST /api/transcribe` | `{ audioBase64, mimeType, filename, mode }` | `{ text }` |
| `POST /api/summarize` | `{ source, mode, recentTranscript, previousBlock, visibleLines, maxWords, level, history }` | `{ line, reason?, wasShortened?, discardedByCap? }` |
| `GET /api/config` | none | `{ hasOpenAIKey, hasAnthropicKey, model, sources, providerKeys }` |
| `POST /api/provider/key` | `{ provider, apiKey }` | `{ ok: true, provider, providerKeys }` |
| `DELETE /api/provider/key` | `{ provider }` | `{ ok: true, provider, providerKeys }` |
| `POST /api/provider/test` | `{ provider, apiKey }` | `{ ok: true }` or `{ error }` |
| `POST /api/recording/append` | `{ sessionId, records }` | `{ ok: true, written }` or `{ ok: false, error }` |
| `POST /api/reading-pace` | `{ name, payload }` | `{ ok: true }` |
| `GET /api/reading-pace/list` | none | `{ profiles }` |
| `GET /api/reading-pace/:name` | none | the saved profile payload |

`/api/reading-pace` (write) is loopback-only, unlike `/api/recording/append`. That is deliberate and
the reasoning is worth keeping: an append writes into a session file the operator already started,
while this creates a NAMED file about an identifiable person, and a machine on the same network
should not be able to do that.

This table has drifted twice now (#48), both times the same way: a field was added to the summarize
payload and the doc was one field's worth of "too small to bother" behind. It reached five --
`previousBlock`, `maxWords`, `history`, `level`, `wasShortened` -- before anybody noticed. If it
drifts again, the answer is probably to stop restating the shape here and point at the route handler
instead, since a doc that repeats a shape is a second definition of it.

## Related specs

- [docs/04-api-conventions.md](04-api-conventions.md) - exact route behavior and error handling.
- [docs/07-ai-and-privacy.md](07-ai-and-privacy.md) - when text may be sent to a provider.
