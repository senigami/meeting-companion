import test from 'node:test';
import assert from 'node:assert/strict';

import { createElement, withRuntimeHarness } from './runtime-test-helpers.js';

// ADR-0004 / backlog items 2-3: the debugging/tuning recorder. These tests cover the client-side
// half owned by Janus -- queuing chunk/summary records, batching them into one flush, and the
// non-negotiable that a recording failure (a rejected or non-ok /api/recording/append call) must
// degrade to "recording stopped" and never throw into the transcription/summarize path.

function baseState(overrides = {}) {
  return {
    recordingEnabled: true,
    recordingSessionId: 'test-session',
    recordingQueue: [],
    recordingOk: null,
    ...overrides
  };
}

test('a final transcript event queues a chunk record tagged with its own capture mode', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState()
  }, async ({ ctx, runtime }) => {
    ctx.state.mode = 'prayer';
    runtime.handleTranscriptEvent({ type: 'final', text: 'Please remember the Alvarez family.' });

    // Index 1, not 0: queueRecord (issue #4) inserts the session's header record first, before any
    // chunk or summary record ever reaches the queue.
    assert.equal(ctx.state.recordingQueue.length, 2);
    assert.equal(ctx.state.recordingQueue[0].t, 'header');
    const record = ctx.state.recordingQueue[1];
    assert.equal(record.t, 'chunk');
    assert.equal(record.mode, 'prayer');
    assert.equal(record.text, 'Please remember the Alvarez family.');
  });
});

// Issue #40: a replay must reproduce the same speaker labels the operator actually saw, so the
// speaker active when a chunk was captured has to reach the recording, exactly like mode above.
test('a final transcript event queues a chunk record tagged with its own capture speaker', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({ speakerName: 'Bro. Ashcroft' })
  }, async ({ ctx, runtime }) => {
    runtime.handleTranscriptEvent({ type: 'final', text: 'Please remember the Alvarez family.' });

    assert.equal(ctx.state.recordingQueue.length, 2);
    const record = ctx.state.recordingQueue.find((r) => r.t === 'chunk');
    assert.equal(record.speaker, 'Bro. Ashcroft');
  });
});

test('an empty speaker records as null, never as a placeholder name', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({ speakerName: '' })
  }, async ({ ctx, runtime }) => {
    runtime.handleTranscriptEvent({ type: 'final', text: 'No name typed yet.' });

    const record = ctx.state.recordingQueue.find((r) => r.t === 'chunk');
    assert.equal(record.speaker, null);
  });
});

test('recording disabled means a final transcript event queues nothing', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({ recordingEnabled: false })
  }, async ({ ctx, runtime }) => {
    runtime.handleTranscriptEvent({ type: 'final', text: 'Please remember the Alvarez family.' });
    assert.equal(ctx.state.recordingQueue.length, 0);
  });
});

test('an exact-duplicate final event that the bucket itself drops is not recorded either', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({ transcriptChunks: [{ text: 'Already said.', at: 1, mode: 'speaker' }] })
  }, async ({ ctx, runtime }) => {
    runtime.handleTranscriptEvent({ type: 'final', text: 'Already said.' });
    // appendUniqueChunk is a same-text no-op, so the recorded queue must stay empty too -- otherwise
    // a summary record's consumedIds could point at a chunk id the bucket never actually held.
    assert.equal(ctx.state.recordingQueue.length, 0);
  });
});

test('a successful summarize call queues one summary record carrying provider, consumedIds, and wasShortened', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState(),
    createSummarizationDriverFn: () => ({
      id: 'openai',
      async summarize() {
        return { line: 'Forgiven neighbor.', wasShortened: true };
      }
    })
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText('A neighbor was forgiven, at long last.');

    const summaryRecords = ctx.state.recordingQueue.filter((r) => r.t === 'summary');
    assert.equal(summaryRecords.length, 1);
    assert.equal(summaryRecords[0].ok, true);
    assert.equal(summaryRecords[0].returned, 'Forgiven neighbor.');
    assert.equal(summaryRecords[0].provider, 'openai');
    assert.equal(summaryRecords[0].wasShortened, true);
  });
});

// #66: hadPreviousBlock now answers "did this call carry prior context", and summaryHistory is the
// only thing that can supply it. It has to be read BEFORE the successful line is appended to the
// history, or the first call of a meeting would claim context it did not have.
test('the first call of a meeting records hadPreviousBlock false, and the next one true', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState(),
    createSummarizationDriverFn: () => ({
      id: 'openai',
      async summarize() {
        return { line: 'Forgiven neighbor.' };
      }
    })
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText('A neighbor was forgiven, at long last.');
    await runtime.summarizeCurrentText('And the harvest came in early.');

    const summaryRecords = ctx.state.recordingQueue.filter((r) => r.t === 'summary');
    assert.equal(summaryRecords.length, 2);
    assert.equal(summaryRecords[0].hadPreviousBlock, false);
    assert.equal(summaryRecords[1].hadPreviousBlock, true);
  });
});

test('a failed call records hadPreviousBlock from the history it did have', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({ summaryHistory: [{ spoken: 'An earlier chunk.', shown: 'An earlier card.' }] }),
    createSummarizationDriverFn: () => ({
      id: 'openai',
      async summarize() {
        throw new Error('ECONNRESET');
      }
    })
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText('A neighbor was forgiven, at long last.');

    const summaryRecords = ctx.state.recordingQueue.filter((r) => r.t === 'summary');
    assert.equal(summaryRecords.length, 1);
    assert.equal(summaryRecords[0].ok, false);
    assert.equal(summaryRecords[0].hadPreviousBlock, true);
  });
});

test('a failed summarize call still queues a summary record, marked ok:false with the error and no returned text', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState(),
    createSummarizationDriverFn: () => ({
      id: 'openai',
      async summarize() {
        throw new Error('ECONNRESET');
      }
    })
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText('A neighbor was forgiven, at long last.');

    const summaryRecords = ctx.state.recordingQueue.filter((r) => r.t === 'summary');
    assert.equal(summaryRecords.length, 1);
    assert.equal(summaryRecords[0].ok, false);
    assert.equal(summaryRecords[0].returned, '');
    assert.equal(summaryRecords[0].error, 'ECONNRESET');
  });
});

// --- The recorder must not damage a meeting even if the RECORDER ITSELF is broken -------------
//
// ADR-0004's "never damages a meeting" was implemented for the network write but not for the record
// shaping. These two pin the shaping half, using a queue whose push throws to stand in for any fault
// inside buildChunkRecord/buildSummaryRecord.

function explodingQueue() {
  return {
    push() {
      throw new TypeError('recorder is broken');
    },
    length: 0,
    splice: () => []
  };
}

test('a recorder that throws while shaping a chunk record does not drop live speech', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({ recordingQueue: explodingQueue() })
  }, async ({ ctx, runtime }) => {
    // doesNotThrow is the load-bearing assertion here, not the chunk count: the chunk is appended
    // before the record is queued, so it survives either way. What the guard buys is that the throw
    // never reaches the transcription driver's event callback, where it would tear down listening.
    assert.doesNotThrow(() => runtime.handleTranscriptEvent({ type: 'final', text: 'Hymn 152 is next.' }));

    assert.equal(ctx.state.transcriptChunks.length, 1);
    assert.equal(ctx.state.transcriptChunks[0].text, 'Hymn 152 is next.');
  });
});

test('a recorder that throws does not swallow the operator failure alert for a genuinely failing provider', async () => {
  // The nastier case. The failure-path record is queued INSIDE summarizeCurrentText's catch block, so
  // a throw there escapes before summarizeFailureCount is incremented -- and the operator would never
  // be told the provider is down, because a debugging instrument ate the alert.
  await withRuntimeHarness({
    stateOverrides: baseState({ recordingQueue: explodingQueue() }),
    createSummarizationDriverFn: () => ({
      id: 'openai',
      async summarize() {
        throw new Error('ECONNRESET');
      }
    })
  }, async ({ ctx, runtime }) => {
    await runtime.summarizeCurrentText('A neighbor was forgiven, at long last.');
    assert.equal(ctx.state.summarizeFailureCount, 1, 'the provider failure must still be counted');
  });
});

test('flushRecordingQueue sends the whole queue as one batched request, not one per record', async () => {
  const requests = [];
  await withRuntimeHarness({
    stateOverrides: baseState({
      recordingQueue: [
        { t: 'chunk', at: '1', id: '1', mode: 'speaker', text: 'a' },
        { t: 'chunk', at: '2', id: '2', mode: 'speaker', text: 'b' }
      ]
    }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    }
  }, async ({ ctx, runtime }) => {
    await runtime.flushRecordingQueue();

    assert.equal(requests.length, 1, 'one batched request, not two');
    assert.equal(requests[0].url, '/api/recording/append');
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.sessionId, 'test-session');
    assert.equal(body.records.length, 2);
    assert.equal(ctx.state.recordingQueue.length, 0);
  });
});

test('a rejected recording flush degrades to a failed indicator and never throws', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({
      recordingQueue: [{ t: 'chunk', at: '1', id: '1', mode: 'speaker', text: 'a' }]
    }),
    fetchImpl: async () => {
      throw new Error('network down');
    },
    elementOverrides: {
      recordingIndicator: createElement({ textContent: '', dataset: {} })
    }
  }, async ({ ctx, runtime, elements }) => {
    await assert.doesNotReject(() => runtime.flushRecordingQueue());

    assert.equal(ctx.state.recordingOk, false);
    assert.match(elements.recordingIndicator.textContent, /stopped/i);
  });
});

test('a non-ok recording flush response also degrades to a failed indicator, not a thrown error', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({
      recordingQueue: [{ t: 'chunk', at: '1', id: '1', mode: 'speaker', text: 'a' }]
    }),
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: 'invalid session id' }) }),
    elementOverrides: {
      recordingIndicator: createElement({ textContent: '', dataset: {} })
    }
  }, async ({ ctx, runtime, elements }) => {
    await runtime.flushRecordingQueue();
    assert.equal(ctx.state.recordingOk, false);
    assert.match(elements.recordingIndicator.textContent, /stopped/i);
  });
});

test('armed-but-nothing-written is reported as such, not as a successful recording', async () => {
  // ADR-0004 asked for an indicator truthful about whether writes are LANDING, not whether recording
  // was requested. recordingOk === null is the state where those two answers differ: at page load and
  // through the first quiet stretch of a meeting, no flush has happened and the first one may fail.
  await withRuntimeHarness({
    stateOverrides: baseState({ recordingOk: null }),
    elementOverrides: {
      recordingIndicator: createElement({ textContent: '', dataset: {} })
    }
  }, async ({ runtime, elements }) => {
    runtime.setRecordingEnabled(true);
    assert.match(elements.recordingIndicator.textContent, /nothing written yet/i);
    assert.doesNotMatch(elements.recordingIndicator.textContent, /Recording session to a local file/i);
  });
});

test('a successful flush is what promotes the indicator to actually recording', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({
      recordingOk: null,
      recordingQueue: [{ t: 'chunk', at: '1', id: '1', mode: 'speaker', text: 'a' }]
    }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, written: 1 }) }),
    elementOverrides: {
      recordingIndicator: createElement({ textContent: '', dataset: {} })
    }
  }, async ({ ctx, runtime, elements }) => {
    await runtime.flushRecordingQueue();
    assert.equal(ctx.state.recordingOk, true);
    assert.match(elements.recordingIndicator.textContent, /Recording session to a local file/i);
  });
});

test('setRecordingEnabled(false) clears the queue and updates the indicator to "not recording"', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({ recordingQueue: [{ t: 'chunk', at: '1', id: '1', mode: 'speaker', text: 'a' }] }),
    elementOverrides: {
      recordingIndicator: createElement({ textContent: '', dataset: {} })
    }
  }, async ({ ctx, runtime, elements }) => {
    runtime.setRecordingEnabled(false);
    assert.equal(ctx.state.recordingEnabled, false);
    assert.equal(ctx.state.recordingQueue.length, 0);
    assert.match(elements.recordingIndicator.textContent, /not recording/i);
  });
});

// #135: every card the operator typed by hand was missing from the recording entirely -- not logged
// badly, never logged. These four pin the whole contract: manual lines land, AI lines don't land
// twice, the disabled switch still wins, and the recorded text is what the reader actually saw.
test('a manually typed line reaches the recording, which it never did before #135', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState()
  }, async ({ ctx, runtime }) => {
    ctx.state.mode = 'information';
    runtime.addLine('Choir practice is after the block.', { speaker: '' });

    const record = ctx.state.recordingQueue.find((r) => r.t === 'manual');
    assert.ok(record, 'a manual line must produce a manual record');
    assert.equal(record.text, 'Choir practice is after the block.');
    assert.equal(record.mode, 'information');
    assert.equal(record.speaker, null);
    assert.equal(record.isHeader, false);
  });
});

// The double-write this guards against is not hypothetical: addLine is the shared path for BOTH
// manual and AI cards, so recording unconditionally would write every AI line twice -- once as its
// own summary record and once here -- under two different shapes, which is worse than the gap.
test('an AI line routed through the same addLine path is not recorded a second time', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState()
  }, async ({ ctx, runtime }) => {
    // Asserted, not assumed: if the AI line failed to land a card at all, "no manual record" would
    // pass for the wrong reason and this test would be checking nothing.
    assert.equal(runtime.addLine('He spoke about the parable of the sower.', { source: 'ai' }), true);

    assert.equal(ctx.state.recordingQueue.filter((r) => r.t === 'manual').length, 0);
  });
});

test('recording disabled means a manual line queues nothing either', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState({ recordingEnabled: false })
  }, async ({ ctx, runtime }) => {
    runtime.addLine('Choir practice is after the block.');
    assert.equal(ctx.state.recordingQueue.length, 0);
  });
});

// A line that never became a card must never become a record: the record's whole claim is "this was
// on the wall", and addLine rejects empty/whitespace-only text before any card is created.
test('a manual line that lands no card leaves no record behind', async () => {
  await withRuntimeHarness({
    stateOverrides: baseState()
  }, async ({ ctx, runtime }) => {
    assert.equal(runtime.addLine('   '), false);
    assert.equal(ctx.state.recordingQueue.length, 0);
  });
});

// --- #138: nothing drained the queue outside the summarize loop --------------------------------
//
// The loop only runs while listening, and it is the only caller of flushRecordingQueue. Anything
// queued outside that window sat in memory until the tab closed, and was then simply gone.

function createManualClock() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimeoutFn(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) { pending.delete(id); },
    pendingCount: () => pending.size,
    // Fires everything currently scheduled. Deliberately does NOT fire timers that those callbacks
    // schedule in turn, so a test can tell one flush from a chain of them.
    async runPending() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, timer] of due) await timer.callback();
    }
  };
}

test('a typed line in a session that never starts listening still reaches disk', async () => {
  const clock = createManualClock();
  const requests = [];
  await withRuntimeHarness({
    stateOverrides: baseState({ loopHandle: null }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    }
  }, async ({ ctx, runtime }) => {
    runtime.addLine('Ward council moved to five o clock.');

    assert.equal(requests.length, 0, 'nothing is written immediately -- the write is debounced');
    assert.ok(ctx.state.recordingQueue.length > 0);

    await clock.runPending();

    assert.equal(requests.length, 1, 'the queued records must be written without the loop ever running');
    const body = JSON.parse(requests[0].options.body);
    assert.ok(body.records.some((r) => r.t === 'manual' && r.text === 'Ward council moved to five o clock.'));
    assert.equal(ctx.state.recordingQueue.length, 0);
  });
});

// The costliest case, and not the one the issue was filed for: stopListening clears the loop and
// THEN runs its final summarize, so the closing summary of every meeting was queued with nothing
// left alive to write it. A meeting that ended with Stop and a closed tab lost its last card.
test('the final summary queued after Stop is written, not stranded with the loop already cleared', async () => {
  const clock = createManualClock();
  const requests = [];
  await withRuntimeHarness({
    stateOverrides: baseState({ loopHandle: null }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    createSummarizationDriverFn: () => ({
      id: 'openai',
      async summarize() { return { line: 'The closing remarks.' }; }
    }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    }
  }, async ({ ctx, runtime }) => {
    // Exactly the state stopListening leaves behind: loop cleared, then a summarize runs.
    await runtime.summarizeCurrentText('And that is the whole of it, brothers and sisters.');

    await clock.runPending();

    const written = requests.flatMap((r) => JSON.parse(r.options.body).records);
    assert.ok(
      written.some((r) => r.t === 'summary' && r.returned === 'The closing remarks.'),
      'the closing summary must reach the recording'
    );
  });
});

test('a burst of typed cards is one write, not one per card', async () => {
  const clock = createManualClock();
  const requests = [];
  await withRuntimeHarness({
    stateOverrides: baseState({ loopHandle: null }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    }
  }, async ({ ctx, runtime }) => {
    runtime.addLine('First announcement.');
    runtime.addLine('Second announcement.');
    runtime.addLine('Third announcement.');

    assert.equal(clock.pendingCount(), 1, 'each card must reset one timer, never stack three');

    await clock.runPending();

    assert.equal(requests.length, 1);
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.records.filter((r) => r.t === 'manual').length, 3, 'all three in the one write');
  });
});

// While the loop is running it already drains every tick, so a second clock would be redundant work
// on the machine driving a live meeting.
test('nothing extra is scheduled while the summarize loop is running and already draining', async () => {
  const clock = createManualClock();
  await withRuntimeHarness({
    stateOverrides: baseState({ loopHandle: 'a-running-loop' }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn
  }, async ({ ctx, runtime }) => {
    const before = clock.pendingCount();
    runtime.addLine('A line during a live meeting.');

    assert.equal(clock.pendingCount(), before, 'the loop owns the drain; no second timer');
    assert.ok(ctx.state.recordingQueue.length > 0, 'but the record is still queued for that loop');
  });
});

// --- #142: recording what the reader actually read ---------------------------------------------
//
// Steve's ask: keep a record of the real output, not only what was sent and what came back, so a
// hand correction can be compared against what the AI produced. Two of the three ways a card changes
// left no trace at all before this.

test('a card that lands on the wall is recorded, with the id an edit can later point at', async () => {
  await withRuntimeHarness({ stateOverrides: baseState() }, async ({ ctx, runtime }) => {
    ctx.state.mode = 'information';
    runtime.addLine('Ward council at five.');

    const card = ctx.state.recordingQueue.find((r) => r.t === 'card');
    assert.ok(card, 'a card reaching the wall must be recorded');
    assert.equal(card.text, 'Ward council at five.');
    assert.equal(card.mode, 'information');
    assert.equal(card.source, 'manual');
    assert.ok(card.cardId, 'the card must carry the id an edit or a removal points at');
  });
});

// The bug this guards is subtle and would produce a file that lies in the most damaging direction:
// appendTranscriptItems drops an item repeating the card above it, so recording the INPUT rather
// than the result would claim the reader saw something never put in front of them.
test('a duplicate card the wall itself rejects is not recorded as having been read', async () => {
  await withRuntimeHarness({ stateOverrides: baseState() }, async ({ ctx, runtime }) => {
    runtime.addLine('The same sentence twice.');
    runtime.addLine('The same sentence twice.');

    assert.equal(
      ctx.state.recordingQueue.filter((r) => r.t === 'card').length,
      1,
      'the rejected duplicate never reached the reader, so it must not be recorded'
    );
  });
});

// #125 shipped edit-in-place, and it wrote straight to state with no record at all -- so the single
// most informative event in the file (a human deciding the AI was wrong) was the one thing missing.
test('editing a card in place records both what it said and what it was corrected to', async () => {
  await withRuntimeHarness({ stateOverrides: baseState() }, async ({ ctx, runtime }) => {
    runtime.addLine('Brother Ashcroft spoke about the sower.');
    const cardId = ctx.state.transcriptItems[0].id;

    runtime.updateItemText(cardId, 'Brother Ashcraft spoke about the sower.');

    const edit = ctx.state.recordingQueue.find((r) => r.t === 'card-edit');
    assert.ok(edit, 'an in-place edit must be recorded');
    assert.equal(edit.cardId, cardId);
    assert.equal(edit.before, 'Brother Ashcroft spoke about the sower.', 'the ORIGINAL is the half that says the AI got it wrong');
    assert.equal(edit.after, 'Brother Ashcraft spoke about the sower.');
  });
});

test('committing an edit that changed nothing records nothing', async () => {
  await withRuntimeHarness({ stateOverrides: baseState() }, async ({ ctx, runtime }) => {
    runtime.addLine('Unchanged text.');
    const cardId = ctx.state.transcriptItems[0].id;

    runtime.updateItemText(cardId, 'Unchanged text.');

    assert.equal(ctx.state.recordingQueue.filter((r) => r.t === 'card-edit').length, 0);
  });
});

test('the three routes off the wall are recorded, and say which route it was', async () => {
  await withRuntimeHarness({ stateOverrides: baseState({ clearArmed: true }) }, async ({ ctx, runtime }) => {
    runtime.addLine('First card.');
    runtime.addLine('Second card.');
    runtime.addLine('Third card.');
    const secondId = ctx.state.transcriptItems[1].id;

    runtime.removeItem(secondId);
    runtime.undoLine();
    runtime.clearLines();

    const removals = ctx.state.recordingQueue.filter((r) => r.t === 'card-remove');
    assert.deepEqual(removals.map((r) => r.via), ['delete', 'undo', 'clear']);
    assert.equal(removals[0].cardId, secondId);
    assert.equal(removals[0].text, 'Second card.', 'the removed text is kept: what was taken down is the point');
  });
});

// Without this a replay shows cards gone that are on the screen in front of the reader, which is the
// exact failure this whole group of records exists to prevent.
test('undoing a clear records the restore, so a replay does not show cards that are back as gone', async () => {
  await withRuntimeHarness({ stateOverrides: baseState({ clearArmed: true }) }, async ({ ctx, runtime }) => {
    runtime.addLine('A card that gets cleared.');
    const cardId = ctx.state.transcriptItems[0].id;
    runtime.clearLines();
    assert.equal(ctx.state.transcriptItems.length, 0);

    runtime.undoLine();

    const restore = ctx.state.recordingQueue.find((r) => r.t === 'card-restore');
    assert.ok(restore, 'the restore must be recorded');
    assert.deepEqual(restore.cardIds, [cardId]);
    assert.equal(ctx.state.transcriptItems.length, 1, 'and the card really is back on the wall');
  });
});

test('the header carries the display cap, so a replay reads the rule instead of hardcoding it', async () => {
  await withRuntimeHarness({ stateOverrides: baseState() }, async ({ ctx, runtime }) => {
    runtime.addLine('Anything, to force the header.');

    const header = ctx.state.recordingQueue.find((r) => r.t === 'header');
    assert.ok(header, 'the header is written first, on the very first queued record');
    assert.equal(header.displayCap, 24, 'a replay must not have to guess or hardcode the cap');
  });
});


// Two rounds of review landed on this one function, and both found the same class of mistake in it,
// so the algorithm lives here rather than in prose alone.
//
// Cato withheld sign-off because the record format claimed a replay reconstructs the final wall,
// which is false once the wall has overflowed. My fix was "keep the last displayCap survivors", and
// Warrick then broke THAT by running it: a trimmed card is gone forever, but an end-slice lets a
// later deletion pull one back off the scrapheap. The trim has to be simulated inline, at each
// append, in file order.
function replayWall(records, displayCap) {
  const order = [];
  const text = new Map();
  // Never deleted from, and that is the point of it being separate. A card-restore carries ids and
  // no text, so the only way to recover what a restored card SAID is the card/card-edit records
  // already seen. Delete from this on removal and a clear-then-undo returns every card blank.
  const lastKnown = new Map();
  const trim = () => { while (order.length > displayCap) text.delete(order.shift()); };
  const drop = (id) => { const i = order.indexOf(id); if (i >= 0) { order.splice(i, 1); text.delete(id); } };

  for (const r of records) {
    if (r.t === 'card') { order.push(r.cardId); text.set(r.cardId, r.text); lastKnown.set(r.cardId, r.text); trim(); }
    else if (r.t === 'card-edit') { lastKnown.set(r.cardId, r.after); if (text.has(r.cardId)) text.set(r.cardId, r.after); }
    else if (r.t === 'card-remove') drop(r.cardId);
    else if (r.t === 'card-restore') {
      for (const id of r.cardIds) if (!order.includes(id)) { order.push(id); text.set(id, lastKnown.get(id)); }
      trim();
    }
  }
  return order.map((id) => ({ id, text: text.get(id) }));
}

// The shortcut that reads as obviously equivalent and is not. Kept as a test subject rather than
// deleted, because the whole point is that it LOOKS right: it passed the first version of this test,
// which never interleaved a deletion with an overflow, which is why the bug survived a review.
function replayWallByEndSlice(records, displayCap) {
  const survivors = [];
  for (const r of records) {
    if (r.t === 'card') survivors.push(r.cardId);
    else if (r.t === 'card-remove') { const i = survivors.indexOf(r.cardId); if (i >= 0) survivors.splice(i, 1); }
    else if (r.t === 'card-restore') for (const id of r.cardIds) if (!survivors.includes(id)) survivors.push(id);
  }
  return survivors.slice(-displayCap);
}

test('the end-slice replay resurrects a trimmed card once a deletion follows an overflow', async () => {
  await withRuntimeHarness({ stateOverrides: baseState() }, async ({ ctx, runtime }) => {
    for (let i = 1; i <= 30; i += 1) runtime.addLine(`Card number ${i}.`);
    const cap = ctx.state.recordingQueue.find((r) => r.t === 'header').displayCap;
    // Delete a card that is genuinely on the wall, which is the ordinary operator action that breaks it.
    runtime.removeItem(ctx.state.transcriptItems[ctx.state.transcriptItems.length - 2].id);

    const wrong = replayWallByEndSlice(ctx.state.recordingQueue, cap);
    const right = replayWall(ctx.state.recordingQueue, cap);

    assert.notDeepEqual(wrong, right.map((c) => c.id), 'the shortcut and the real rule must genuinely disagree here');
    assert.equal(wrong.length, cap, 'the shortcut backfills to a full wall');
    assert.equal(right.length, cap - 1, 'the real wall is one card shorter: a trimmed card cannot come back');
  });
});

test('replaying reproduces the wall exactly across overflow interleaved with every way off it', async () => {
  await withRuntimeHarness({ stateOverrides: baseState() }, async ({ ctx, runtime }) => {
    const cap = () => ctx.state.recordingQueue.find((r) => r.t === 'header').displayCap;
    const check = (label) => {
      const wall = ctx.state.transcriptItems.slice(-cap()).map((i) => i.id);
      assert.deepEqual(replayWall(ctx.state.recordingQueue, cap()).map((c) => c.id), wall, label);
    };

    for (let i = 1; i <= 30; i += 1) runtime.addLine(`Card ${i}.`);
    check('after an overflow');

    runtime.removeItem(ctx.state.transcriptItems[2].id);
    check('after deleting a visible card post-overflow');

    runtime.updateItemText(ctx.state.transcriptItems[0].id, 'Corrected by hand.');
    check('after an in-place edit post-overflow');

    runtime.undoLine();
    check('after undoing the last card');

    runtime.addLine('A card that lands after all of that.');
    check('after a fresh card lands on a trimmed, edited, pruned wall');

    ctx.state.clearArmed = true;
    runtime.clearLines();
    check('after a clear');

    runtime.undoLine();
    check('after undoing the clear');
  });
});

// The third bug found in this one algorithm, and the third one my own test missed for the same
// reason: it compared ids to ids. Every card came back in the right ORDER and every one of them came
// back blank, and an id-only assertion cannot see the difference. So this one asserts on TEXT, and
// specifically on text that a human corrected, which is the whole reason the file exists.
test('a hand-corrected card survives a clear and an undo with its correction intact', async () => {
  await withRuntimeHarness({ stateOverrides: baseState() }, async ({ ctx, runtime }) => {
    runtime.addLine('Brother Ashcroft spoke about the sower.');
    runtime.addLine('The second card.');
    const correctedId = ctx.state.transcriptItems[0].id;
    runtime.updateItemText(correctedId, 'Brother Ashcraft spoke about the sower.');

    ctx.state.clearArmed = true;
    runtime.clearLines();
    runtime.undoLine();

    const cap = ctx.state.recordingQueue.find((r) => r.t === 'header').displayCap;
    const wall = replayWall(ctx.state.recordingQueue, cap);

    assert.equal(wall.length, 2, 'both cards are back on the wall');
    assert.equal(
      wall[0].text,
      'Brother Ashcraft spoke about the sower.',
      'the correction must survive: coming back as the ORIGINAL would be worse than coming back blank'
    );
    assert.equal(wall[1].text, 'The second card.');
    assert.ok(wall.every((c) => typeof c.text === 'string'), 'no restored card may come back with no text at all');

    // And the replayed wall matches what is genuinely on screen, text and all.
    assert.deepEqual(
      wall.map((c) => c.text),
      ctx.state.transcriptItems.slice(-cap).map((i) => i.text)
    );
  });
});
