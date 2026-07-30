# ADR-0004: Record transcript and summary text locally, for tuning

> **TL;DR:** Supersedes part of [ADR-0003](0003-no-audio-storage-by-default.md). Transcript text and summary output ARE now written to a local, gitignored, timestamped file so the two can be correlated and the summarizer can be measured instead of guessed at. Audio itself is still never stored, nothing leaves the machine, and this remains a debugging instrument rather than an archive.

## Status

Accepted. Supersedes [ADR-0003](0003-no-audio-storage-by-default.md) on transcript text only; ADR-0003 continues to govern audio, which is still never persisted.

## Date

2026-07-29

## Context

ADR-0003 kept transcript text ephemeral, and closed with the line that "future archival features would need an explicit design decision." This is that decision, so it is the case ADR-0003 anticipated rather than a reversal of its reasoning.

What forced it is that we cannot currently tell whether the summarizer is doing a good job. Three separate quality defects this week were found by a harness and missed by watching the screen: a clamp mangling lines mid-word, which was initially misattributed to the model and declared unreproducible; an invented hymn number, which is the worst failure class this app has (INV-13); and a sentence splitter breaking one response across two cards. Meanwhile the fix that moved length enforcement into the prompt shipped in `909fe1e` as a **prediction with no evidence behind it**, because there is no record of what the model was sent or what it returned.

Every test so far has used either the scripted demo corpus, which cannot surprise us, or a live meeting that cannot be replayed. So the pipeline is tuned by impression. A timestamped record of both sides makes it measurable, and makes a real meeting replayable against a prompt change.

Steve overrode ADR-0003 explicitly and knowingly for this purpose, having been shown what the content is.

## Decision

Write both sides of the pipeline to one local append-only newline-delimited JSON file per session:

- incoming transcription chunks, with capture timestamp and the mode tag applied at capture;
- outgoing summarization, with what was sent, what returned, the provider, whether previous-block context was present, latency, success or a redacted error, and whether the length backstop had to shorten the line.

The two sides are correlated by chunk id within the single file. One file rather than two, because correlation is the entire purpose and two unrelated logs would not deliver it.

Constraints, all load-bearing:

- **Text only.** Audio is still never written. ADR-0003 stands on that point.
- **Local only.** Written by the local server to a gitignored directory. No network egress, no cloud, no database. INV-12 (provider keys in memory only) is untouched.
- **Never in the repo.** The directory is gitignored, and was gitignored before any code could write to it. This content is a record of what is said at a church service, which in practice means named individuals discussing illness, bereavement, and personal prayer requests.
- **Never damages a meeting.** A failed write, a full disk, a rejected request: all degrade to not-recording and tell the operator once. Recording must never throw into the transcription or summarize path.
- **Never records invisibly.** Recording is on by default, because a default-off tuning instrument collects nothing unless someone remembers to arm it, which defeats the purpose. That is only acceptable alongside an indicator that is truthful about whether writes are actually landing, not merely whether recording was requested (INV-10).
- **Not a user feature.** It is not human-readable by requirement, has no viewer, and is not exposed to the person reading the wall.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Keep ADR-0003 unchanged | Leaves summary quality unmeasurable. We would keep tuning prompts on impression, which has already produced three defects that a recorded corpus would have caught immediately. |
| A database | Steve and I agreed it earns its place only when something needs to query across many meetings. Nothing does. It also adds a service that must be running for a meeting to work. |
| Pretty-printed JSON array | Does not survive a crash mid-meeting, because the closing bracket never gets written. Append-only NDJSON does. |
| Two separate files, one per side | Correlating them afterward means reconstructing timing that we already know at write time. The correlation is the requirement, so it belongs in the format. |
| Store audio for replay | Explicitly out of scope, and still governed by ADR-0003. Steve was specific that this is the text of the audio, not the audio. |
| Default recording off | Safer, and rejected on purpose: the instrument exists to accumulate real data, and one forgotten toggle means a meeting's worth of evidence is gone and unrepeatable. Mitigated by the visible indicator instead. |

## Consequences

The summarizer becomes measurable. Specifically, the questions we currently cannot answer get answers: how often a returned line exceeds the word limit, whether verbatim names, dates, hymn numbers, scripture references and assignments survive, and how often the length backstop fires. That last number is the direct test of `909fe1e`.

The cost is that a file of genuinely sensitive text now exists on the laptop. It is gitignored and local, but it is real, and it is not encrypted. Anyone with access to the machine has access to it. There is deliberately no retention or cleanup policy yet, which is the honest state rather than a claim of one, and the next open question this ADR leaves behind.

Two things are consciously deferred rather than solved: a replay transcription source that reads a session file back at its original timing (backlog item 2), and any decision about how long these files should live.

## Spec docs affected

- [docs/01-scope.md](../01-scope.md)
- [docs/03-data-model.md](../03-data-model.md)
- [docs/07-ai-and-privacy.md](../07-ai-and-privacy.md)
- [docs/backlog.md](../backlog.md) — items 2 and 3 originate here
