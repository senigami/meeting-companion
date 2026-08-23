# Pre-Live Checklist

Technical readiness before a live meeting, distinct from [Sunday-Runbook](Sunday-Runbook.md) (how
to operate it once it's up). Run this before the helper touches the app, ideally the night before or
at least 20 minutes ahead.

## 1. Environment

- [ ] `.env` has a real `OPENAI_API_KEY`. Confirm at `/api/config` → `providerKeys.openai.configured`.
- [ ] Decide about Claude. If `ANTHROPIC_API_KEY` isn't set, Claude summaries stay off and the app
      falls back to OpenAI, which is safe but not a silent choice, know it going in.
- [ ] `npm test` passes clean before tonight's meeting. Any red test is a stop, not a maybe.
- [ ] Start the real app (`npm start`, not the keyless launch config) and load it once before the
      meeting starts. Confirm no console errors and no server errors in the terminal.

## 2. Pick a transcription source on purpose, not by default

The default is **Browser** (the laptop's built-in speech engine). Two known gaps only show up with
it:

- [ ] **Any non-English speech expected tonight?** Browser transcription can render it as
      confident-looking English gibberish with no error shown (#130). If yes, prefer **OpenAI**
      transcription instead, or know to watch for nonsense text and use a manual line to correct it.
- [ ] **Using a non-default microphone or audio interface?** Browser transcription can silently keep
      listening to the wrong device (#37). Confirm the right input is selected before starting, and
      re-check if the sound seems off.

## 3. Know the two things that already went wrong once

- [ ] **Mic gain.** The mic test will flag "too hot" or "too noisy" but won't tell you the fix. This
      already happened once (2026-08-14, an overdriven USB preamp) — the fix is turning the input
      gain down on the interface itself, not in the app.
- [ ] **Dense content under a tight word budget.** Summarization can drop real content (a name, the
      point of a story) when speech is dense relative to the words-per-card setting, confirmed twice
      on a real recording (#128). If tonight's content is unusually dense, widen the word budget or
      lean on manual lines for anything that must not be lost.

## 4. During the meeting

- [ ] Don't change transcription source, provider, or mic device mid-meeting unless something is
      actually broken. Nothing currently warns that a mid-meeting change silently altered behavior
      (#62).
- [ ] If the browser window gets resized or the laptop gets undocked/redocked, and the display
      suddenly looks frozen behind a dark overlay, press `Escape` (#84) — it isn't actually stuck.
- [ ] Manual line + `Show now` always works regardless of what else is happening. When in doubt, type
      it.

## 5. If something looks wrong

- [ ] `Undo` removes the last card.
- [ ] `Pause AI` stops new summaries without stopping the display.
- [ ] A stuck or wrong card can be deleted from its own per-card control.
- [ ] Worst case: keep going with manual lines only. The app is designed to stay usable with zero AI.

## Known, accepted, not blocking tonight

Everything else in the open-issue tracker (18 items as of 2026-08-23) is either already exercised on
real hardware, cosmetic, or an edge case that needs an unusual pattern to trigger. None of it changes
this checklist. Re-triage before a meeting if the app has changed meaningfully since.
