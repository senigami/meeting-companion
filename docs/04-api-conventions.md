# API Conventions

> **TL;DR:** The API is small, JSON-only, and local-first. Errors are simple JSON objects, and provider access is gated by the presence of the relevant API key.

## Overview

The server exists to serve the static client and provide a narrow JSON surface for runtime config, transcription, and summarization. It does not expose a general-purpose API.

All request and response bodies are JSON except the static asset routes. The client is responsible for formatting and display; the server is responsible for calling OpenAI with the right prompt and returning compact results.

## Routes

| Route | Method | Purpose | Response shape |
| --- | --- | --- | --- |
| `/api/config` | `GET` | Report provider availability and source metadata. | `{ hasOpenAIKey, hasAnthropicKey, model, sources }` |
| `/api/transcribe` | `POST` | Transcribe a short audio chunk with OpenAI. | `{ text }` or `{ error }` |
| `/api/summarize` | `POST` | Summarize recent transcript text into one useful line. | `{ line, reason? }` or `{ error }` |

## Request rules

- Accept JSON only on `/api/transcribe` and `/api/summarize`.
- Treat missing audio on `/api/transcribe` as an empty transcription request and return `{ text: "" }`.
- Accept `mode` values `speaker`, `information`, `song`, and `prayer`.
- Accept `source` values `openai` and `claude` on `/api/summarize`.
- Send only the recent transcript text and visible lines needed to make the summary decision.

## Error handling

- Return a JSON error object when the server cannot complete a provider call.
- Use a short message that is safe to show in the helper panel.
- Keep provider failures non-fatal to the rest of the UI so manual entry still works.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | no | Enables OpenAI transcription and summarization. |
| `ANTHROPIC_API_KEY` | no | Enables Claude summarization. |
| `ANTHROPIC_MODEL` | no | Overrides the Claude model name. |
| `PORT` | no | Overrides the local HTTP port. Defaults to `3000`. |
| `HOST` | no | Overrides the listen host. Defaults to `127.0.0.1`. Non-loopback values require `ALLOW_REMOTE_HOST=true`. |
| `ALLOW_REMOTE_HOST` | no | Opts in to binding `HOST` outside loopback for deliberate LAN access. |

## Provider rules

- `/api/transcribe` must keep using `gpt-4o-transcribe` unless the provider wrapper is updated everywhere.
- `/api/summarize` must keep the prompt policy centralized in `public/services/summary-prompt.js`.
- The server must not save audio or transcripts by default.

## Related specs

- [docs/02-system-architecture.md](02-system-architecture.md) - how the routes fit the app.
- [docs/07-ai-and-privacy.md](07-ai-and-privacy.md) - privacy and provider use rules.
