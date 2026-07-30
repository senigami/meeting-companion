# Backlog

Ideas captured but not started. Each entry below is written to become one GitHub issue: a title, why it
matters, what "done" looks like, and what it depends on. When the GitHub project exists, these get pasted
across and this file becomes a pointer rather than the record.

This is not a spec. Nothing here is agreed behavior — `docs/00-index.md` and its ADRs remain the
authority on what the app actually does. An entry graduating out of this file means an ADR was written or
amended, not just that someone built it.

---

## 1. Microphone source selection and a live level meter

**Status: shipped 2026-07-30, unverified against real hardware.** Device picker and a Test button with a
live meter, both in the existing Transcription settings section. No library was added: `enumerateDevices`
plus a `deviceId` constraint is the standard browser path.

One design note worth keeping, because it is counterintuitive. The meter does NOT read the conditioner's
`readLevels()`, even though that method exists and looks like exactly the right thing to call. The
conditioner ships bypassed (`audioConditioningEnabled: false`), so `connect()` returns the raw stream on
its first branch and never builds the AnalyserNode, which means `readLevels()` reports nothing in the
default configuration. `createMicProbe` therefore owns its own getUserMedia and AudioContext, independent
of both the conditioner and whether listening is running.

**What is still open: the actual reason this was built.** The point was to unblock the in-room hardware
test, and that has not happened. `createMicProbe` has never measured real audio, real device labels have
never been seen, and `OverconstrainedError` shapes across browsers are exercised only against fakes.

**Why:** Audio conditioning shipped switched off (commit `909fe1e`) because it has never met real
hardware, and there is no way to turn it on or check it during a meeting. Right now nine audio settings
exist with no UI at all, reachable only by hand-editing localStorage. An operator setting up in the
chapel cannot pick which microphone to use or see whether the signal is usable before the meeting starts.

**Steve's framing:** Google Meet does this in the browser — source selection, a test, live levels — so it
is clearly doable, and we should not rewrite everything to get it.

**Finding that shrinks this a lot: no library is needed, and half of it is already written.**
`public/services/audio-processing.js#readLevels()` already returns
`{ rms_dbfs, peak_dbfs, gain_db, clipCount, classification, speaking }` where classification is
`IDLE|LOW|GOOD|HIGH|CLIPPING`, driven by an `AnalyserNode` polled at ~20Hz. **Nothing consumes it.** So
this is a rendering task, not an audio task. Device selection is `navigator.mediaDevices.enumerateDevices()`
filtered to `kind === 'audioinput'`, then passing `deviceId` in the `getUserMedia` constraints. Both are
plain browser APIs and are exactly what Meet uses.

Libraries considered and rejected: `wavesurfer.js` (waveform display, far more than a meter),
peak-meter packages (wrap the AnalyserNode work we already own), `standardized-audio-context` (a
cross-browser polyfill we don't need for a known-Chrome deployment). Adding any of them would mean a
dependency wrapping existing code.

**Done looks like:** a Settings section under Transcription that lists input devices, lets one be chosen
and remembered, shows a live meter with the existing classification while capture is running, and exposes
the conditioning on/off switch plus preset. The operator can tell before the meeting whether the mic is
too quiet, clipping, or dead.

**Depends on:** nothing. **Blocks:** turning conditioning on at all, and therefore the in-room hardware
test that everything else about the audio work is waiting behind.

**Note:** the browser transcription source cannot be conditioned or metered — the Web Speech API opens the
microphone itself and accepts no audio input. That asymmetry must be stated honestly in the UI rather than
showing controls that silently do nothing (INV-10).

---

## 2. Record the incoming transcription text with timestamps

**Status: shipped 2026-07-30 (ADR-0004), except the replay source.** The recording half is built and
tested. What is explicitly NOT built is the part that makes this a *test* source: a transcription driver
that reads a session file back at its original timing and re-drives the live pipeline from it.
`scripts/replay-recording.js` only reads and correlates. That remainder is the real issue to open.

**Why:** Every test of the summarization pipeline so far has used either the scripted demo corpus or a
live meeting nobody can replay. A timestamped log of real incoming transcription text would give a real
corpus that can be replayed deterministically against prompt changes.

**Steve's framing, and an explicit reversal:** the standing instruction was that we do not need to keep
the text. That is still technically true, but keeping it is useful — record the text of the audio (not the
audio itself), with timestamps, so a real session can be played back as a test source.

**This reverses a recorded decision and cannot be built without amending it.**
[ADR-0003](decisions/0003-no-audio-storage-by-default.md) and INV-8/INV-12 establish no transcript or
audio persistence by default. A superseding ADR is required, stating what is stored, where, for how long,
and how it is turned off. Do not implement ahead of that ADR.

**The part that needs care, not just plumbing:** this content is not neutral. The demo corpus alone
models funeral announcements, named individuals, and personal prayer requests, because that is what
actually gets said. A transcript file is a record of named real people discussing illness, death, and
private matters, sitting on a church laptop. So: opt-in per session and never a default, an unmistakable
recording indicator while it is on, a local file under a path the operator chooses, no network egress, and
a stated retention expectation. Recording audio itself stays out of scope — Steve was explicit that it is
the text, not the audio.

**Done looks like:** an explicit "record this session" control, a timestamped append-only local file of
incoming transcription chunks (including their mode tag, since mode is captured per chunk), and a replay
transcription source that reads such a file back at its original timing so a recorded meeting can drive
the pipeline exactly as it happened.

**Depends on:** a superseding ADR. **Enables:** items 3 and 4.

---

## 3. Record the summary output with timestamps, for post-meeting analysis

**Status: shipped 2026-07-30 (ADR-0004).** Both sides land in one file, correlated by chunk id, with
`wasShortened` as the measurement that settles whether the prompt-side length fix in `909fe1e` actually
fires. Nothing has been recorded from a real meeting or a live provider yet, so the instrument exists but
has measured nothing. Two questions it deliberately left open: no retention or cleanup policy, and the
file is not encrypted.

**Why:** We have twice been wrong about summary quality in ways only a side-by-side would have caught —
a mid-word clamp mistaken for a model artifact, and an invented hymn number that a paired harness found
and eyeballing did not. A durable record of source text against what the summarizer returned, both
timestamped, turns prompt tuning from impression into measurement.

**Steve's framing:** output the translations to a file with timestamps, then do a post-analysis to see how
they matched the source text and how the prompt might be tweaked.

**Done looks like:** a paired record — the transcript text sent, the mode, the previous-block context, and
the returned line, all timestamped — plus an offline analysis script reporting the things we currently
guess at: how often a returned line exceeded the word limit, whether verbatim entities (names, dates, hymn
numbers, scripture references, assignments) survived, and how often `shortenToLimit` had to fire. That last
number is the direct measurement of whether the prompt-side length fix in `909fe1e` actually worked, which
is currently a prediction with no evidence behind it.

**Open question Steve raised and did not settle:** file, or database, or stream. Recommendation — start
with newline-delimited JSON appended to a local file. It survives a crash mid-meeting, needs no service to
be running, is trivially greppable, and can be loaded into anything later. A database is the right answer
only once something needs to query across many meetings, and nothing does yet.

**Depends on:** the same superseding ADR as item 2 (same privacy question, same content).

---

## 4. Multiple viewing clients over WebSockets

**Why:** The transcript currently renders on one screen. Anyone else in the room who wants to follow it
has no way to.

**Steve's framing:** a version of the page that simply watches the transcription, so several people could
tune in and share the experience.

**Done looks like:** a read-only viewer page that receives transcript cards over a WebSocket and renders
them with the same readability contract as the main display, with its own font size and margin controls
so each viewer can tune to their own eyesight without affecting the wall.

**This is the entry on this list with the largest blast radius, and it needs a decision before design.**
It changes the app from a local single-machine tool into a network service. Everything the privacy
posture currently gets for free — no persistence, no egress, one machine — is provided by the app not
listening on a network in a meaningful way. Once it broadcasts, anyone who can reach the port can read a
transcript of a private meeting, including the funeral and prayer-request content described in item 2.
So this needs, at minimum: a deliberate choice about who can connect, a decision on whether the viewer
count is shown to the operator (it should be — an operator should know who is watching), and an ADR
covering the change in exposure. Treat the LAN as untrusted; a church guest network usually is.

**Depends on:** the exposure ADR. Independent of items 1–3 technically, but should not be built first —
it is the item most likely to need a decision reversed later.

---

## 5. Known latent defects worth their own issues

Small, recorded, none currently reachable in a way that harms a meeting. Grouped here so they are not
lost, and each should become its own issue rather than being fixed in a bundle.

- ~~**`shortenToLimit` returns unbounded output when the input contains no whitespace at all.**~~ Fixed
  2026-07-30: an unbreakable word may now overshoot the limit by up to `UNBREAKABLE_WORD_FACTOR` (2x)
  and is hard-cut past that, on the reasoning that a token orders of magnitude over the limit is not a
  long word but malformed output, and is owed no courtesy. Covered by `test/public/services/text.test.js`.
- ~~**`shortenToLimit` returns an empty string when `lastSpace === 0`.**~~ Fixed 2026-07-30, and the
  proposed one-character fix (`lastSpace <= 0`) turned out to be insufficient on its own: a whitespace
  *run* at the start puts the last-whole-word slice inside that run, which no guard on the `=== 0` case
  catches. Leading whitespace is now stripped at the top of the function instead, where it cannot corrupt
  any of the indices the three-tier search reasons about. The test that caught this is worth keeping.
- ~~**`takeOldestModeRun` can throw outside the `try` in `summarizeCurrentText`.**~~ Fixed 2026-07-30.
  Narrower than recorded here — it runs before `summarizeInFlight` is set, so it could never wedge the
  loop — but worse in one respect: the only caller is a fire-and-forget `setInterval` tick, so the throw
  surfaced as nothing at all, leaving a rail reading "Listening" while no card would ever be produced
  again. The bucket read is now wrapped and reports through the same failure path a dead provider uses.
  The bucket is deliberately not drained on that path: those words are the only copy.
- **Recurring audio diagnostics have no operator surface.** They currently go to the console only, which
  was the right call over spamming the rail every ~500ms, but it means a degrading microphone reports
  itself to nobody watching. Wants a throttled surface on the status rail. Named handoff to the
  status-honesty seat, not yet designed.
- **`previousBlock` has never been observed carrying live** across consecutive same-mode ticks. The
  wiring is verified end to end and the absent path is verified byte-identical, but the feature working in
  a real run has never been seen, because the demo summarizer picks one whole sentence per tick and so
  never exercises cross-block recovery. Needs a live provider key and one real session — and item 2's
  recorded corpus would make it repeatable.
