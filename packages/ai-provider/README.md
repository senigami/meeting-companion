# ai-provider

A single function: `callProvider({ provider, apiKey, messages, maxTokens, model, fetchImpl })` ->
`{ text }`, or throws a `ProviderError` with `.type` in `auth | rate-limit | network |
malformed-response | unknown` and `.detail` (the provider's own raw error text).

`provider` is `'openai'` or `'claude'`. Anything outside that option list is **rejected**, not
ignored: both adapters pin `temperature` (0.2) and retries (off), so a caller asking for a different
value needs to hear about it rather than get a call that quietly did something else.

`messages` is one canonical `[system, ...turns]` array;
each adapter reshapes it for its own provider (Claude splits the system message into a top-level
`system` field, OpenAI sends the array as-is) so the caller never has to know that.

## This is copied, not installed

There is no `package.json`, no publishing, no version. A consuming repo copies this directory and
keeps its own copy in sync by hand. That is the intended distribution, not a stopgap: the seam is
deliberately small enough that copying costs less than the coordination a shared package would
need across two apps evolving independently.

## What a consuming repo must supply for itself

This package does exactly the two provider adapters and nothing else. Everything around it stays
in the app:

- **The `openai` npm dependency, and a runtime with global `fetch`/`Response`** (Node 18+). The
  OpenAI adapter imports the `openai` SDK; the Claude adapter speaks HTTP directly and needs no
  dependency. Copying this directory without adding `openai` to the consuming repo's `package.json`
  fails at import time, not at call time.
- **Prompt building.** What goes into `messages`, how `maxWords`/`level` map to token budgets, any
  reading-load or accessibility calibration -- none of that lives here.
- **Post-processing.** Splitting the reply into lines, packing lines into cards, shortening to a
  display character cap, deduping -- all app concerns applied to the `{ text }` this package
  returns.
- **Operator-facing error messages.** This package classifies failures into a typed vocabulary and
  keeps the provider's raw error text on `.detail`. Turning that into copy a person should read
  ("the account has no credit left, type lines manually") is app UI judgment, not this package's.
- **The provider key.** This package receives one already-resolved `apiKey` string per call and
  never sees where it came from. A consuming repo needs its own memory-only key store meeting the
  same contract this app's does: no browser storage, no disk, no plaintext diagnostics, lost on
  restart unless set as an env var. That is a product decision this package cannot make and does
  not attempt to.

## The one thing this package guarantees on its own

The resolved `apiKey` never appears **in full** in a thrown error's message, detail, or serialized
form. Every adapter routes its throws through a helper that checks the outgoing error against the
key first and fails loudly (a plain, uncaught `Error`, not a `ProviderError`) if it finds it. See
`errors.js` and the "never leaks the key" tests.

**Read the limits before relying on it.** The check is a substring match on the exact key, so two
things get past:

- **A truncated or transformed echo.** A provider reflecting the first 20 characters, or a
  URL-encoded form, does not match and reaches your error.
- **A key shorter than 8 characters**, skipped entirely so short strings do not match half the
  world's error text. Real keys are far longer; test doubles often are not.

So it is a backstop against a whole key landing in a log, not a redaction layer. **You still need
your own.** This app runs every provider detail through `safeErrorDetail` in `server.js` before it
reaches an operator or a log, and a copying repo has nothing equivalent until it writes one.
