# Design brief — demo scenario matrix, mode-matched

Purpose: make the demo transcription script a deliberate test corpus, so no summarization scenario
reaches a live meeting untested. Steve's requirement, 2026-07-28: **each scenario must be summarized
in the mode it belongs to.** Tuning a song-mode prompt against speaker text teaches nothing true, and
worse, it teaches something false.

## The mechanism change

`DEMO_SCRIPT` entries are `{ text }` today, so the driver cannot change mode and three of the four
mode instructions in `summary-prompt.js#modeInstruction` are never exercised. Change the entry shape:

```js
{ text, mode, proves, pauseBeforeMs }
```

- `mode` — one of `speaker` | `information` | `song` | `prayer`. The driver applies it before emitting
  the text, so the summarizer receives the mode this input actually belongs to.
- `proves` — a stable tag naming the scenario this entry exists to cover. Test-facing, so a coverage
  test can assert nothing was silently deleted. This is the point of the whole exercise: it must be
  impossible to quietly remove the only line containing a hymn number.
- `pauseBeforeMs` — optional, for the silence-gap scenario. Default keeps today's deterministic
  length-derived cadence, which must be preserved: identical replays are what make 5s-vs-10s a fair
  comparison.

The driver must call the runtime's mode setter itself. A script that carries a mode the driver ignores
is worse than no mode field, because it reads as covered.

## The matrix — every row must exist, tagged with `proves`

### speaker mode — the specific story, event, teaching, feeling, invitation
| `proves` | Input shape |
|---|---|
| `speaker-narrative` | A short anecdote with a concrete detail worth keeping |
| `speaker-pronoun-heavy` | A passage leaning on "he/she/they" where the referent was named earlier — the contract says name the person instead |
| `speaker-embedded-number` | Speaker-mode text containing a date or figure, which must stay verbatim even outside information mode |
| `speaker-invitation` | A call to action the reader must be able to act on |

### information mode — exact dates, times, places, hymn numbers, assignments; drop courtesy words
| `proves` | Input shape |
|---|---|
| `info-date-time-place` | e.g. "Tuesday, 7:00 p.m., Fellowship Hall" — all three, digits included |
| `info-assignments` | e.g. "platform 1, microphone 2" — the assignment-number case |
| `info-hymn-number` | A hymn announced by number, in information mode |
| `info-scripture-reference` | A chapter-and-verse reference, e.g. a book, 3:16-18 style |
| `info-multi-fact` | Several distinct facts in one utterance — tests one-idea-per-line without losing a fact |
| `info-courtesy-padding` | A fact buried in politeness, to confirm the padding is dropped and the fact is not |

### song mode — ONLY hymn or song status. No lyrics, no commentary
| `proves` | Input shape |
|---|---|
| `song-status-with-number` | "Hymn 198, ready to sing" — status plus a number to keep verbatim |
| `song-lyrics-must-not-appear` | Someone reading lyric-shaped lines aloud. **The summary must NOT reproduce them.** This is the highest-value row in the matrix and is currently enforced by nothing. |
| `song-commentary-must-not-appear` | Warm commentary about why the hymn was chosen — must reduce to status, not sentiment |

**Copyright constraint, non-negotiable:** do NOT put real hymn or song lyrics in this repo. Write
invented lyric-shaped lines. The scenario is about *shape*, and inventing them costs nothing.

### prayer mode — a short prayer-shaped line, opens "Heavenly Father", closes "Amen", not line-by-line
| `proves` | Input shape |
|---|---|
| `prayer-multiple-requests` | Several named requests, to confirm they survive as a prayer rather than a list |
| `prayer-long-rambling` | A long prayer, to confirm it is not summarized line by line |
| `prayer-short` | A one-line prayer, to confirm the shape still holds on thin input |

### pipeline edges — mode is whatever fits, the scenario is mechanical
| `proves` | Input shape |
|---|---|
| `edge-unpunctuated-tail` | A trailing fragment with no terminal punctuation — the ONLY thing that exercises the 20s settle in `partitionBucket`. Every one of today's 25 lines is punctuated. |
| `edge-disfluency` | "um", "uh", "you know" padding |
| `edge-duplicate-line` | The same sentence twice, as a recognizer double-emission |
| `edge-run-on` | A single utterance over 240 chars, to exercise output segmentation at `AI_LINE_SAFETY_MAX_CHARS` |
| `edge-silence-gap` | A `pauseBeforeMs` long enough to trip the silence watchdog and the `silence` status level |
| `edge-minimal-utterance` | "Amen." alone — near-empty input that must not produce a confident invented line |

## Constraints

- **Keep the existing 25 lines' character** — a real meeting's warmth, Australian idiom, the Margaret
  Ellis thread. Extend the corpus; do not replace it with a test fixture that reads like a test
  fixture. The reader this app serves is at a real meeting, and the demo should feel like one.
- **Determinism is a feature.** Same script, same cadence, same result on every replay. Do not
  introduce randomness.
- **The demo summarizer must still honour `SUMMARY_MAX_WORDS`** and must never be what we tune the
  real prompt against — the matrix is for driving the REAL summarizer (INV-13 unchanged: demo
  summarizer stays rehearsal-only and reachable only by explicit choice).

## Tests

- Every `proves` tag in this brief exists in the script. Assert against a literal list, so deleting a
  scenario fails a test rather than passing quietly.
- Every entry has a valid `mode`.
- The driver applies each entry's mode before emitting its text (assert on a mode-setter spy).
- Cadence stays deterministic: two runs with the same injected clock produce identical timings.
- `edge-unpunctuated-tail` really is unpunctuated; `edge-run-on` really is over 240 chars;
  `info-*` rows really do contain digits. Assert the properties, not just the tags — a tag that
  claims coverage it does not have is the failure mode this whole file exists to prevent.

## After implementation — the judging pass, in this order

1. Run the demo corpus through the REAL summarizer, once per mode, capturing actual output.
2. **Judge the output only,** against one question: is it usable by a Deaf, ASL-first, low-vision,
   slow reader, or is it confusing? Readability is grounds to block. Whoever judges must not have
   authored the input, since the judge does not mark their own homework.
3. Fix what is blocked, re-run, re-judge.
4. Review the whole change before any of it is committed or taken live.
