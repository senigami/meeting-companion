# ADR-0005: One session broadcasts a content stream to read-only viewer clients

> **TL;DR:** DRAFT, not accepted. One machine runs the meeting; anyone with the session link joins as a
> read-only viewer over a WebSocket. The server broadcasts the CONTENT stream (lines, modes, timing),
> never rendered layout, because each viewer controls their own text size and margins. A joiner
> receives the summary transcript so far, then live pushes. This is the first feature intended to be
> reachable from another machine, so it needs Steve's ratification before any code.

## Status

**Draft.** Written to unblock [#6](https://github.com/senigami/meeting-companion/issues/6), which says
in its own text not to implement ahead of an ADR. Everything under "Decision" below that is marked
**settled** comes from Steve directly on that issue (2026-07-30 and 2026-08-04). Everything marked
**proposed** is a recommendation of mine that he has not seen. Nothing here is implementable until he
accepts or corrects it.

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
5. **A joiner receives the summary transcript so far,** not the live transcript, so they arrive with
   context, and can scroll back over what they missed. Opening a link mid-meeting is the normal case,
   not an edge case.
6. **WebSockets carry new items.** Steve's call, and it may change how pushes work today.
7. **A viewer can choose the summary cards or the realtime transcript, and switch between them.** Cards
   for catching up, transcript for someone who has trouble hearing. Both streams already exist, so
   this costs no extra tokens.

### Proposed, needs Steve

8. **A connection cap, defaulting to 10, with the operator able to raise it.** The transcript is not
   sensitive, so this is a resource question on a church laptop, not a confidentiality one. A cap is
   the honest form: an unbounded listener count degrades the machine actually driving the meeting, and
   the reader on the TV is the one who pays for that. Refuse past the cap with a plain reason rather
   than accepting a connection that will stutter.
9. **The rail shows a viewer count.** Same honesty grounds as the rest of the rail: an operator should
   know whether anyone is watching, and a count that exists but is not shown is the shape of defect
   this repo keeps paying for. It must be a count only, never identities, and it must not become
   another per-event rail message (INV-10).
10. **A server restart mid-meeting drops every viewer, and they reconnect and re-fetch.** Viewers hold
    no state the server needs, so reconnect-and-refetch is simpler than session resumption and cannot
    resurrect a stale position. The operator's own session is the thing worth protecting across a
    restart, and that is out of scope here.
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

## Spec docs affected

`docs/02-system-architecture.md` (a second client type and the broadcast boundary),
`docs/04-api-conventions.md` (the WebSocket contract and the session-link route),
`docs/07-ai-and-privacy.md` (what is reachable off-loopback, and what explicitly is not).
