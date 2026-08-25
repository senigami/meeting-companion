# ADR-0005: One session broadcasts a content stream to read-only viewer clients

> **TL;DR:** DRAFT, not accepted. One machine runs the meeting; anyone with the session link, on the
> same local network, joins as a read-only viewer over a WebSocket. The server broadcasts the CONTENT
> stream (lines, modes, timing) taken from the operator's own display state, not the raw AI output,
> never rendered layout, because each viewer controls their own text size and margins. A joiner
> receives the last 25 summary cards, then live pushes. This is the first feature intended to be
> reachable from another machine, so it needs Steve's ratification before any code.

## Status

**Draft.** Written to unblock [#6](https://github.com/senigami/meeting-companion/issues/6), which says
in its own text not to implement ahead of an ADR. Everything under "Decision" below that is marked
**settled** comes from Steve directly on that issue (2026-07-30, 2026-08-04, 2026-08-25). Everything
marked **proposed** is a recommendation of mine that he has not seen. Nothing here is implementable
until he accepts or corrects it.

**Addendum, 2026-08-25.** Steve dictated a fuller pass over the whole shape on #6 (v1 access model,
history cap, what the stream actually carries, viewer-local controls). Folded into "Settled by Steve
on #6" below rather than kept as a separate addendum, since it answers questions the original ADR
left as proposed or open rather than adding a new concern. Where it settles something previously
marked proposed, the old numbering is kept and the proposed item is struck through rather than
renumbered.

## Date

2026-08-13

## Context

The transcript runs on one TV driven by one laptop, and nobody else can follow along. The meeting is
already public and streamed, so letting people read it on their own phone is a natural extension
rather than a disclosure.

Today two people opening the site each run their own transcription: two microphones, two diverging
transcripts, two sets of provider calls, neither aware of the other. What is wanted is one session
doing the work and everyone else listening.

Two current-state facts a reader will otherwise assume wrongly:

- The app is **not** purely loopback already. `ALLOW_REMOTE_HOST` exists and is true in the local
  environment. So "the app does not meaningfully listen on a network" is only partly true today.
- Recording readback **was** deliberately restricted to loopback-origin requests on 2026-07-30, while
  building #3 (`refuseUnlessLoopback` in `server.js`, documented in `docs/07-ai-and-privacy.md`).
  ADR-0004 authorized writing recordings to local disk and never authorized reading them back over a
  network. A viewer feature must not inherit a relaxation of that; it is a separate surface.

## Decision

### Settled by Steve on #6

1. **A session is startable and shareable.** The operator starts a session and gets a link. A session
   id people dial into is an acceptable shape.
2. **Anyone opening the link joins as a viewer.** Read-only by definition. No recording, no ability to
   affect the session, the display, the lines, or the mode. Treated as a permission level whose value
   is `viewer`.
3. **A viewer controls their own text size and margins,** and nothing else.
4. **The server broadcasts content, never layout.** Because each viewer sets their own size and
   margins, a viewer is not a mirror of the TV: two viewers on one session will have different line
   breaks, card heights, and amounts of text on screen. So the stream carries lines, modes and timing,
   and each client renders locally. The two shapes are not refactors of each other, which is why this
   is settled here before any design.
   - **2026-08-25: the source of that content is the operator's current display state, not the
     original AI output.** If the operator edits a card's text, deletes a card, or adds a manual card,
     that change reaches every connected viewer. Now buildable: since #142/#143 the app already tracks
     what the reader actually reads (`card`, `card-edit`, `card-remove`, `card-restore` records in
     `session-recording.js`) separately from what the model produced, and the broadcast should read
     from the same wall the operator sees, not from a separate copy fed by the raw summary stream.
5. **A joiner receives the last 25 summary cards, not the full history,** so they arrive with context
   without loading the entire meeting. Configurable later (25/50/100); a limit is deliberate rather
   than defaulting to everything. This is the summary/card recap only, never the raw historical
   transcript -- someone joining or reloading mid-meeting does not need the full raw transcription of
   what they missed, only the card recap. From the moment they connect, the live transcript (if they
   are on that tab) resumes forward from there; it is not backfilled.
6. **WebSockets carry new items.** Steve's call, and it may change how pushes work today.
7. **A viewer can choose the summary cards or the realtime transcript, and switch between them,** via a
   Summary / Live Transcript selector at the top of the viewer page. Cards for catching up, transcript
   for someone who has trouble hearing. Both streams already exist, so this costs no extra tokens.
   Whichever tab is active, the summary/card recap is always what a reload re-delivers; the transcript
   tab simply resumes live pushes from that point rather than replaying raw history.
13. **v1 access is gated by network, not by account.** The operator's machine is the session server;
    everyone else is a viewer. Since the operator's machine would be reachable only on an internal IP
    for this version, a viewer must be on the same local network to reach it at all -- that alone
    answers "how do we avoid accidentally exposing the meeting publicly" for v1, no account system
    needed. A future, genuinely remote-hosted version (Steve running the server from home, viewers
    reaching it over the internet) would need real role management -- an admin sign-in that can
    start/control a meeting, everyone else entering as a view-only guest by default. That is a
    **deferred, later enhancement**, not part of this ADR: v1 needs to prove the basic
    same-network viewing approach works first.
14. **A shared meeting code, on top of the network gate.** Not a password and not treated as one --
    a short word or code given to everyone attending, which can stay the same week to week. Its only
    job is stopping someone from landing on the page by accident and immediately seeing the meeting,
    not securing anything sensitive (the content itself is not sensitive, per ADR-0004/#6's own
    context).
15. **Viewer-local display controls, led by a persistent text-size slider.** Always visible at the
    bottom of the viewer's screen rather than living in a settings menu, so it can be adjusted at any
    time without leaving the display. Font choice may also be exposed if multiple fonts are supported;
    margins are a maybe. Text size is the one that matters most and is settled; the rest are optional
    follow-ons to item 3, not new decisions.

### Proposed, needs Steve

~~8. A connection cap, defaulting to 10, with the operator able to raise it.~~ **Still needed, on top
of item 13's network gate, not instead of it.** The network gate limits *who can reach* the session;
a cap limits *how many* of them can pile onto the machine actually driving the meeting at once. Both
are resource/access questions on a church laptop, and item 13 doesn't make this one moot -- an entire
building's worth of phones on the same network is still a stutter risk for the TV. Kept open.
9. **The rail shows a viewer count.** Same honesty grounds as the rest of the rail: an operator should
   know whether anyone is watching, and a count that exists but is not shown is the shape of defect
   this repo keeps paying for. It must be a count only, never identities, and it must not become
   another per-event rail message (INV-10).
10. **A server restart mid-meeting drops every viewer, and they reconnect and re-fetch.** Viewers hold
    no state the server needs, so reconnect-and-refetch is simpler than session resumption and cannot
    resurrect a stale position. The operator's own session is the thing worth protecting across a
    restart, and that is out of scope here. Consistent with item 5: a reconnect re-fetches the same
    25-card recap a fresh join would get, never a resumed position.
11. **Reading pace stays per-client, and the session has no authoritative position.** Two viewers will
    be at different points in the meeting, deliberately. Pace is measured per reader (#14, #44), so a
    single session position would override the one thing that makes the display readable for the person
    it is measured for. This interacts with the reading-pace work and is the answer #6 asked for.
12. **Viewer access is a separate decision from `refuseUnlessLoopback`.** Serving a read-only content
    stream off-loopback does not authorize reading recordings off-loopback. That guard stays exactly as
    it is, and this ADR does not touch it.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Broadcast the rendered display (mirror the TV) | Breaks requirement 3 outright. Every viewer would inherit the TV's text size, which is calibrated for one reader on one wall and is wrong for a phone. |
| Poll an endpoint instead of WebSockets | Steve chose WebSockets. Polling also either lags the display or hammers the laptop driving the meeting. |
| Give a joiner the live transcript from the moment they join | They arrive with no context, which is the case the summary transcript exists for. |
| One authoritative session position for all viewers | Overrides per-reader pace, which is measured precisely because one pace does not fit. |
| No cap at all | The failure lands on the machine running the meeting, so it lands on the reader on the TV. |

## Consequences

- The app becomes a network service in intent, not just in capability. That is the part of this change
  that is hard to undo, and it is why this is a draft.
- A second render path exists (viewer clients rendering the content stream locally), so a display rule
  that lives only in the operator's render path will silently not apply to viewers.
- Provider cost does not change: one session does the work, and both streams already exist.
- The broadcast source becomes the operator's display state (item 4), so the server needs one place
  that is genuinely "the wall right now" for a viewer join or reconnect to read from -- not just the
  append-only recording stream #142/#143 already write, which is a log, not a queryable current state.
- The card record shapes from #142/#143 (`card`, `card-edit`, `card-remove`, `card-restore`) become
  candidates for what a viewer's WebSocket payload carries, since they already express edits and
  deletes as first-class events rather than requiring a viewer to diff two full-wall snapshots.

## Spec docs affected

`docs/02-system-architecture.md` (a second client type and the broadcast boundary),
`docs/04-api-conventions.md` (the WebSocket contract and the session-link route),
`docs/07-ai-and-privacy.md` (what is reachable off-loopback, and what explicitly is not),
`docs/03-data-model.md` (already carrying #145's debt -- the viewer payload shape should be documented
alongside the recording record shapes it likely reuses, not as a third, separate shape).
