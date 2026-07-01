# Implementation Map — Desktop Operator Redesign

> **TL;DR:** Split the styling into two token tiers (frozen TV canvas vs restyled chrome), restyle chrome surfaces/controls to macOS patterns, add a collapse module beside the existing resize module, route all status through one dual-write pipeline, and harden the three network call sites. The JS DOM contract (ids/classes the controller queries) and the pinned CSS test contract are the two things executors most easily break — every task lists which pins it may touch.

## Big Picture

One static page: `#root .meetingShell` grid = TV display panel (`#display`, left) + operator rail (`#panel`, right, width `--operator-rail-width`) + manual bar (bottom) + `<dialog id="settingsPanel">` + `#viewPanel` drawer. Controller modules (`public/controller/`) wire DOM by id/class; services (`public/services/`) hold provider drivers; Express (`server.js`) proxies OpenAI/Anthropic with a server-side key store. Tests are `node --test` with hand-rolled DOM fakes (`test/public/controller/runtime-test-helpers.js`) and a regex-pinning CSS contract test (`test/public/style.test.js`).

The approach: (W1) introduce a `--chrome-*` token tier and repoint operator CSS to it with near-neutral values; (W2, parallel) reliability hardening in services/runtime; (W3) restyle the chrome tier to macOS values and patterns file-by-file; (W4) add `rail-collapse.js`; (W5) safety/workflow/status/pre-flight features on the settled markup; (W6) docs + final verification.

## The Parts

| Part | Responsibility | Lives in | Status |
| --- | --- | --- | --- |
| P1 — TV canvas | Large-print transcript card stack on the TV. FROZEN except invariant I1 tweaks. | `layout.css` (`.display-panel`, `.transcript-*`), `view.js renderDisplay` | frozen |
| P2 — Chrome token tier | `--chrome-*` colors/radii/spacing/type: single source for all operator chrome. | `base.css :root` | new |
| P3 — Rail chrome | Rail surfaces, header (`.railTop`/`.railActions`), quick controls, mode group, transcript disclosure. | `index.html:24-137`, `controls.css`, `layout.css` rail rules | changed |
| P4 — Manual bar | Always-visible manual line entry (`#manualInput`, `#addManual`). | `index.html:139-145`, `controls.css` | restyled only |
| P5 — Settings modal | `<dialog id="settingsPanel">` → macOS System-Settings-style master-detail, plain-language sections. | `index.html:147-263`, `settings.css`, `view.js setSettingsOpen` | restructured |
| P6 — View drawer + sliders | Font size / margins / interval range fields. | `index.html:265-302`, `controls.css`, `settings.css` | restyled only |
| P7 — Rail collapse | New module: toggle to 64px icon strip, persistence, resize interplay. | `public/controller/rail-collapse.js` (new), `start-app.js`, `layout.css`, `controls.css` | new |
| P8 — Safety layer | Two-stage Clear, snapshot undo, shortcut changes, undo feedback, `/` focus hotkey. | `runtime.js`, `start-app.js`, `view.js` | changed |
| P9 — Status pipeline | `updateStatus(ctx, text)` (view.js:21) → dual-write: rail indicator (new) + diagnostics `#status`; alert badge escalation. | `view.js`, `runtime.js`, `index.html` railTop | changed |
| P10 — Provider reliability | Timeouts, failure counter/backoff, speech-restart visibility, dead-param removal. | `services/transcription/{browser,openai}.js`, `services/summarization/{openai,claude}.js`, `runtime.js` | changed |
| P11 — Ready check | Lean pre-flight rows: mic / AI key / display sample. | `index.html`, `view.js`, `runtime.js` | new |
| P12 — Test suite | Mirrored `test/`; pinned CSS contract; DOM-fake harness. | `test/public/**` | extended |
| P13 — Docs | `docs/01-scope.md`, `02-system-architecture.md`, others as touched. | `docs/` | reconciled last |

## The Connections

| From | To | Connection | What must stay true |
| --- | --- | --- | --- |
| P2 | P3–P6 | Chrome CSS consumes only `--chrome-*` tokens after W1. | No new literal rgba/hex in chrome rules (I4). TV tokens (`--bg`, `--text`, `--panel`, `--accent`, `--muted`, `--font-size`) untouched. |
| P3–P6 | controller JS | Controller queries ids/classes (I2 list). | Restyle via CSS only; renames/restructure ONLY in tasks that update JS + tests together (task 010). |
| P7 | rail-resize.js | Both write `--operator-rail-width` on `document.documentElement`. | Collapse sets `html.is-rail-collapsed` overriding width to 64px via CSS; resize handle disabled while collapsed; expanded width restored from `ctx.state`/localStorage on expand. Do not modify rail-resize.js logic (I5, I6). |
| P7 | P1 | `.meetingShell` grid track reads `var(--operator-rail-width)`. | Collapsing must genuinely narrow the grid track so the TV canvas widens (I6). |
| P8 | P9 | Clear/undo/pause announce via `updateStatus`. | One write point; severity via options arg (I7). |
| P10 | P9 | Failure counters escalate to alert badge + rail indicator "Problem". | Escalation resets on first success (I7). |
| P11 | P10 | Ready check reuses `browserSpeechAvailable()` (view.js:611), provider readiness from `loadRuntimeConfig`/`testProviderKey` (runtime.js:359). | No new endpoints; reuse existing calls. |
| P12 | all CSS tasks | `style.test.js` regex-pins selectors/values (inventory below). | Each task updates ONLY the pins it intentionally changes; never rewrite the file wholesale (I3). |
| start-app.js | P7, P8, P11 | `bindEvents()` (start-app.js:138) is the single wiring point; init order at lines 124–147. | New bindings register there; keyboard changes stay inside `bindKeyboardShortcuts` (start-app.js:322-366) preserving the `isTypingTarget` guard (I8). |

## Invariants (tasks reference these tags)

- **I1 — TV canvas frozen.** No changes to `.display-panel`/`.displayPanel`, `.transcript-viewport/-stack/-item/-text` rules, the `--font-size`/`--display-margin` pipeline, `role="log" aria-live="polite"`, or card animations — EXCEPT the two sanctioned tweaks: inactive-card opacity `.62 → .8` (task 016) and never tightening `letter-spacing` below the current `-0.045em`.
- **I2 — JS DOM contract.** Ids/classes queried by the controller must survive: `#panel #display #transcriptViewport #transcriptStack #railResizeHandle #viewButton #settingsButton #settingsAlertBadge #startListening #stopListening #pauseAi #pauseAiLabel #undo #clear #fullscreen .mode [data-mode] #railTranscript #manualBar #manualInput #addManual #settingsPanel #closeSettings #settingsBody #alertsSection #apiWarning #summaryInterval(+Value) provider option ids (#transcriptionBrowser #transcriptionOpenAi #summaryOpenAi #summaryClaude #serviceRegistration*) #status #pasteTranscript #summarizeOnce #liveTranscript #viewPanel #closeViewPanel #fontSize(+Value,+VisualThumb) #displayMargin(+Value,+VisualThumb) #settingsBackdrop`.
- **I3 — Pinned CSS test contract.** `test/public/style.test.js` pins (highlights): selectors for `.meetingShell .operatorRail .railTop .railActions .railBody .railButton .railResizeHandle .manualBar .settingsOverlay .settingsModal .settingsBody .settingsGrid .settingsCard .iconButton`; literals `--operator-rail-width: 220px`, `.meetingShell` grid-template-columns clamp expression, `.railButton { min-height: 48px; }`, `.modeGrid { grid-template-columns: 1fr; }`, `.settingsGrid { grid-template-columns: repeat(2, minmax(0,1fr)); }`, `.settingsOverlay.settingsModal::backdrop { backdrop-filter: blur(18px); }`, slider `--slider-points` counts, media queries at 900px/640px, margin-guide + `html.is-adjusting-display-margin` rules, `.transcript-text { font-size: var(--font-size); }`. A task that changes a pinned value updates that assertion in the same task, with intent stated.
- **I4 — Token discipline.** After W1, operator-chrome rules use `var(--chrome-*)` exclusively for color/radius/spacing/focus; TV rules keep TV tokens. Chrome target values (W3): bg `#1e1e1e`, elevated `#262626`, control `#323234`, control-hover `#3a3a3c`, separator `rgba(255,255,255,0.08)`, text `rgba(255,255,255,0.92)`, text-secondary `rgba(255,255,255,0.55)`, accent `#0A84FF`, radius sm/md/lg `6/10/12px`, spacing `4/8/12/16/24px`, focus `2px solid` accent, `1px` offset. Type scale: 11px/600/uppercase section labels; 12px/500 rail labels; 13px control text; 15–17px modal titles. No `backdrop-filter`, no gradients, no glow shadows in chrome.
- **I5 — Persistence idiom.** localStorage via the exact try/catch pattern of `rail-resize.js:39-45`. Keys: `operatorRailWidth` (existing, untouched), `operatorRailCollapsed` (new, `'true'`/`'false'`, default expanded).
- **I6 — Collapse mechanics.** Collapsed = `html.is-rail-collapsed` (matches `html.is-resizing-rail` convention) → CSS sets `--operator-rail-width: 64px` (or overrides the grid track); `.buttonLabel`, section labels, brand text, transcript disclosure hide via collapsed-state selectors; icons + tooltips remain; toggle button itself always visible in `.railActions`; modes/undo/pause remain one click; transitions ≤250ms honoring `prefers-reduced-motion` (I11).
- **I7 — Status pipeline.** `updateStatus(ctx, text, { level } = {})` remains the single write point; it feeds both the diagnostics `#status` node and the new rail indicator. Levels: `listening | paused | manual | problem` for the indicator word/dot; indicator animates only on state change. Alert badge (`#settingsAlertBadge` / `#alertsSection`) is the escalation surface for persistent problems.
- **I8 — Shortcuts.** Keep `U`, `P`, `1–4`, `Escape`, `Ctrl/Cmd+Enter`; REMOVE bare `C`; ADD `/` (focus `#manualInput`, preventDefault, no-op when `isTypingTarget`). The `isTypingTarget` guard and Escape's close-priority order are preserved.
- **I9 — Transcript item shape.** Items are plain objects in `ctx.state.transcriptItems`; `renderDisplay(ctx)` re-renders from the array. Clear snapshot = store the previous array (reference), restore = reassign + re-render. Undo-after-clear restores the whole snapshot once.
- **I10 — No build step.** New code is plain ESM under `public/`; wired in `start-app.js`; importable by tests via relative paths.
- **I11 — Reduced motion.** Every new transition/animation is disabled under `@media (prefers-reduced-motion: reduce)` (pattern exists in `base.css`).
- **I12 — Targets.** Interactive chrome targets keep ≥44px effective size (`.railButton` min-height 48px stays pinned).
- **I13 — Reliability shape.** Timeouts: `AbortController` + `setTimeout` ~12s on `/api/transcribe`, `/api/summarize`, `/api/provider/test` fetches; injectable timer fns for tests (harness already passes `setTimeoutFn`). Failure policy: 3 consecutive summarize failures → alert + one-step interval backoff (double once, cap at 2× configured), reset on success. No retry libraries.

## Risks & open questions

- **R1:** `test/public/helper-panel-structure.test.js` and `app-bootstrap.test.js` pin settings-modal DOM — the master-detail restructure (task 010) is the highest-blast-radius task; it must run the FULL suite and update those tests deliberately.
- **R2:** Repointing ~50 rgba literals to ~10 tokens (tasks 002–003) is "near-neutral", not pixel-identical; acceptable, but do not silently change layout values while retokening.
- **R3:** The segmented mode group must not rename `.mode`/`data-mode` (JS binds them) nor break the pinned `.modeGrid { grid-template-columns: 1fr; }` — it stays a vertical single-column group with a unified container look.
- **R4:** Responsive breakpoints (900px row-rail, 640px stack) interact with the collapsed state — collapsed mode is a desktop feature; at ≤900px the collapse toggle hides and the rail behaves as today.
- **R5:** Mic "check" in Ready check is capability + permission signal only (no audio level meter — out of scope).
