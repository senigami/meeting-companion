# ADR-0004: Record transcript and summary text locally, for tuning

> **TL;DR:** Supersedes part of [ADR-0003](0003-no-audio-storage-by-default.md). Transcript text and summary output ARE now written to a local, gitignored, timestamped file so the two can be correlated and the summarizer can be measured instead of guessed at. Audio itself is still never stored. The transcript is not sensitive (the meeting is public and already streamed), so this is a disposable debugging instrument: a file is kept until it has been used for tuning, then deleted.

## Status

Accepted. Supersedes [ADR-0003](0003-no-audio-storage-by-default.md) on transcript text only; ADR-0003 continues to govern audio, which is still never persisted.

**Extended 2026-08-25** by the addendum below, which brings the display side into scope: what actually reached the reader, and what the operator edited or took down. Same constraints, none relaxed. Read the addendum before answering any question about what this app is authorized to write to disk, because the decision below no longer lists every record type on its own.

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
- **Never in the repo.** The directory is gitignored, and was gitignored before any code could write to it. The reason is repo hygiene, not secrecy: committing recordings would bloat the repo and make every diff noisy.
- **Discarded once used.** A recording exists to answer a question about the pipeline. Once it has, it is deleted. See "Sensitivity and retention" below.
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
| Default recording off | Safer, and rejected on purpose: a meeting happens once, so one forgotten toggle means a week's worth of evidence is gone and cannot be recreated. Mitigated by the visible indicator instead. |
| Age-based retention (e.g. delete after 30 days) | Deletes on the wrong signal. A recording already used should go the same day, and one not yet examined should survive well past a month, so age correlates poorly with whether the file still has value. It also fails silently: a busy stretch and the evidence is gone before anyone looked at it. |
| Keep every recording indefinitely as a regression corpus | Tempting, since comparing a prompt change needs a before-and-after. Rejected because a recording is tied to the prompt that produced it, so an old file measures a pipeline that no longer exists and quietly corrupts later evaluations. Re-record against the current prompt instead of trusting an archive. |
| Automate deletion once "used" | Cannot be detected. Whether a recording's value is spent is a human judgement about whether a question got answered, and an automated guess that is wrong destroys something unrecreatable. Manual deletion is the correct amount of machinery. |

## Consequences

The summarizer becomes measurable. Specifically, the questions we currently cannot answer get answers: how often a returned line exceeds the word limit, whether verbatim names, dates, hymn numbers, scripture references and assignments survive, and how often the length backstop fires. That last number is the direct test of `909fe1e`.

The cost is that answering those questions is now a deliberate act rather than a by-product. Recordings do not accumulate into a corpus (see "Sensitivity and retention"), so a question not asked while a recording still exists is a question that needs another meeting to answer.

## Sensitivity and retention

**The transcript is not sensitive data.** The meeting is public and is already streamed over Zoom, so the words in a recording have already been heard by everyone present and everyone watching remotely. Nothing about this file is a disclosure. Do not design around containment: no encryption, no backup exclusions, no access controls. If a future change makes the content genuinely private (a closed meeting, a different venue, recording something not streamed), that is new information and this section needs revisiting — but absent that, treat the file as ordinary debugging output.

**A recording is kept until it has been used, then deleted.** It exists to answer a specific question: does the summarizer keep the hymn number, does the length backstop fire, did the previous-block context carry. Once that question is answered and the prompt or code has changed in response, the file's value is spent and keeping it is actively harmful — it was produced under a prompt that no longer exists, so re-reading it later invites conclusions about behavior the app no longer has. Stale evidence is worse than no evidence, because it looks like evidence.

This is why retention is **not** age-based. Thirty days is the wrong unit: a recording used the day after a meeting should go immediately, and one still unexamined after two months should stay. Being drained is the trigger, and only a person can judge that, so **deletion is manual and deliberately not automated.** Any sweep would have to guess when value was spent, and guessing wrong destroys the one artifact that cannot be recreated.

Judging that a recording is drained needs a way to see what each one holds without opening it, which
is what `scripts/list-recordings.js` prints (issue #8). Without it the retention rule quietly became
"they pile up forever, because nobody could tell which ones mattered." Deletion is still `rm`, and
still a person's call.

Disk is not a consideration either way. A meeting is a few hundred KB, dominated by the summary records rather than the transcript chunks, since each summary record stores the text it sent and a retried call stores it again.

One thing is consciously deferred rather than solved: a replay transcription source that reads a session file back at its original timing ([issue #3](https://github.com/senigami/meeting-companion/issues/3)).

## Addendum, 2026-08-25: the display side, and what the operator takes down

Steve, live, asking for it: keep a record of the actual output too, so a manual entry, an edit or a
deletion can be compared against what the AI produced.

The decision above records what the pipeline was TOLD and what a provider SAID. It records nothing
about what ended up in front of the reader after the operator corrected it, and correcting it is
most of why a person sits at the machine. Two of the three ways a card changes left no trace at all:
an in-place edit ([#125](https://github.com/senigami/meeting-companion/issues/125)) wrote straight to
state, and a live delete removed it silently. So a recording could say what the AI produced and could
not say what was actually read, which makes the tuning question above answerable only for the half of
the meeting nobody had to fix.

Four record types are added ([#142](https://github.com/senigami/meeting-companion/issues/142)): the
card that landed, an edit carrying both the original and the corrected text, a removal carrying the
text and which route it came off by, and a restore for undoing a clear.

### The scope question, raised rather than assumed

Warrick flagged this while reviewing, and it is the reason this addendum exists rather than the change
simply riding on the authorization above. A removal record is a durable log of **what a human judged
unfit to leave on a screen**, which is not the same thing as a log of what a model produced. The
original grant was given for measuring the summarizer, with Steve shown that specific content.

Steve was shown this specific content too, and authorized it on 2026-08-25, choosing to keep the
verbatim text rather than record removals as bare ids. The reasoning: a removal with no text says a
card came off and nothing about what was wrong with it, which defeats the comparison the feature
exists for.

The judgment, stated so it can be disagreed with later: this is the **same category** of content as
the decision above already authorizes (text from a meeting that is public and already streamed),
captured at a different moment in its life. It is not a new category, and it does not reach any new
surface. Every constraint above applies unchanged and none is relaxed:

- **Text only**, audio still never written. ADR-0003 stands.
- **Local only**, same gitignored directory, same append-only file, no egress.
- **Discarded once used**, same manual deletion, same reasoning.
- **Never damages a meeting.** All four record types go through the same `queueRecord` that swallows
  its own faults; the one line of new recorder code that sat outside that guard was moved inside it
  during review.

### What is genuinely new, and worth watching

An edit record is the first place this file stores **a human's correction of the app**, side by side
with what the app got wrong. That is the most useful thing in the recording and also the most pointed:
it is a record of the operator's judgment, not only the model's output. It stays local, it stays
disposable, and it is covered by the same retention rule, which is deletion once the question it
answers has been answered.

`header.displayCap` is also added, so a replay can reconstruct the wall from the file rather than
hardcoding a display constant that has already changed once.

## Spec docs affected

- [docs/01-scope.md](../01-scope.md)
- [docs/03-data-model.md](../03-data-model.md)
- [docs/07-ai-and-privacy.md](../07-ai-and-privacy.md)
- [docs/backlog.md](../backlog.md) — where this originated, now a pointer to the issue tracker
