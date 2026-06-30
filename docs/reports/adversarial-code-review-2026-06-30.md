# Adversarial Code Review - 2026-06-30

## Scope

Reviewed the full non-dependency project code: Express server, browser controller, source drivers, HTML/CSS, tests, specs, README, and agent instructions. Excluded `node_modules/` and binary screenshots. Current working tree included uncommitted SVG icon changes in `public/style.css` and `test/public/style.test.js`.

Verification run:

- `npm test` - pass, 14 tests.
- `git diff --check` - pass.
- `npm audit --omit=dev --json` - not completed. The first run failed because registry access is blocked; the escalated run was rejected because it would disclose dependency metadata to npm.

Chosen adversarial personas:

- Saboteur - tries to break runtime state, browser APIs, provider calls, and error paths in production.
- New Hire - checks whether future changes are understandable and where implicit contracts are undocumented.
- Security Auditor - checks local server exposure, API key proxying, input trust boundaries, and privacy controls.

## Verdict

**BLOCK for privacy/control correctness before relying on live audio. CONCERNS for general local/manual-only use.**

The app is small and testable, but the AI pause/listening contract is not strong enough for a tool whose purpose is live accessibility support. Provider API and malformed-input handling also need hardening before this should be trusted on a church laptop during a meeting.

## Critical Findings

### CRITICAL-1 - Pause AI does not actually stop all AI capture or pending provider work

Personas: Saboteur, Security Auditor. Severity promoted because both independently hit the same risk.

Evidence:

- `public/controller/runtime.js:209` toggles `paused`, but `public/controller/runtime.js:213` only stops the transcription driver when the source is `openai`.
- For browser transcription, `public/controller/runtime.js:217` only clears the summary loop. The Web Speech recognizer keeps running and continues feeding `handleTranscriptEvent()` into `transcriptChunks`.
- `public/services/transcription/openai.js:37` starts sending a chunk before checking for cancellation again. `public/services/transcription/openai.js:89` chains queued uploads without an `AbortController`, so chunks already queued can still be sent after pause/stop.

Impact:

The user-visible control says "Pause AI", and the data model says `paused` means AI summarization and transcription should stop producing new lines. In practice, browser transcription continues capturing speech while paused, and OpenAI uploads already in flight can continue after pause. That undermines operator trust and can send audio after the helper thinks AI is paused.

Fix direction:

Make pause stop the active transcription driver for every source, abort or ignore queued OpenAI uploads before network submission, and add tests for browser pause, OpenAI pause, and resume behavior.

## Warnings

### WARNING-1 - Changing mode while OpenAI transcription is running keeps using the old transcription prompt

Personas: Saboteur, New Hire.

Evidence:

- `public/controller/runtime.js:149` updates `ctx.state.mode` and the buttons only.
- `public/controller/runtime.js:186` calls `driver.setMode()` only inside `startListening()`.
- `public/services/transcription/openai.js:76` supports `setMode()`, but it is not called on active mode changes.

Impact:

If the helper switches from Speaker to Song or Information during live OpenAI transcription, subsequent audio chunks can keep using the prior prompt. This is most visible in Song and Prayer modes, where the app is supposed to avoid lyrics or line-by-line prayer summaries.

Fix direction:

When `setMode()` runs, propagate the mode to any active transcription driver that supports `setMode()`. Add a test that starts OpenAI transcription, changes mode, and verifies later chunks use the new mode.

### WARNING-2 - API parse errors violate the JSON-only error contract

Personas: Saboteur.

Evidence:

- `server.js:16` installs `express.json({ limit: '1mb' })`.
- There is no Express error middleware after the routes.
- `docs/04-api-conventions.md:21` says API routes accept JSON only, and `docs/04-api-conventions.md:29` says errors should return JSON error objects.

Impact:

Malformed JSON or oversized request bodies can be handled by Express's default error path, which returns an HTML/text error instead of `{ error }`. Client code such as `public/services/summarization/openai.js:24`, `public/services/summarization/claude.js:25`, and `public/services/transcription/openai.js:51` assumes JSON and will throw confusing parsing errors.

Fix direction:

Add API error middleware that turns JSON parse and body-size failures into compact JSON errors. Add route-level tests for malformed JSON and oversized payloads.

### WARNING-3 - Provider response parsing assumes valid JSON on every network response

Personas: Saboteur, New Hire.

Evidence:

- Client wrappers call `response.json()` before guarding response shape: `public/services/summarization/openai.js:24`, `public/services/summarization/claude.js:25`, and `public/services/transcription/openai.js:51`.
- The Claude server helper does the same at `server/summarization.js:97`.

Impact:

If the local server returns a non-JSON error, or Anthropic returns a non-JSON/empty error body, the app reports a generic parsing failure instead of a useful provider or local-server status. This is likely during setup mistakes, network loss, body-size errors, or provider incidents.

Fix direction:

Centralize response parsing behind a helper that reads text first, safely parses JSON when present, and produces a short operator-safe message. Cover both client wrappers and server-side Claude fetch.

### WARNING-4 - The local server can become an unauthenticated provider proxy if `HOST` is opened

Personas: Security Auditor.

Evidence:

- `server.js:12` allows `HOST` to override the default `127.0.0.1`.
- `docs/04-api-conventions.md:41` documents `HOST`.
- `/api/transcribe` and `/api/summarize` call provider APIs using local environment keys with no local auth, CSRF token, origin check, or rate limiting.

Impact:

The default is local-only, but setting `HOST=0.0.0.0` exposes a provider-backed API to the LAN. Anyone who can reach the laptop could spend API credits or send arbitrary transcript/audio data through the helper. This is not a default exploit, but it is a sharp edge in a church environment where helpers may follow copy-pasted run commands.

Fix direction:

Keep `127.0.0.1` as default, document the risk, and either reject non-loopback hosts unless explicitly allowed or add a simple local operator token when binding beyond loopback.

### WARNING-5 - Invalid persisted source ids can break summarization instead of falling back

Personas: Saboteur, New Hire.

Evidence:

- `public/controller/start-app.js:28` and `public/controller/start-app.js:29` trust `localStorage` source ids.
- `public/controller/runtime.js:273` validates the transcription source against the catalog.
- There is no equivalent catalog-existence check for summarization in `public/controller/runtime.js:279` through `public/controller/runtime.js:292`.
- `public/services/registry.js:23` throws for unsupported summarization sources.

Impact:

If `localStorage.summarizationSource` is stale or corrupted, startup can leave an unsupported source selected when no provider key triggers a fallback. The first summary attempt then fails with "Unsupported summarization source" instead of returning to a known-good default.

Fix direction:

Add a summarization-source existence check parallel to `ensureSelectedTranscriptionSourceExists()`. Test unknown persisted values with no keys, OpenAI-only, Claude-only, and both-key configurations.

### WARNING-6 - The OpenAI missing warning is misleading when Claude summaries are available

Personas: New Hire, Saboteur.

Evidence:

- `public/controller/runtime.js:268` through `public/controller/runtime.js:270` always says "OpenAI transcription and summaries are off" when OpenAI is missing.
- `public/controller/runtime.js:279` through `public/controller/runtime.js:292` can select Claude when Anthropic is configured.

Impact:

When `ANTHROPIC_API_KEY` is present but `OPENAI_API_KEY` is missing, the UI can correctly use Claude for summaries while the warning says summaries are off. Under pressure, the helper may stop using a working summary path because the status text is wrong.

Fix direction:

Make the warning provider-specific: OpenAI transcription is off; OpenAI summaries are off; Claude summaries are available when Anthropic is configured.

### WARNING-7 - Browser speech recognition can restart forever after repeated errors

Personas: Saboteur.

Evidence:

- `public/services/transcription/browser.js:46` reports recognition errors but does not change `listening`.
- `public/services/transcription/browser.js:47` through `public/services/transcription/browser.js:55` automatically restarts recognition whenever `onend` fires while `listening` is true.
- `public/services/transcription/browser.js:53` swallows restart exceptions.

Impact:

Permission loss, browser API failures, or unsupported runtime errors can create repeated status churn or an invisible dead loop. The helper sees generic errors but the app still believes it is listening.

Fix direction:

Classify fatal speech-recognition errors, stop listening on fatal errors, and surface a clear "browser transcription stopped" status. Add a driver-level test with a fake SpeechRecognition implementation.

### WARNING-8 - Automated tests do not exercise the actual Express API surface

Personas: New Hire, Security Auditor.

Evidence:

- `docs/06-test-strategy.md:19` lists route tests for `/api/config`, `/api/transcribe`, and `/api/summarize` as future work.
- `server.js` creates and listens to the app at module load time, which makes route tests awkward.
- Existing server coverage only tests `server/summarization.js`, not Express parsing, status codes, or route-level error behavior.

Impact:

The most security-relevant code path, the local provider proxy, is not under route tests. Current tests would not catch JSON parse failures, missing-key status differences, malformed body handling, oversized payload behavior, or accidental route response shape drift.

Fix direction:

Split Express app creation from listening, export an app factory, and add route tests using a lightweight HTTP test harness or `node:http` against an ephemeral local port.

## Notes

### NOTE-1 - Docs/spec drift creates avoidable confusion

Evidence:

- `docs/01-scope.md:18` still says OpenAI handles transcription and summarization, but Claude summarization is now implemented.
- `docs/02-system-architecture.md:69` and `docs/02-system-architecture.md:70` both use `INV-7`.
- `AGENTS.md:3` says specs are source of truth, so drift matters even when runtime behavior is correct.

Fix direction:

Update scope to mention Claude summaries and renumber the duplicated invariant.

### NOTE-2 - Unused PNG icon assets remain after switching CSS masks back to SVG

Evidence:

- `public/style.css:245` through `public/style.css:263` now references SVG masks.
- `public/assets/icons/*.png` still exists in the repo.

Impact:

This is not a runtime bug, but it leaves two parallel asset formats and invites future confusion about which one is canonical.

Fix direction:

Remove the unused PNGs or document why both formats are intentionally kept.

### NOTE-3 - The display CSS can still clip pathological long lines

Evidence:

- `public/style.css:28` hides body overflow.
- `.line` at `public/style.css:52` through `public/style.css:60` has no overflow wrapping fallback for long unbroken text.

Impact:

Most generated lines are short, but manual entries or hymn/reference strings with long unbroken tokens can clip on the TV display. This matters for a low-vision viewer because clipped text is harder to recover from than merely wrapping.

Fix direction:

Add a narrow overflow strategy for `.line` and include a manual display test with a long unbroken token.

## Ordered Fix Plan

### Workload 1 - Restore operator trust in pause/listening controls

Goal:

Make Pause AI and mode changes do exactly what the helper expects during live use.

Tasks:

1. Add driver-level tests for browser pause/stop and OpenAI queued upload cancellation.
2. Change pause behavior to stop the active transcription driver for every source.
3. Add cancellation or pre-send session checks to OpenAI chunk uploads so queued chunks do not hit `/api/transcribe` after stop/pause.
4. Propagate `setMode()` to the active driver when mode changes.
5. Add integration-style runtime tests for pause/resume and mode switching while listening.

Acceptance:

- Pausing stops browser and OpenAI transcription work.
- Resuming requires an explicit restart or resumes in a clearly tested way.
- OpenAI chunks queued before pause do not send after pause.
- Mode changes affect the next OpenAI chunk.

### Workload 2 - Harden API and provider boundaries

Goal:

Make local API errors predictable and safe for an operator under pressure.

Tasks:

1. Split `server.js` into app creation and listen startup so route tests can import the app without binding a port.
2. Add JSON error middleware for parse and body-size failures.
3. Validate `/api/summarize` source/mode/visibleLines shape and `/api/transcribe` audio/mime basics before provider calls.
4. Add safe JSON/text parsing helpers for client wrappers and Claude server fetch.
5. Decide and document behavior for non-loopback `HOST` values.

Acceptance:

- All `/api/*` errors return compact JSON.
- Malformed JSON and oversized payloads are covered by tests.
- Provider non-JSON failures produce a useful status, not a raw parse error.
- LAN exposure is either blocked by default or explicitly guarded.

### Workload 3 - Clean contracts, docs, and coverage gaps

Goal:

Remove drift and make future provider additions easier to reason about.

Tasks:

1. Add summarization-source existence fallback for stale `localStorage`.
2. Make missing-key warnings accurately describe OpenAI and Claude separately.
3. Update `docs/01-scope.md` and duplicate invariant numbering.
4. Decide whether to remove unused PNG icon assets.
5. Add or update tests for all changed contracts.

Acceptance:

- Specs match implemented OpenAI/Claude behavior.
- Unknown persisted sources recover to available defaults.
- Warning text matches the actual configured providers.
- Asset format policy is clear.
