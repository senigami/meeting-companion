# 004 — Fetch timeouts on the three network call sites

Status: done
Map links: P10; invariants I7, I13. Depends on: nothing (parallel with W1). Blocks: 020.

## Goal

A hung request must not silently stall the pipeline. Add ~12s `AbortController` timeouts to: the transcription chunk POST (`public/services/transcription/openai.js`, `sendChunk` → `/api/transcribe`; an `activeRequestController` already exists — add a timer that aborts it), the summarize POST (`public/services/summarization/openai.js` and `claude.js` → `/api/summarize`), and the provider key test (`runtime.js testProviderKey` line ~359 → `/api/provider/test`).

## Steps

1. Add a small shared helper `fetchWithTimeout(fetchImpl, url, options, { timeoutMs = 12000, setTimeoutFn, clearTimeoutFn })` — put it in a new tiny module `public/services/fetch-timeout.js` (plain ESM, I10) so all call sites share it.
2. On timeout, abort and throw an `Error('Request timed out')` so existing catch blocks surface it via `updateStatus` (I7).
3. Timer functions must be injectable — the test harness (`runtime-test-helpers.js`) already passes `setTimeoutFn`/`clearTimeoutFn`; wire them through where available, defaulting to globals.
4. Tests: new `test/public/services/fetch-timeout.test.js` (timeout fires → abort + rejection; success path clears timer). Update driver tests if their fake fetch signatures change.

## Acceptance criteria

- All three call sites go through the helper; timeout ≈12s; timers cleaned up on success.
- A timed-out summarize surfaces "Could not summarize: Request timed out" through the existing catch (runtime.js ~191).
- `npm test` green.

## Out of scope

Retry logic (005 handles backoff); server-side changes; UI changes.
