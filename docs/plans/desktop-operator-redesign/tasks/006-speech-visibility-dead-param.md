# 006 — Browser-speech restart visibility + delete dead getApiKey params

Status: done
Map links: P10; invariants I7, I13. Depends on: nothing (parallel with W1). Blocks: 020.

## Goal

Two provider-hygiene fixes. (a) `public/services/transcription/browser.js` `onend` auto-restarts recognition inside a bare `try {} catch {}` — repeated restart failure is silent forever. Track consecutive restart failures; after 2, call the driver's `onStatus` with a plain message ("Microphone stopped. Click Start to try again.") and stop retrying. Reset the counter on a successful restart/result. (b) Delete the dead `getApiKey` dependency from `public/services/transcription/openai.js` (~line 24), `public/services/summarization/openai.js` (~line 7), and `public/services/summarization/claude.js` (~line 7) — it is declared but never used (server-side `providerKeyStore` is the intended key path); remove it from the factory signatures and from every call site that passes it (check `start-app.js` / the source registry wiring).

## Steps

1. (a) in `browser.js`: counter around the `onend` restart; surface via existing `onStatus` callback; ensure `isFatalSpeechRecognitionError` handling unchanged.
2. (b) grep `getApiKey` across `public/` and `test/`; remove parameter, destructuring, and pass-throughs; update tests that stub it.
3. Run full suite.

## Acceptance criteria

- `grep -r getApiKey public/ test/` → no matches.
- New test: simulated repeated `onend` restart failures produce a status call after 2 and stop the retry loop; success resets.
- No behavior change for the normal speech path; `npm test` green.

## Out of scope

New status UI (016); changing the server key store.
