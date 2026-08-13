# Backlog

**This file is now a pointer. The record lives in GitHub issues.**

Open work is tracked at [github.com/senigami/meeting-companion/issues](https://github.com/senigami/meeting-companion/issues),
on [project board 2](https://github.com/users/senigami/projects/2/views/1). Add new ideas there, not here.

This file is kept only so that links to it still resolve, and to record what became of the five entries
it used to hold. It is not a spec: `docs/00-index.md` and its ADRs remain the authority on what the app
actually does.

## What happened to the original five entries

| Was | Now |
| --- | --- |
| 1. Microphone source selection and a live level meter | **Shipped** `2b137db`. Verification against real hardware is [#1](https://github.com/senigami/meeting-companion/issues/1). |
| 2. Record the incoming transcription text with timestamps | **Shipped** `f4bfedd` under [ADR-0004](decisions/0004-session-recording-for-tuning.md). The replay source it was really for shipped in `6c95a6e` ([#3](https://github.com/senigami/meeting-companion/issues/3)). |
| 3. Record the summary output for post-meeting analysis | **Shipped** `f4bfedd`, same ADR. It has measured nothing yet, which is [#2](https://github.com/senigami/meeting-companion/issues/2). |
| 4. Multiple viewing clients over WebSockets | [#6](https://github.com/senigami/meeting-companion/issues/6). Still needs an ADR before design. |
| 5. Known latent defects | Four fixed (both `shortenToLimit` cases, the `takeOldestModeRun` throw, and diagnostics reaching the operator). The remaining one is [#5](https://github.com/senigami/meeting-companion/issues/5). `previousBlock` was never a defect, only unobserved, and is folded into [#2](https://github.com/senigami/meeting-companion/issues/2). |

One issue on the board did not come from this file: [#4](https://github.com/senigami/meeting-companion/issues/4),
stamping each recording with the prompt and commit that produced it. ADR-0004 deletes a recording once it
has been used, because a stale recording measures a pipeline that no longer exists, and at the time nothing
in the file let you tell how old it was. #4 shipped the header that says so, and
[#8](https://github.com/senigami/meeting-companion/issues/8) shipped `scripts/list-recordings.js`, which
prints it per recording alongside what each one holds.
