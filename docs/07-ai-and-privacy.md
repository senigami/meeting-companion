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
- Do not save transcript history by default, with one explicit, superseding exception below.
- Keep the UI usable in manual-only mode when OpenAI is unavailable.
- Limit provider calls to the current task context rather than sending a long history.
- Do not display full API keys in plain text by default.

## Debugging/tuning session recording (ADR-0004)

An explicit, owner-authorized exception to "do not save transcript history by default": both sides of
the pipeline -- incoming transcription chunks and outgoing summarize calls -- are recorded, together,
to a local ndjson file, so a real meeting can be replayed against prompt changes and summary quality
measured instead of guessed at. See
[docs/decisions/0004-session-recording-for-tuning.md](decisions/0004-session-recording-for-tuning.md)
for the full decision.

- Recording is ON by default (a default-off instrument gets no data), with a visible, truthful
  indicator in Settings whenever it is active -- see `#recordingIndicator` in `public/index.html` and
  `updateRecordingIndicator`/`setRecordingEnabled` in `public/controller/runtime.js`.
- Files live under `recordings/` (gitignored), one per app session, and by default never leave the
  machine: the write path is a localhost-only Express route (`/api/recording/append` in
  `server.js`) backed by `server/session-recorder.js`, which never throws and degrades to
  `{ ok: false }` on any failure.
- A recording failure must never interrupt transcription or summarization -- the client
  (`flushRecordingQueue` in `runtime.js`) treats any failed or rejected append as "recording stopped,"
  reflected honestly in the indicator, and nothing else.
- Two read routes serve recordings back: `GET /api/recording/list` (the recording picker) and
  `GET /api/recording/:id` (the raw ndjson for one session). Both feed the replay transcription
  source described below, and both serve transcript text with no auth of their own, so they refuse
  any request whose peer address is not this machine. The test is the *request's* origin, never the
  server's binding: running with `ALLOW_REMOTE_HOST=true` still serves a browser on this machine and
  still refuses one on the LAN. Gating on the binding instead was tried first and was wrong in both
  directions -- it broke replay locally while protecting nothing extra. The peer address is read from
  the raw socket rather than `req.ip`, so a forwarded-for header cannot claim to be local. ADR-0004
  authorized writing recordings to local disk; it never authorized reading them back over the
  network, so that stays closed until something explicitly decides otherwise. See the guard in
  `server.js` (`refuseUnlessLoopback`).
- The replay transcription source (`public/services/transcription/replay.js`, GitHub issue #3) is
  the full replay driver tracked in `docs/backlog.md` item 2: it re-drives the live pipeline from a
  recorded session at its original timing, using the two read routes above, so prompt and summary
  changes can be evaluated against a real meeting instead of a live one. It is not a live microphone,
  and the rail must never say "Listening" while it is active (see `activeTranscriptionStatusLevel` in
  `runtime.js`).
- `scripts/replay-recording.js` remains a separate, simpler tool: it reads a session file directly
  off disk and prints the correlated chunk/summary pairs for eyeballing, without going through the
  app or its pipeline at all.

## Related specs

- [docs/02-system-architecture.md](02-system-architecture.md) - where the source modules fit.
- [docs/04-api-conventions.md](04-api-conventions.md) - how provider calls are sent.
