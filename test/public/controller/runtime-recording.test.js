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

    assert.equal(ctx.state.recordingQueue.length, 1);
    const record = ctx.state.recordingQueue[0];
    assert.equal(record.t, 'chunk');
    assert.equal(record.mode, 'prayer');
    assert.equal(record.text, 'Please remember the Alvarez family.');
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
