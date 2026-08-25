import { appendUniqueChunk, normalizeText } from '../services/text.js';
import { createCardReleaseQueue } from '../services/card-release-queue.js';
import { chooseSummaryLevel } from '../services/summary-level.js';
import { RUNAWAY_LINE_GUARD, cleanModelLine, hasSubstantiveContent, isFillerLine, shouldAcceptModelLine } from '../services/summary-prompt.js';
import {
  appendTranscriptItems,
  createTranscriptItems,
  MAX_DISPLAY_ITEMS
} from '../services/transcript-display.js';
import {
  createSummarizationDriver,
  createTranscriptionDriver
} from '../services/registry.js';
import { fetchWithTimeout } from '../services/fetch-timeout.js';
import { getDefaultSummarizationSource } from '../services/catalog.js';
import {
  AUDIO_SETTINGS_KEYS,
  clampDisplayMargin,
  clampFontSize,
  clampFontFamily,
  clampFontWeight,
  clampSummaryIntervalSeconds,
  clampSummaryMaxWordsOverride
} from '../services/view-settings.js';
import {
  DEFAULT_MEDIAN_WPM,
  MARGINAL_CARD_WORDS_CEILING,
  READING_PACE_COMFORTABLE_SECONDS,
  USABLE_CARD_WORDS_FLOOR,
  medianWpmFromProfile,
  readingBudget,
  recommendSummaryIntervalSeconds,
  recommendWordsPerCard,
  usableIntervalFloor
} from '../services/reading-pace.js';
import {
  listAudioInputs,
  resolveDeviceId,
  describeLevels,
  stabilizeMeterDisplay,
  evaluateMicReadiness,
  isMicCalibrationValid,
  describeMicCalibration,
  MIC_CALIBRATION_MAX_AGE_MS
} from '../services/audio-monitor.js';
import { createMicProbe } from '../services/audio-processing.js';
import {
  flashRailNote,
  renderDisplay,
  setSettingsOpen,
  updateClearButton,
  updateModeButtons,
  updatePauseButton,
  updateSourceButtons,
  updateStatus,
  syncSettingsPanel,
  applyMeetingInProgressLock,
  syncViewerControls,
  setDisplayMarginGuidesVisible,
  updateSummaryIntervalControl,
  updateSummaryMaxWordsControl,
  renderProgramPanel,
  updateSpeakerDatalist
} from './view.js';
import {
  BUCKET_SETTLE_MS,
  TERMINAL_END,
  bucketText,
  isPassthroughEligible,
  partitionBucket,
  removeConsumed,
  takeOldestModeRun,
  trimBucket
} from '../services/transcript-bucket.js';
import { clearDisplayMarginGuideTimer, flashDisplayMarginGuides } from './margin-guides.js';
import { saveViewerSettings } from './view-settings-sync.js';
import {
  isProviderConfigured,
  isSourceConfigured
} from './provider-availability.js';
import {
  buildChunkRecord,
  buildSummaryRecord,
  buildHeaderRecord,
  buildManualLineRecord,
  buildCardRecord,
  buildCardEditRecord,
  buildCardRemoveRecord,
  buildCardRestoreRecord
} from '../services/session-recording.js';
import { computeSummaryPromptHash } from '../services/summary-prompt-minimal.js';
import { normalizeReplaySpeed } from '../services/transcription/replay.js';

const STORAGE = {
  fontSize: 'fontSize',
  displayMargin: 'displayMargin',
  fontFamily: 'fontFamily',
  fontWeight: 'fontWeight',
  summaryInterval: 'summaryIntervalSeconds',
  summaryMaxWords: 'summaryMaxWords',
  // A POINTER, not the measurement itself (issue #44): the measured pace stays on disk under
  // reader-profiles/, gitignored, loopback-only, same as recordings/. This is only the NAME of the
  // profile to auto-apply on the next start, the same shape as replayRecordingId a few keys down
  // (a browser-local pointer at server-side data), which is why it is safe in localStorage where the
  // measurement itself would not be. Must stay in sync with start-app.js's own STORAGE map -- same
  // gotcha as summarizationSourceChosen above.
  readingPaceProfileName: 'readingPaceProfileName',
  transcriptionSource: 'transcriptionSource',
  summarizationSource: 'summarizationSource',
  // Must stay in sync with start-app.js's own STORAGE map, which is a separate object listing the
  // same keys. This one was missing, so setSummarizationSource called
  // localStorage.setItem(undefined, 'true') -- writing a key literally named "undefined" -- and an
  // operator's explicit provider choice silently failed to survive a reload. Unit tests passed
  // because they stub localStorage and never assert the key name. Add to BOTH maps or neither.
  summarizationSourceChosen: 'summarizationSourceChosen',
  audioProcessingPreset: 'audioProcessingPreset',
  audioHighPassEnabled: 'audioHighPassEnabled',
  audioHighPassHz: 'audioHighPassHz',
  audioCompressorEnabled: 'audioCompressorEnabled',
  audioLimiterEnabled: 'audioLimiterEnabled',
  audioBrowserAgc: 'audioBrowserAgc',
  audioBrowserNoiseSuppression: 'audioBrowserNoiseSuppression',
  audioBrowserEchoCancel: 'audioBrowserEchoCancel',
  audioConditioningEnabled: 'audioConditioningEnabled',
  audioDeviceId: 'audioDeviceId',
  // Must stay in sync with start-app.js's own STORAGE map -- same gotcha this file's comment above
  // already documents for summarizationSourceChosen.
  recordingEnabled: 'recordingEnabled',
  // Replay transcription source (GitHub issue #3). Must stay in sync with start-app.js's own
  // STORAGE map -- same gotcha as summarizationSourceChosen above.
  replayRecordingId: 'replayRecordingId',
  replaySpeed: 'replaySpeed'
};

const CLEAR_ARM_TIMEOUT_MS = 3000;

// Floor between two summarize calls triggered by chunk ARRIVAL rather than by the interval (#31).
// Without it, a stretch of speech that keeps returning no useful line buys one provider call per
// chunk, because nothing has set firstCardShown yet.
const ARRIVAL_SUMMARIZE_MIN_GAP_MS = 3000;

// How long one card holds the wall before the next one from the same summarize result goes up.
// Not tied to the summarize interval on purpose: that setting controls how often we ASK the model
// for text, this controls how fast a reader is asked to absorb it. They answer different questions
// and coupling them would make the words-per-card and interval sliders fight each other.
const CARD_RELEASE_INTERVAL_MS = 5000;
// How long the recorder waits before writing records queued while the summarize loop is NOT running
// (#138). Long enough that a run of typed cards batches into one write, short enough that closing
// the tab shortly after Stop still finds the closing summary already on disk.
const UNLOOPED_RECORDING_FLUSH_MS = 1200;
// The cross-call dedupe window, derived rather than picked: it has to hold at least everything a
// single call can return, or a card falls out of it before the next call is even made (#61).
const DEDUPE_WINDOW_LINES = RUNAWAY_LINE_GUARD;
const UNDO_STATUS_MAX_CHARS = 40;

// How far back the model is shown what was already said and already summarized (Steve, 2026-08-09).
// A fixed turn count reaches back minutes in a slow stretch and anchors the model on a topic the
// conversation has already left; a live meeting's topic shifts, and this is meant to reflect "what
// have we covered very recently", not "what has this speaker ever said".
const SUMMARY_HISTORY_WINDOW_MS = 60000;

// How often the watchdog re-checks the gap since the last transcript event (partial or final).
const SILENCE_CHECK_INTERVAL_MS = 5000;
// Threshold chosen deliberately generous, not aggressive: this room includes long sermon pauses
// and reflective silence during prayer, both entirely normal, and a false "something's wrong"
// alarm fired into the middle of a moment of silence would itself be a harm (the opposite failure
// this steward exists to prevent). 45 seconds with zero transcript events -- no partial, no final
// -- is long enough that it is no longer plausibly just a pause in speech, and short enough that a
// genuinely unplugged mic or a silently-crashed speech engine is caught within under a minute
// instead of running the rest of the service showing a calm, wrong "Listening."
const SILENCE_WATCHDOG_MS = 45000;

// Steve's ruling (2026-07-30): a period should be inserted after silence with no new transcript
// event. Chrome's Web Speech API frequently never punctuates an utterance at all, so without this,
// partitionBucket's own punctuation rule holds the newest chunk hostage for the full
// BUCKET_SETTLE_MS (20s) -- which loses text mid-meeting, not just at Stop, because the NEXT final
// chunk arrives and appears to start a fresh sentence while the unpunctuated tail from before it
// is still sitting unsent. "No audio" is not observable on the Chrome path (it exposes no levels
// for its own internal mic), so the trigger is "no new recognition event of any kind, partial or
// final" -- Chrome emits partials continuously while it hears speech, so absence of events is a
// sound proxy for silence there.
//
// 2026-08-09: raised from 3000 to 6000 after this same timer misfired on the VAD/OpenAI path. That
// path's own chunk boundary (redemptionMs: 2500 in transcription/openai.js) already fires on a
// natural mid-sentence breath, so the timer's clock was starting from a chunk that was never the
// end of the sentence -- a ~2.5s pause to speak plus ~3s more of nothing (about 5.5s total) was
// enough to fabricate a period mid-thought. One shared threshold, not a per-source one, per Steve:
// 6s costs Chrome a little extra latency on a real sentence end, but on the VAD path it means
// roughly 8.5s of genuine silence (2.5s redemption + 6s here) before a period gets inferred,
// comfortably past a normal thinking pause.
export const SENTENCE_END_SILENCE_MS = 6000;

// Poll cadence for the sentence-end check above -- deliberately finer than
// SILENCE_CHECK_INTERVAL_MS's 5s, since a 3s trigger polled only every 5s would frequently fire
// 2-8s late. Bundled into the SAME start/stop lifecycle as the silence watchdog
// (startSilenceWatchdog/stopSilenceWatchdog) rather than given its own start/stop call sites, so
// there is exactly one place that decides "we are live and should be watching the event stream,"
// not two watchdogs that could independently drift out of sync about whether they are running.
const SENTENCE_END_CHECK_INTERVAL_MS = 500;

// ~20Hz, matching the conditioner's own measurement cadence (audio-processing.js) -- fast enough
// to read as live, not so fast it burns cycles on a settings pane nobody is actively watching.
const AUDIO_LEVEL_METER_INTERVAL_MS = 50;

function truncateForStatus(text, maxChars = UNDO_STATUS_MAX_CHARS) {
  const clean = typeof text === 'string' ? text : '';
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean;
}

// Per-device ambient calibration storage (backlog #7/#10). Keyed by deviceId rather than folded
// into the STORAGE map above: it is a measurement with its own expiry (isMicCalibrationValid /
// MIC_CALIBRATION_MAX_AGE_MS), not a fixed operator preference, so one entry per device rather than
// one entry total. Never stores audio, only the small dBFS numbers computeNoiseGate produced
// (ADR-0003/INV-8 only bars audio/transcript content, not a measurement like this).
function micCalibrationStorageKey(deviceId) {
  return `micCalibration:${deviceId || 'default'}`;
}

function readStoredMicCalibration(deviceId) {
  try {
    const raw = localStorage.getItem(micCalibrationStorageKey(deviceId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredMicCalibration(deviceId, calibration) {
  try {
    if (!calibration) {
      localStorage.removeItem(micCalibrationStorageKey(deviceId));
      return;
    }
    localStorage.setItem(micCalibrationStorageKey(deviceId), JSON.stringify(calibration));
  } catch {
    // Best-effort only; a private-browsing quota error must never break the mic test.
  }
}

function transcriptionStatusLevel(text) {
  const clean = String(text || '');
  // Transient browser blips (no-speech, aborted) surface as "Speech recognition
  // error: ..." while listening keeps running, so they must not raise a problem.
  // Fatal cases use different phrasing ("Browser transcription stopped after
  // speech recognition error: ...", "Microphone stopped. ...").
  if (/^Speech recognition error:/i.test(clean)) return undefined;
  return /error|microphone stopped/i.test(clean) ? 'problem' : undefined;
}

export function createRuntime(ctx, deps = {}) {
  let transcriptionDriver = null;
  let summarizationDriver = null;
  let clearArmTimer = null;
  let micProbe = null;
  let micLevelTimer = null;
  let micCalibration = null;
  // Carries stabilizeMeterDisplay()'s opaque state between ticks (dwell/debounce/peak-hold timers).
  // Reset to null on every probe (re)start and on stop so a new test never inherits a stale latch.
  let meterStabilizerState = null;
  const {
    createTranscriptionDriverFn = createTranscriptionDriver,
    createSummarizationDriverFn = createSummarizationDriver,
    createMicProbeFn = createMicProbe,
    fetchImpl = fetch,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    nowFn = Date.now,
    documentImpl = globalThis.document,
    mediaDevicesImpl = globalThis.navigator?.mediaDevices,
    // Safari (as of this writing) has no permissions.query support for 'microphone' at all --
    // refreshMicReadiness's own try/catch is the defensible-degradation path for that; this dep
    // just makes it fakeable in a test.
    permissionsImpl = globalThis.navigator?.permissions,
    // Deliberately separate from documentImpl: that dependency doubles as a feature-detection
    // flag elsewhere (renderRailTranscript's `documentImpl?.createElement && ...`), so widening it
    // to support <option> creation would change unrelated behavior. This one dependency exists
    // only to make an <option> node, real or faked.
    createOptionElementFn = () => globalThis.document?.createElement('option')
  } = deps;

  function clearPendingSelection(provider) {
    if (ctx.state.pendingProviderSelection?.provider === provider) {
      ctx.state.pendingProviderSelection = null;
    }
  }

  function applyPendingSelection(provider) {
    const pending = ctx.state.pendingProviderSelection;
    if (!pending || pending.provider !== provider) return;
    ctx.state.pendingProviderSelection = null;
    if (pending.kind === 'transcription') {
      setTranscriptionSource(pending.source);
    } else if (pending.kind === 'summarization') {
      setSummarizationSource(pending.source);
    }
  }

  function openSettingsForProvider(provider, kind) {
    if (provider === 'browser') return updateStatus(ctx, 'Browser speech recognition is not available in this browser.');
    ctx.state.registrationProvider = provider;
    setSettingsOpen(ctx, true);
    refreshMicReadiness();
    globalThis.requestAnimationFrame?.(() => {
      const target = ctx.dom.serviceRegistrationKeyInput;
      target?.focus?.();
      target?.select?.();
    });
  }

  function commitItems(items) {
    // Recorded from the RESULT of the append, never from `items` (#142): appendTranscriptItems drops
    // an item whose text repeats the card above it, so recording the input would claim the reader saw
    // a card that was never put in front of them -- a lie in the one file that exists to say what
    // they saw.
    // Guarded the same way appendTranscriptItems guards its own input, and not because a non-array
    // is expected here. This is recorder code, and ADR-0004's "never damages a meeting" covers the
    // recorder's SHAPING, not only its network write: an unguarded .map here would throw out through
    // commitItems into addLine, where the release queue's pump has already nulled its timer and only
    // reschedules AFTER onRelease -- so one throw stops card release permanently and every pending
    // card is lost. Every other line of recorder code sits inside queueRecord's try; this one cannot.
    const previous = Array.isArray(ctx.state.transcriptItems) ? ctx.state.transcriptItems : [];
    const landedBefore = new Set(previous.map((item) => item?.id));
    const next = appendTranscriptItems(ctx.state.transcriptItems, items);
    setTranscriptItems(next);
    for (const item of next) {
      if (landedBefore.has(item.id)) continue;
      queueRecord(() => buildCardRecord({
        at: nowFn(),
        cardId: item.id,
        mode: item.mode,
        speaker: item.speaker,
        source: item.source,
        text: item.text,
        isHeader: item.isHeader
      }));
    }
    renderDisplay(ctx);
    showRecentTranscript();
  }

  // A live summarize call is one card per call now (2026-08-10: no mode packs several thoughts into
  // several cards any more), but a backlog flush (Stop, a mode change) can still hand over several
  // SEPARATE calls' single cards at once, and dropping all of them on the wall in the same frame
  // costs a slow reader their place -- the exact thing the display exists to protect. `paced` hands
  // them to the release queue instead, one every CARD_RELEASE_INTERVAL_MS. A multi-line string
  // still splits into one item per line here too, for manual multi-line paste -- that path is the
  // operator's own text, not the summarizer's, and is unaffected by the one-card-per-call rule.
  //
  // Manual lines are never paced: the operator typed that and pressed Show now, so it shows now.
  const cardReleaseQueue = createCardReleaseQueue({
    intervalMs: CARD_RELEASE_INTERVAL_MS,
    onRelease: (item) => commitItems([item]),
    setTimeoutFn,
    clearTimeoutFn
  });

  // `speaker` defaults to whatever the operator has typed right now -- captured at THIS call, not
  // read again later. That default is correct for a manual line (typed and shown in the same
  // instant) and for a live AI line whose caller passes the mode/speaker actually captured on the
  // chunk explicitly (see runSummarizeCurrentText's sendSpeaker), the same precedent `mode` already
  // follows for a backlogged card.
  // Whether a newly captured chunk should be summarized immediately rather than waiting for the
  // interval (#31, generalized by #106). Three conditions, and the second two are why the first is
  // not enough on its own.
  //
  // Found by Cato before this shipped: gating on firstCardShown ALONE bypassed the summarize backoff
  // completely. effectiveIntervalSeconds is how a failing provider gets backed off, and it is consumed
  // only by startLoop, so it lengthens the INTERVAL and can do nothing about a call triggered by a
  // chunk arriving. With a provider down at meeting start, that meant one call per speech chunk,
  // several a minute, for the whole outage, while a deliberate 30 second backoff sat there unused.
  //
  // The elapsed floor covers the healthy version of the same thing: pre-meeting chatter that keeps
  // returning "no new useful line" never sets the flag, so every barren chunk bought its own call.
  //
  // #106: the same empty-wall problem #31 solved once at meeting start also happens on every speaker
  // change, since startLoop's interval is untouched by a mode change and keeps its own schedule.
  // awaitingNewSpeakerArrival opens this same gate again without touching firstCardShown's own
  // meaning (whether the WALL is empty) -- a speaker change does not clear the wall, it just means
  // the newest person deserves the same fast turnaround the very first speaker got. Deliberately NOT
  // a stop-the-loop-and-restart-it design: an earlier attempt at that for #31 forced the progress bar
  // to either lie about its sweep or flicker, caught by four tests at the time. This stays additive,
  // same as #31 -- the interval loop never notices any of this and remains the backstop.
  function shouldSummarizeOnArrival() {
    if (ctx.state.firstCardShown && !ctx.state.awaitingNewSpeakerArrival) return false;
    // Already backing off a failing provider: the interval is the backstop, let it be the backstop.
    if (ctx.state.effectiveIntervalSeconds) return false;
    const since = nowFn() - (ctx.state.lastArrivalSummarizeAt || 0);
    return since >= ARRIVAL_SUMMARIZE_MIN_GAP_MS;
  }

  function addLine(line, { source = 'manual', mode = ctx.state.mode, speaker = ctx.state.speakerName, paced = false, isHeader = false } = {}) {
    // Normalized PER LINE, not across the whole string. normalizeText collapses /\s+/ to a single
    // space, which includes the newlines the server uses to separate cards -- so running it over
    // the whole reply flattened a multi-card result into one card before createTranscriptItems
    // (whose AI path splits on newlines and nothing else) ever saw the breaks. Latent since
    // multi-line replies were introduced: information mode's three announcements have been
    // arriving as a single run-on card. Found 2026-08-02 while pacing testimony cards.
    const clean = String(line || '')
      .split(/\r?\n/)
      .map((part) => normalizeText(part))
      .filter(Boolean)
      .join('\n');
    if (!clean) return false;
    const nextItems = createTranscriptItems({
      text: clean,
      mode,
      source,
      speaker,
      isHeader
    });
    if (!nextItems.length) return false;
    // #135: everything the operator types by hand ("Show now", a program header send, the fixed
    // "Music is playing." line) funnels through here and left NO trace in the recording -- the two
    // chunk call sites are both fed by transcription-driver events and the summary ones by the
    // provider, so the one class of card guaranteed to be correct was the one class never written
    // down. Recorded after the early returns, so a record means a card actually landed, and only
    // for source === 'manual': an AI line already has its own summary record and would otherwise be
    // written twice under two different shapes.
    if (source === 'manual') {
      queueRecord(() => buildManualLineRecord({ at: nowFn(), mode, text: clean, speaker, isHeader }));
    }
    // Queued even for a single card when cards are already waiting, or a later result would
    // overtake an earlier one and the testimony would come out of order.
    if (paced && (nextItems.length > 1 || cardReleaseQueue.pendingCount() > 0)) {
      cardReleaseQueue.enqueue(nextItems);
      return true;
    }
    commitItems(nextItems);
    return true;
  }

  // Any assignment that can leave transcriptItems empty routes through here, rather than resetting
  // firstCardShown at each call site. Ansel's framing, which holds regardless of how it is solved:
  // this is not about the first line of a meeting, it is about any moment the card area is blank
  // while speech is being heard (#31, #77 — undo emptying the wall one card at a time missed this
  // when the reset lived only in clearLines).
  function setTranscriptItems(items) {
    ctx.state.transcriptItems = items;
    if (!items.length) ctx.state.firstCardShown = false;
  }

  function undoLine() {
    if (!ctx.state.transcriptItems.length && ctx.state.lastClearedItems) {
      const restored = ctx.state.lastClearedItems;
      setTranscriptItems(restored);
      ctx.state.lastClearedItems = null;
      queueRecord(() => buildCardRestoreRecord({ at: nowFn(), cardIds: restored.map((item) => item.id) }));
      renderDisplay(ctx);
      const lineWord = restored.length === 1 ? 'line' : 'lines';
      flashRailNote(ctx, `Restored ${restored.length} ${lineWord}.`, { setTimeoutFn, clearTimeoutFn });
      return;
    }
    const removed = ctx.state.transcriptItems[ctx.state.transcriptItems.length - 1];
    setTranscriptItems(ctx.state.transcriptItems.slice(0, -1));
    if (removed) {
      queueRecord(() => buildCardRemoveRecord({ at: nowFn(), cardId: removed.id, text: removed.text, via: 'undo' }));
    }
    renderDisplay(ctx);
    if (removed) {
      const text = `Removed: "${truncateForStatus(removed.text)}"`;
      updateStatus(ctx, text);
      flashRailNote(ctx, text, { setTimeoutFn, clearTimeoutFn });
    }
  }

  // One card, by id, from the per-card delete button -- distinct from undoLine (always the last
  // card) and clearLines (everything, arm-confirmed). No undo of its own: the operator just clicked
  // a button on the exact card they meant to remove, so there is nothing to confirm.
  function removeItem(id) {
    const index = ctx.state.transcriptItems.findIndex((item) => item.id === id);
    if (index === -1) return;
    const [removed] = ctx.state.transcriptItems.splice(index, 1);
    queueRecord(() => buildCardRemoveRecord({ at: nowFn(), cardId: removed.id, text: removed.text, via: 'delete' }));
    renderDisplay(ctx);
    const text = `Removed: "${truncateForStatus(removed.text)}"`;
    updateStatus(ctx, text);
    flashRailNote(ctx, text, { setTimeoutFn, clearTimeoutFn });
  }

  // Click-to-edit-in-place (#125): the operator hand-corrects a card's text via contenteditable
  // directly on the card, and start-app.js's focusout handler calls this with the sanitized result.
  // Deliberately does NOT re-run segmentTranscriptText/segmentAiResponseText on the corrected text --
  // re-segmenting a hand-corrected card risks silently re-splitting/re-merging it into different
  // cards than the one the operator just edited. Also deliberately does NOT call renderDisplay: the
  // edit is already visually correct on screen (the operator typed it directly into the DOM node),
  // and renderDisplay's fast path (view.js, previousIsPrefix) skips any item whose id already
  // rendered, so calling it here would silently no-op the very update this function exists to make.
  // Only ctx.state needs to sync, so a FUTURE full rebuild (a new card arriving) doesn't clobber the
  // edit with stale text.
  function updateItemText(id, text) {
    const item = ctx.state.transcriptItems.find((entry) => entry.id === id);
    if (!item) return;
    const before = item.text;
    item.text = text;
    // A focusout fires whether or not anything was typed, so an unchanged commit is the common case,
    // not the edge one. Recording it would fill the file with edits that changed nothing.
    if (before === text) return;
    queueRecord(() => buildCardEditRecord({ at: nowFn(), cardId: id, before, after: text }));
  }

  function armClear() {
    ctx.state.clearArmed = true;
    updateClearButton(ctx);
    clearTimeoutFn(clearArmTimer);
    clearArmTimer = setTimeoutFn(() => {
      clearArmTimer = null;
      disarmClear();
    }, CLEAR_ARM_TIMEOUT_MS);
  }

  function disarmClear() {
    clearTimeoutFn(clearArmTimer);
    clearArmTimer = null;
    if (!ctx.state.clearArmed) return;
    ctx.state.clearArmed = false;
    updateClearButton(ctx);
  }

  function cancelClearArm() {
    disarmClear();
  }

  function clearLines() {
    if (!ctx.state.clearArmed) {
      armClear();
      return;
    }

    disarmClear();
    const outgoing = ctx.state.transcriptItems;
    if (!outgoing.length) {
      updateStatus(ctx, 'Nothing to clear.');
      return;
    }
    ctx.state.lastClearedItems = outgoing;
    // One record per card rather than one listing them all, so a replay applies removals the same
    // way whatever route they came off the wall by. Clear is rare enough that the extra lines cost
    // nothing, and a uniform stream is what keeps the replay honest.
    for (const item of outgoing) {
      queueRecord(() => buildCardRemoveRecord({ at: nowFn(), cardId: item.id, text: item.text, via: 'clear' }));
    }
    setTranscriptItems([]);
    // Anything still queued belongs to what was just cleared. Without this it would arrive a few
    // seconds later on a screen the operator deliberately emptied.
    cardReleaseQueue.clear();
    ctx.state.summaryHistory = [];
    renderDisplay(ctx);
    const lineWord = outgoing.length === 1 ? 'line' : 'lines';
    const text = `Cleared ${outgoing.length} ${lineWord} — press U or click Undo to bring them back.`;
    updateStatus(ctx, text);
    flashRailNote(ctx, text, { setTimeoutFn, clearTimeoutFn });
  }

  // INV-13: trimBucket only ever drops the oldest speech once the bucket has actually overflowed
  // BUCKET_MAX_CHARS -- which, with the per-tick send cap gone, only happens during a sustained
  // summarizer outage (the bucket otherwise drains every tick via removeConsumed). That makes an
  // actual trim the ONLY moment speech is silently lost, and exactly the moment the operator most
  // needs to know it happened, not just suspect it. Comparing chunk counts before/after -- rather
  // than reading any internal state off trimBucket -- keeps this honest even if trimBucket's own
  // implementation changes later: it only ever fires on an observed drop, never a guess.
  function noteSpeechDropped(droppedChunkCount) {
    const chunkWord = droppedChunkCount === 1 ? 'chunk' : 'chunks';
    updateStatus(
      ctx,
      `Speech dropped: the transcript buffer filled and the oldest ${droppedChunkCount} ${chunkWord} of speech were discarded before being summarized.`,
      { level: 'dropped' }
    );
  }

  // Mirrors noteTranscriptActivity's wasSilent recovery guard: only recover the rail to a plain
  // status if THIS condition is the one actually showing (ctx.state.railStatusLevel IS the source
  // of truth -- no separate "active" flag to fall out of sync with it). Without that check,
  // recovering after a higher-ranked persistent condition (e.g. a fatal 'problem') has since taken
  // over the rail would wrongly clobber it back to "Listening." the moment the summarizer
  // succeeds again.
  function clearSpeechDroppedAlert() {
    if (ctx.state.railStatusLevel !== 'dropped') return;
    const recoveredLevel = activeTranscriptionStatusLevel();
    updateStatus(ctx, recoveredLevel === 'listening' ? 'Listening.' : 'Manual mode.', {
      level: recoveredLevel
    });
  }

  // In-flight text is text that has been handed to the summarizer but NOT yet removed from the
  // bucket -- it only leaves ctx.state.transcriptChunks on a successful response (INV-11). Dimming
  // it here, rather than removing it early, is what makes that invariant visible to the operator:
  // if the call fails or pause interrupts it, the same chunks un-dim on the very next render
  // because inFlightChunks is cleared in summarizeCurrentText's `finally` (every exit path, success
  // included) and nothing here treats "in flight" as "gone." No second source of truth -- the match
  // below is keyed on `at` + a text-prefix check, the exact same rule removeConsumed itself uses, so
  // this can never disagree with what the bucket will actually drain.
  function inFlightPrefixLength(chunk) {
    const hit = (ctx.state.inFlightChunks || []).find(
      (item) => item.at === chunk.at && chunk.text.startsWith(item.text)
    );
    return hit ? hit.text.length : 0;
  }

  function renderRailTranscript(container, chunks, preview) {
    container.textContent = '';
    chunks.forEach((chunk, index) => {
      const text = normalizeText(chunk.text);
      if (!text) return;
      const dimLength = inFlightPrefixLength(chunk);
      if (index > 0) container.appendChild(documentImpl.createTextNode(' '));
      if (dimLength > 0) {
        const dimmed = documentImpl.createElement('span');
        dimmed.className = 'transcriptChunk--inFlight';
        dimmed.textContent = text.slice(0, dimLength);
        container.appendChild(dimmed);
        const rest = normalizeText(text.slice(dimLength));
        if (rest) container.appendChild(documentImpl.createTextNode(' ' + rest));
      } else {
        container.appendChild(documentImpl.createTextNode(text));
      }
    });
    if (preview) {
      if (chunks.length) container.appendChild(documentImpl.createTextNode(' '));
      container.appendChild(documentImpl.createTextNode(preview));
    }
  }

  function showRecentTranscript() {
    const beforeTrim = ctx.state.transcriptChunks;
    const trimmed = trimBucket(beforeTrim);
    if (trimmed.length < beforeTrim.length) {
      noteSpeechDropped(beforeTrim.length - trimmed.length);
    }
    ctx.state.transcriptChunks = trimmed;
    const preview = bucketText(ctx.state.transcriptChunks, ctx.state.transcriptPreview);
    if (ctx.dom.liveTranscript) {
      ctx.dom.liveTranscript.textContent = preview;
    }
    if (ctx.dom.railTranscript) {
      if (documentImpl?.createElement && ctx.state.inFlightChunks?.length) {
        renderRailTranscript(
          ctx.dom.railTranscript,
          ctx.state.transcriptChunks,
          normalizeText(ctx.state.transcriptPreview)
        );
      } else {
        ctx.dom.railTranscript.textContent = preview;
      }
      if (typeof ctx.dom.railTranscript.scrollHeight === 'number') {
        ctx.dom.railTranscript.scrollTop = ctx.dom.railTranscript.scrollHeight;
      }
    }
  }

  function noteTranscriptActivity() {
    const wasSilent = ctx.state.railStatusLevel === 'silence';
    ctx.state.lastTranscriptEventAt = nowFn();
    if (wasSilent) {
      // The watchdog fired; an event just arrived, so the alarm is over. Recover to the plain
      // "Listening" status rather than leaving the gentler "Check mic" note stuck on screen.
      updateStatus(ctx, 'Listening.', { level: 'listening' });
    }
  }

  function scheduleSilenceCheck() {
    ctx.state.silenceWatchdogTimer = setTimeoutFn(checkSilence, SILENCE_CHECK_INTERVAL_MS);
    ctx.state.silenceWatchdogTimer?.unref?.();
  }

  function checkSilence() {
    // Never fires while paused, stopped, or in manual mode -- only while actually listening.
    if (!ctx.state.listening || ctx.state.paused) return;
    const lastEventAt = ctx.state.lastTranscriptEventAt || nowFn();
    const elapsed = nowFn() - lastEventAt;
    if (elapsed >= SILENCE_WATCHDOG_MS && ctx.state.railStatusLevel !== 'silence') {
      updateStatus(
        ctx,
        'No transcript activity for 45s. Check the microphone is unmuted, this tab is not muted, and it is pointed at the speaker -- or switch to manual lines.',
        { level: 'silence' }
      );
    }
    scheduleSilenceCheck();
  }

  function scheduleSentenceEndCheck() {
    ctx.state.sentenceEndTimer = setTimeoutFn(checkSentenceEndSilence, SENTENCE_END_CHECK_INTERVAL_MS);
    ctx.state.sentenceEndTimer?.unref?.();
  }

  // Punctuates the newest transcript chunk once SENTENCE_END_SILENCE_MS has passed with no new
  // recognition event (partial or final) -- see the constant's own comment above for the why.
  // Deliberately does NOT touch BUCKET_SETTLE_MS or partitionBucket's punctuation rule: this only
  // makes chunks legitimately end in terminal punctuation so that existing rule fires on them
  // exactly as it would for a sentence Chrome punctuated itself.
  //
  // Idempotent by construction, not by a separate flag: once this appends ".", the very next call
  // sees a chunk that already matches TERMINAL_END and returns before touching it again -- the
  // same test partitionBucket itself uses, so this can never disagree with what "already ended"
  // means there.
  function checkSentenceEndSilence() {
    // Mirrors checkSilence's own guard exactly (never fires while paused or stopped). Deliberately
    // has no separate replay/live check: startSilenceWatchdog -- which is the only place this timer
    // is scheduled -- is itself only ever called once the driver has confirmed it is a live
    // capture, so a replay session never starts this timer in the first place, and no fabricated
    // sentence end can leak into replayed/recorded data.
    if (!ctx.state.listening || ctx.state.paused) return;
    scheduleSentenceEndCheck();

    const chunks = ctx.state.transcriptChunks;
    const newest = chunks[chunks.length - 1];
    if (!newest) return;
    const text = normalizeText(newest.text);
    if (!text || TERMINAL_END.test(text)) return;

    const lastEventAt = ctx.state.lastTranscriptEventAt || nowFn();
    if (nowFn() - lastEventAt < SENTENCE_END_SILENCE_MS) return;

    const endedText = `${text}.`;
    ctx.state.transcriptChunks = [...chunks.slice(0, -1), { ...newest, text: endedText }];
    // Debugging/tuning recorder (ADR-0004): a SECOND record for the same chunk id, not a rewrite of
    // the first -- the original buildChunkRecord already queued in handleTranscriptEvent stays
    // byte-verbatim to what was actually spoken. This follow-up record shares that id (so a reader
    // can tie the two together) and is marked `inferred: true` so nobody mistakes the appended
    // period for something the speaker said.
    queueRecord(() => buildChunkRecord({ at: newest.at, mode: newest.mode, speaker: newest.speaker, text: endedText, inferred: true }));
    showRecentTranscript();
  }

  function startSilenceWatchdog() {
    stopSilenceWatchdog();
    ctx.state.lastTranscriptEventAt = nowFn();
    scheduleSilenceCheck();
    scheduleSentenceEndCheck();
  }

  function stopSilenceWatchdog() {
    clearTimeoutFn(ctx.state.silenceWatchdogTimer);
    ctx.state.silenceWatchdogTimer = null;
    clearTimeoutFn(ctx.state.sentenceEndTimer);
    ctx.state.sentenceEndTimer = null;
  }

  function forgiveSilenceGap() {
    // Called when a backgrounded tab regains visibility: the throttled interval just produced a
    // real gap that was never a genuine outage, so the watchdog must not use it against the
    // operator by firing "no transcript activity" the moment the tab wakes back up.
    ctx.state.lastTranscriptEventAt = nowFn();
  }

  function handleVisibilityChange() {
    if (documentImpl?.hidden) return;
    if (!ctx.state.listening || ctx.state.paused) return;
    forgiveSilenceGap();
    // Background-tab throttling (~1/min) means the summarize loop drifted; resync it now that the
    // page is foregrounded again instead of silently continuing to keep up at the throttled rate.
    startLoop();
  }

  documentImpl?.addEventListener?.('visibilitychange', handleVisibilityChange);
  // A mic unplugged/replugged mid-session is exactly the moment the Ready check row must stop
  // lying -- devicechange is the only event that fires for that without polling.
  mediaDevicesImpl?.addEventListener?.('devicechange', refreshMicReadiness);

  function handleTranscriptEvent(event) {
    if (!event?.text) return;
    noteTranscriptActivity();

    if (event.type === 'final') {
      // Tag the chunk with the mode active right now, when the words were actually captured --
      // not whatever mode happens to be selected later when this backlogged text is finally
      // summarized. Reading ctx.state.mode at summarize time let backlogged Information-mode
      // announcements drain and get labelled as Speaker once the operator had since switched modes.
      const capturedAt = nowFn();
      // Read once and reused for both the bucket chunk and its recorded twin below, so the two can
      // never disagree about which mode/speaker the words were captured under. Same reasoning as
      // capturedMode, for the same reason (issue #40): a backlogged chunk must keep the speaker who
      // was actually talking when it was captured, not whoever the operator has since retyped.
      const capturedMode = ctx.state.mode;
      const capturedSpeaker = ctx.state.speakerName;
      const beforeLength = ctx.state.transcriptChunks.length;
      ctx.state.transcriptChunks = appendUniqueChunk(ctx.state.transcriptChunks, event.text, capturedAt, capturedMode, capturedSpeaker);
      ctx.state.transcriptPreview = '';
      // Debugging/tuning recorder (ADR-0004): only queue a record when appendUniqueChunk actually
      // appended one -- it silently no-ops on an exact-duplicate final, and recording a chunk that
      // was never added to the bucket would desync the correlation key from what summarizeCurrentText
      // actually consumes. Uses the SAME capturedAt/capturedMode/capturedSpeaker the bucket chunk
      // itself was tagged with, so the recorded id always matches the bucket's own.
      if (ctx.state.transcriptChunks.length > beforeLength) {
        queueRecord(() => buildChunkRecord({ at: capturedAt, mode: capturedMode, speaker: capturedSpeaker, text: event.text }));
        // While the wall is still empty, don't make him wait out an interval for a card (#31).
        //
        // Steve's call, 2026-08-04: "the interval timer does not start until after the first release
        // from the summarizer... that way we get an initial summary, not verbatim, it fits the required
        // length, gives something right away". At his honest 20s interval the reader watched a blank
        // screen for up to 20 seconds after the meeting had started, with no way to tell the app was
        // working, while speech sat in the bucket waiting on a clock.
        //
        // Deliberately ADDITIVE: the interval loop is untouched and remains the backstop, so if this
        // path ever fails to fire, cards still arrive on the normal schedule. An earlier attempt made
        // the loop itself poll fast until the first card, which forced the progress bar either to lie
        // about a 20s sweep or to flicker every poll -- four existing tests caught that, correctly.
        //
        // Nothing about WHAT is shown changes: same prompt, same level, same word budget. It is the
        // same card, sooner, which is why it needed no readability ruling (unlike the verbatim first
        // line this card originally asked for, which Ansel blocked). partitionBucket still decides
        // what is safe to send, so this cannot summarize half a sentence: it either finds a complete
        // run or does nothing.
        if (shouldSummarizeOnArrival()) {
          ctx.state.lastArrivalSummarizeAt = nowFn();
          // Consumed here, not inside the predicate: a call skipped by the backoff guard above must
          // leave this open so the NEXT chunk still gets the fast path once the provider recovers.
          ctx.state.awaitingNewSpeakerArrival = false;
          void summarizeCurrentText();
        }
      }
    } else if (event.type === 'partial') {
      ctx.state.transcriptPreview = normalizeText(event.text);
    }

    showRecentTranscript();
  }

  // Pulls the nine ctx.state.audio* values into the plain object the driver expects, keyed from
  // AUDIO_SETTINGS_KEYS (view-settings.js) rather than a fourth hand-typed literal -- three copies
  // of these key names already exist (AUDIO_SETTINGS_DEFAULTS, and the two STORAGE maps in this
  // file and start-app.js) and a name added to one but not the others is exactly the defect class
  // Cato's gate caught upstream (summarizationSourceChosen, 2026-07-xx).
  function buildAudioSettings() {
    const settings = {};
    for (const key of AUDIO_SETTINGS_KEYS) settings[key] = ctx.state[key];
    // The calibrated gate feeds the AGC's real speech gate (audio-processing.js's
    // effectiveNoiseFloorDbfs), not just the Settings-pane mic test. isMicCalibrationValid applies
    // both invalidation rules: the device is gone (checked against the last device list the
    // Settings pane fetched, cached onto ctx.state.audioDevices by populateAudioDeviceOptions --
    // this path is synchronous and can't re-enumerate devices itself), or the calibration is older
    // than MIC_CALIBRATION_MAX_AGE_MS (room noise changes meeting to meeting).
    const stored = readStoredMicCalibration(ctx.state.audioDeviceId);
    if (isMicCalibrationValid({ calibration: stored, deviceId: ctx.state.audioDeviceId, devices: ctx.state.audioDevices }) &&
        Number.isFinite(stored.gateDbfs)) {
      settings.noiseFloorDbfs = stored.gateDbfs;
    }
    return settings;
  }

  // Real readiness for the Settings > Ready check "Microphone" row (docs/backlog.md item 1).
  // checkMicReady in view.js used to be `browserSpeechAvailable() || ...` -- a feature-detect on
  // the Web Speech API that says nothing about permission or whether a device exists, so it read
  // green in Chrome with mic access denied and every microphone unplugged. This is async (permission
  // state and the device list both are) while renderReadyCheck must stay synchronous, so the
  // resolved verdict is written onto ctx.state here and the render path only ever reads it.
  //
  // Deliberately does NOT call getUserMedia -- that would open a live mic stream (and light the
  // browser's recording indicator) just to paint a status dot. navigator.permissions.query and
  // enumerateDevices are the only APIs than can answer "is this ready" without opening anything.
  async function refreshMicReadiness() {
    let permissionState = 'unknown';
    try {
      if (permissionsImpl?.query) {
        const status = await permissionsImpl.query({ name: 'microphone' });
        permissionState = status?.state || 'unknown';
      }
    } catch {
      // Some browsers (Safari) throw on an unrecognized permission name rather than returning
      // 'prompt'/'denied'/'granted'. Degrade to 'unknown' -- evaluateMicReadiness then falls back
      // to the device list alone, rather than crashing the settings pane.
      permissionState = 'unknown';
    }

    const devices = await listAudioInputs(mediaDevicesImpl);
    const result = evaluateMicReadiness({ permissionState, devices });
    ctx.state.micReady = result.ready;
    ctx.state.micReadyReason = result.reason;
    syncSettingsPanel(ctx);
  }

  // Refreshes the mic picker's <option> list. Device labels are withheld by the browser until
  // permission has been granted once, so this is called again right after a successful level-test
  // start -- the first pass shows "Microphone N" placeholders, the second shows real names.
  async function populateAudioDeviceOptions() {
    const select = ctx.dom.audioDeviceSelect;
    if (!select) return;

    const devices = await listAudioInputs(mediaDevicesImpl);
    ctx.state.audioDevices = devices; // cached so buildAudioSettings can validate a stored
    // calibration's device-still-exists rule synchronously, without re-enumerating devices itself.
    const resolvedId = resolveDeviceId(devices, ctx.state.audioDeviceId);

    select.innerHTML = '';
    const defaultOption = createOptionElementFn();
    defaultOption.value = '';
    defaultOption.textContent = 'System default';
    select.appendChild(defaultOption);
    for (const device of devices) {
      const option = createOptionElementFn();
      option.value = device.deviceId;
      option.textContent = device.label;
      select.appendChild(option);
    }
    select.value = resolvedId;

    // A saved id that is no longer in the list (the mic got unplugged since last time) falls back
    // to '' here -- persist the correction so the next reload doesn't keep offering a dead device.
    if (resolvedId !== ctx.state.audioDeviceId) setAudioDeviceId(resolvedId);
  }

  function setAudioDeviceId(deviceId) {
    const next = deviceId || '';
    if (next === ctx.state.audioDeviceId) return;
    ctx.state.audioDeviceId = next;
    localStorage.setItem(STORAGE.audioDeviceId, next);
  }

  // Populates the recording picker from the server's list (GitHub issue #3). Mirrors
  // populateAudioDeviceOptions's shape: fetch, rebuild the <option> list, then correct a
  // selection that no longer exists (a recording deleted from disk since last load) rather than
  // silently keeping a dead id selected.
  async function refreshRecordingList() {
    try {
      const response = await fetchImpl('/api/recording/list');
      const data = await response.json().catch(() => ({}));
      ctx.state.availableRecordings = Array.isArray(data?.recordings) ? data.recordings : [];
    } catch {
      ctx.state.availableRecordings = ctx.state.availableRecordings || [];
    }
    populateRecordingOptions();
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);
  }

  function populateRecordingOptions() {
    const select = ctx.dom.replayRecordingSelect;
    if (!select) return;

    const recordings = ctx.state.availableRecordings || [];
    select.innerHTML = '';

    if (recordings.length === 0) {
      const emptyOption = createOptionElementFn();
      emptyOption.value = '';
      emptyOption.textContent = 'No recordings yet';
      select.appendChild(emptyOption);
      select.value = '';
      if (ctx.state.selectedRecordingId) setSelectedRecordingId('');
      return;
    }

    for (const recording of recordings) {
      const option = createOptionElementFn();
      option.value = recording.id;
      option.textContent = recording.id;
      select.appendChild(option);
    }

    // A saved id that is no longer in the list (the recording was deleted since last load) falls
    // back to the newest recording -- same correction populateAudioDeviceOptions makes for an
    // unplugged mic, persisted so the next reload doesn't keep offering a dead id.
    const stillExists = recordings.some((recording) => recording.id === ctx.state.selectedRecordingId);
    const resolvedId = stillExists ? ctx.state.selectedRecordingId : recordings[0].id;
    select.value = resolvedId;
    if (resolvedId !== ctx.state.selectedRecordingId) setSelectedRecordingId(resolvedId);
  }

  function setSelectedRecordingId(recordingId) {
    const next = recordingId || '';
    if (next === ctx.state.selectedRecordingId) return;
    ctx.state.selectedRecordingId = next;
    localStorage.setItem(STORAGE.replayRecordingId, next);
    // The replay driver reads recordingId once, at build time -- force a rebuild on next
    // ensureTranscriptionDriver() so a mid-session change to the selection actually takes effect,
    // the same way switching transcriptionSource itself forces a rebuild.
    if (transcriptionDriver?.id === 'replay') transcriptionDriver = null;
    syncSettingsPanel(ctx);
  }

  function setReplaySpeed(speed) {
    const next = normalizeReplaySpeed(speed);
    if (next === ctx.state.replaySpeed) return;
    ctx.state.replaySpeed = next;
    localStorage.setItem(STORAGE.replaySpeed, next);
    if (transcriptionDriver?.id === 'replay') transcriptionDriver = null;
    syncSettingsPanel(ctx);
  }

  function renderAudioLevelMeter(levels) {
    const described = describeLevels(levels);
    // Readability latch (docs/backlog.md item 1, 2026-07-30 mic test): the raw per-tick reading
    // flickers between classifications faster than a slow reader can follow, and a "Too loud"
    // warning could disappear before it was read at all. stabilizeMeterDisplay is pure/DOM-free
    // (audio-monitor.js) -- this is the one call site that owns the state it threads between ticks.
    const { display, state } = stabilizeMeterDisplay({ previous: meterStabilizerState, described });
    meterStabilizerState = state;
    if (ctx.dom.audioLevelBar) {
      ctx.dom.audioLevelBar.style.width = `${display.rmsPercent}%`;
      ctx.dom.audioLevelBar.classList.toggle('clipping', display.clipping);
    }
    if (ctx.dom.audioLevelPeak) {
      ctx.dom.audioLevelPeak.style.left = `${display.peakPercent}%`;
    }
    // INV-10: describeLevels(null) reports "Not measuring" rather than a blank/zeroed bar, so a
    // probe that never started (or has since stopped) never reads as "silence detected."
    // A too-noisy calibration verdict overrides the per-tick word (never the meter bar itself,
    // which keeps showing the real reading) -- Steve's ruling: say plainly that this mic can't be
    // gated reliably in this room, rather than let the meter jump straight from silence to "Good"
    // and look healthy. Calibration text also bypasses the latch/debounce -- it is already a stable,
    // deliberately-set verdict, not a per-tick classification.
    //
    // Precedence, made explicit after a sign-off finding (2026-07-30): a live warning must always
    // outrank an advisory. `display.clipping` (CLIPPING, exempted from the debounce in
    // stabilizeMeterDisplay for the same reason) is the one state the calibration text is never
    // allowed to paper over -- an instrument that can hide "Too loud" behind a calmer-sounding
    // sentence is worse than one that shows nothing, because the operator believes what it says.
    const calibrationText = describeMicCalibration(micCalibration).text;
    const advisoryMayShow = calibrationText && !display.clipping;
    if (ctx.dom.audioLevelText) {
      ctx.dom.audioLevelText.textContent = advisoryMayShow ? calibrationText : display.text;
    }
    return display;
  }

  // Owns its own getUserMedia + AudioContext, independent of the conditioner and of whether
  // listening is running (see audio-processing.js's createMicProbe doc comment for why: the
  // conditioner ships bypassed by default and its readLevels() is dead on arrival). This is what
  // lets an operator check a mic before a meeting starts, exactly like Google Meet's mic test.
  async function startAudioLevelTest() {
    if (ctx.state.audioLevelTestActive) return;
    meterStabilizerState = null;
    micProbe = createMicProbeFn({ deviceId: ctx.state.audioDeviceId, audioSettings: buildAudioSettings() });
    const result = await micProbe.start();
    if (!result?.ok) {
      renderAudioLevelMeter(null);
      if (ctx.dom.audioLevelText) {
        ctx.dom.audioLevelText.textContent = result?.error || 'Could not test this microphone.';
      }
      micProbe = null;
      // A failed probe (e.g. permission just denied at the OS prompt) is itself new readiness
      // information -- refresh so the Ready check row reflects it without waiting for another
      // devicechange or settings-reopen.
      refreshMicReadiness();
      return;
    }
    // Diagnostic only, matching the honesty the real capture path applies (openai.js's
    // reportGrantedConstraints) -- surfaced to the console for now. Whether this belongs on a
    // visible UI surface (e.g. next to the level meter) is Steve's call, not built here; see the
    // report handed back with this change.
    if (result.grantedConstraints) {
      console.info('Mic test constraints granted:', result.grantedConstraints);
    }

    // Persist the calibration this device just measured (backlog #7/#10) -- written regardless of
    // tooNoisy: a too-noisy verdict stores gateDbfs: null, so buildAudioSettings's Number.isFinite
    // check falls back to the fixed default rather than a fudged gate (never block listening on an
    // uncalibrated -- or unreliably calibratable -- mic).
    micCalibration = result.calibration || null;
    if (micCalibration) writeStoredMicCalibration(ctx.state.audioDeviceId, micCalibration);

    ctx.state.audioLevelTestActive = true;
    if (ctx.dom.audioLevelTestButton) {
      ctx.dom.audioLevelTestButton.textContent = 'Stop test';
      ctx.dom.audioLevelTestButton.setAttribute('aria-pressed', 'true');
    }
    await populateAudioDeviceOptions();
    refreshMicReadiness();
    micLevelTimer = setInterval(() => {
      renderAudioLevelMeter(micProbe?.readLevels());
    }, AUDIO_LEVEL_METER_INTERVAL_MS);
  }

  // Idempotent and safe to call whether or not a test is running -- called on explicit toggle-off,
  // on the settings panel closing, and on stopListening, so a probe never keeps a live mic track
  // open (and the browser's mic indicator lit) after the pane the operator was looking at is gone.
  function stopAudioLevelTest() {
    if (micLevelTimer !== null) {
      clearInterval(micLevelTimer);
      micLevelTimer = null;
    }
    micProbe?.stop();
    micProbe = null;
    micCalibration = null;
    meterStabilizerState = null;
    ctx.state.audioLevelTestActive = false;
    if (ctx.dom.audioLevelTestButton) {
      ctx.dom.audioLevelTestButton.textContent = 'Test';
      ctx.dom.audioLevelTestButton.setAttribute('aria-pressed', 'false');
    }
    renderAudioLevelMeter(null);
  }

  async function toggleAudioLevelTest() {
    if (ctx.state.audioLevelTestActive) {
      stopAudioLevelTest();
      return;
    }
    await startAudioLevelTest();
  }

  function buildTranscriptionDriver() {
    return createTranscriptionDriverFn(ctx.state.transcriptionSource, {
      onEvent: handleTranscriptEvent,
      audioSettings: buildAudioSettings(),
      // Only `openai.js`'s driver reads these two; other drivers ignore unknown options. The
      // constraints-granted report fires once per start() call, so it is safe to surface through
      // the existing (non-rail) #status text -- passing no `level` means updateStatus only writes
      // ctx.dom.status.textContent and never touches the operator rail, which is Marlow's surface.
      // Every other diagnostic from this module (measurement-failure fallbacks, graph-setup
      // failures, the audio-shedding backlog warning) can recur every ~500ms under sustained
      // failure -- routing those to the rail would be exactly the per-chunk spam INV-10 exists to
      // prevent, so they go to console only until Marlow designs a dedicated, throttled surface
      // for them. That handoff is not built here.
      // Most audio diagnostics recur every ~500ms while listening, so the console is the right home
      // for them: putting that on the rail would drown every other message the operator needs. But
      // deciding which ones DO deserve the rail by matching their opening words was the same prose
      // sniff the onStatus comment below rightly objects to, and it had already gone wrong once --
      // "the chosen microphone was unavailable; using the system default instead" is exactly the
      // kind of thing an operator must be told, since the app just overrode a device they picked on
      // purpose, and the prefix check sent it to the console alone. The producer now marks a
      // diagnostic `notable` instead. A throttled surface for the recurring ones is still unbuilt
      // and belongs to the status-honesty seat; this only fixes the one-shot messages.
      onAudioDiagnostics: ({ message, notable } = {}) => {
        if (!message) return;
        console.warn('[audio]', message);
        if (notable) {
          updateStatus(ctx, message);
        }
      },
      // A driver may state its own level. Sniffing prose with transcriptionStatusLevel() was the
      // only channel until now, and it silently misses anything phrased outside its regex -- a
      // driver shedding audio to catch up says something serious in words the classifier does not
      // recognise, so the rail stayed calm while speech was being dropped. An explicit level from
      // the component that actually knows beats guessing from its wording; the classifier stays as
      // the fallback for the messages that do not pass one.
      onStatus: (text, { level: statedLevel } = {}) => {
        const level = statedLevel || transcriptionStatusLevel(text);
        updateStatus(ctx, text, level ? { level } : undefined);
      },
      // Only the demo driver's scripted scenarios use this: each entry names the mode the real
      // summarizer must be in while it processes that entry's text (INV: a scenario is only truly
      // covered if it is actually summarized in the mode it belongs to). Other drivers ignore it.
      onModeChange: (mode) => {
        if (!mode || mode === ctx.state.mode) return;
        ctx.state.mode = mode;
        updateModeButtons(ctx);
      },
      // Only replay.js's recorded chunks drive this (issue #40): a replay must reproduce the same
      // speaker labels the operator actually saw, so the recorded speaker is re-applied the same
      // way the recorded mode already is above. Empty is a real value here too, not a no-op guard --
      // a replayed speaker change back to "no name" must clear the field, not leave the previous
      // speaker's name stuck on screen.
      onSpeakerChange: (speaker) => {
        setSpeakerName(speaker || '');
      },
      fetchImpl,
      setTimeoutFn,
      clearTimeoutFn,
      // Only replay.js reads these two; other drivers ignore unknown options (same convention as
      // audioSettings above). A snapshot at driver-build time, not a live getter -- setSelectedRecordingId/
      // setReplaySpeed force a rebuild on change, the same way switching transcriptionSource itself does.
      recordingId: ctx.state.selectedRecordingId,
      speed: ctx.state.replaySpeed
    });
  }

  function buildSummarizationDriver() {
    return createSummarizationDriverFn(ctx.state.summarizationSource, {
      onStatus: (text) => updateStatus(ctx, text),
      fetchImpl,
      setTimeoutFn,
      clearTimeoutFn
    });
  }

  async function ensureTranscriptionDriver() {
    if (!transcriptionDriver || transcriptionDriver.id !== ctx.state.transcriptionSource) {
      transcriptionDriver = buildTranscriptionDriver();
    }
    return transcriptionDriver;
  }

  // The single place that turns "is the active transcription driver capturing live audio"
  // into a rail status level. The driver states its own liveness (`isLive`, part of the
  // driver contract alongside `id`/`label`) rather than the runtime inferring it from a
  // source-id string comparison -- that inference is exactly what let replay be announced as
  // "Listening" (ctx.state.listening only means "a driver is running", see its assignment in
  // startListening(), NOT that a microphone is live). Every status-path read of liveness goes
  // through this helper so there is one place to get it right, not one per call site.
  function activeTranscriptionStatusLevel() {
    // No driver means nothing is capturing, so "manual" is the only honest answer. Deliberately
    // NOT falling back to ctx.state.listening here: reading that flag for a liveness question is
    // the exact bug this helper exists to remove, and leaving it in one edge case leaves the trap
    // set for whoever next changes the start path.
    if (!transcriptionDriver) return 'manual';
    return transcriptionDriver.isLive ? 'listening' : 'manual';
  }

  async function ensureSummarizationDriver() {
    if (!summarizationDriver || summarizationDriver.id !== ctx.state.summarizationSource) {
      summarizationDriver = buildSummarizationDriver();
    }
    return summarizationDriver;
  }

  // Thin progress line at the top of the operator's live-transcript preview (#railTranscript,
  // Steve's ask 2026-07-19): purely informational -- it lets the operator see the moment a
  // summarize tick absorbs text, without adding a second status channel. Deliberately driven off
  // the SAME setInterval that fires summarizeCurrentText (see startLoop below), never a parallel
  // rAF/timer of its own -- a bar with its own clock is exactly the kind of thing that quietly
  // drifts out of sync with the real tick and starts lying (INV-10's cardinal sin, applied to a
  // new surface).
  function restartTranscriptProgressBar(durationSeconds) {
    const track = ctx.dom.railTranscriptProgress;
    const fill = ctx.dom.railTranscriptProgressFill;
    if (!track || !fill) return;
    track.dataset.state = 'running';
    fill.style.transitionDuration = '0s';
    fill.style.width = '0%';
    // Force a reflow so the browser commits the 0% state before re-enabling the transition --
    // otherwise the width jump straight to 100% below would be collapsed into the same frame and
    // never actually animate.
    void fill.offsetWidth;
    fill.style.transitionDuration = `${durationSeconds}s`;
    fill.style.width = '100%';
  }

  // A scheduled tick found the previous summarize call still in flight (the exact condition
  // noteSkippedSummarizeTick reports as 'behind' -- Janus's summarizeInFlight flag is read here,
  // not re-derived). The wall is now behind schedule, so silently restarting a fresh, healthy-
  // looking sweep would be dishonest; freezing the bar full (in the same blue as the 'behind' rail
  // dot) says "this cycle overran" instead.
  function freezeTranscriptProgressBarOverrun() {
    const track = ctx.dom.railTranscriptProgress;
    const fill = ctx.dom.railTranscriptProgressFill;
    if (!track || !fill) return;
    track.dataset.state = 'overrun';
    fill.style.transitionDuration = '0s';
    fill.style.width = '100%';
  }

  // Paused or stopped: no tick is coming, so the bar must not keep sweeping as though work were
  // in progress. Called from the one place the loop's real clock actually stops
  // (pauseActiveTranscription) so this can never drift out of sync with whether ticks are firing.
  function idleTranscriptProgressBar() {
    const track = ctx.dom.railTranscriptProgress;
    const fill = ctx.dom.railTranscriptProgressFill;
    if (!track || !fill) return;
    track.dataset.state = 'idle';
    fill.style.transitionDuration = '0s';
    fill.style.width = '0%';
  }

  function startLoop() {
    clearInterval(ctx.state.loopHandle);
    const intervalSeconds = ctx.state.effectiveIntervalSeconds || ctx.state.summaryIntervalSeconds;
    ctx.state.loopHandle = setInterval(() => {
      // startListening() calls startLoop() unconditionally even while paused (the mic can be on
      // with AI paused -- summarizeCurrentText's own `if (ctx.state.paused) return;` is what makes
      // that safe). Mirror that same guard here first: a paused tick is not real work, so the bar
      // must read idle, never mid-sweep or overrun.
      if (ctx.state.paused) {
        idleTranscriptProgressBar();
      } else if (ctx.state.summarizeInFlight) {
        // Read the exact flag summarizeCurrentText is about to check itself: if it's already set,
        // this tick is about to be skipped (noteSkippedSummarizeTick), so the bar freezes instead
        // of restarting a fresh sweep over a cycle that's already overrunning.
        freezeTranscriptProgressBarOverrun();
      } else {
        restartTranscriptProgressBar(intervalSeconds);
      }
      summarizeCurrentText();
      // Fire-and-forget: flushRecordingQueue never throws (see its own definition) and this loop
      // must never wait on it -- a slow or failing recording write must not delay the next tick.
      flushRecordingQueue();
    }, intervalSeconds * 1000);
    ctx.state.loopHandle.unref?.();
    // The first period of this (re)established schedule starts counting now, at the true zero
    // point of the interval -- re-syncs the bar immediately whenever startLoop runs, which is
    // exactly the set of moments (interval change, resume, backoff/recovery) that already call it.
    if (ctx.state.paused) {
      idleTranscriptProgressBar();
    } else {
      restartTranscriptProgressBar(intervalSeconds);
    }
  }

  function clearSummarizeFailureAlert() {
    if (!ctx.state.summarizeFailureAlertActive) return;
    ctx.state.summarizeFailureAlertActive = false;
    // Route through syncSettingsPanel (which rebuilds from buildAlerts) rather than writing
    // apiWarning/alertsSection/settingsAlertBadge here directly -- a second writer for the same
    // three nodes is exactly how the badge and the visible alerts area drifted apart (see the note
    // on summarizeFailureAlertActive in buildAlerts, view.js).
    syncSettingsPanel(ctx);
  }

  function resetSummarizeBackoff() {
    ctx.state.summarizeFailureCount = 0;
    const hadBackoff = Boolean(ctx.state.effectiveIntervalSeconds);
    ctx.state.effectiveIntervalSeconds = null;
    clearSummarizeFailureAlert();
    // A successful summarize call is the honest signal that the outage which was filling the
    // buffer (and forcing trimBucket to drop the oldest speech) has genuinely ended -- see
    // clearSpeechDroppedAlert. Doing this here, not in showRecentTranscript, means the "Speech
    // dropped" note only clears on confirmed recovery, never merely because the bucket happens to
    // sit under the cap for one tick.
    clearSpeechDroppedAlert();
    // Likewise, a successful call is the honest signal that a 'behind' skip streak is over -- see
    // clearWallBehindAlert. (In practice the recoveredLevel status update further below already
    // clears any active persistent note on success; this is the explicit, self-documenting path.)
    clearWallBehindAlert();
    if (hadBackoff && ctx.state.listening && !ctx.state.paused) {
      startLoop();
    }
  }

  function escalateSummarizeFailure() {
    ctx.state.summarizeFailureAlertActive = true;
    // See clearSummarizeFailureAlert above: syncSettingsPanel is the single writer for
    // apiWarning/alertsSection/settingsAlertBadge, driven off buildAlerts, so the badge and the
    // visible alerts area can never disagree about whether this condition is showing.
    syncSettingsPanel(ctx);
    ctx.state.effectiveIntervalSeconds = Math.min(ctx.state.summaryIntervalSeconds * 2, 30);
    if (ctx.state.listening && !ctx.state.paused) {
      startLoop();
    }
  }

  // How many consecutive scheduled ticks may find the previous summarize call still in flight
  // before the rail says so. A single skip is not sticky-worthy on its own -- a call that runs
  // marginally past one interval and finishes on the very next tick is normal jitter, not a
  // condition worth interrupting the operator over (the same "don't cry wolf on a single blip"
  // reasoning as SILENCE_WATCHDOG_MS). Two consecutive skips means the wall is now running more
  // than one full interval behind schedule, which is honestly worth surfacing.
  const WALL_BEHIND_SKIP_THRESHOLD = 2;

  // Called every time a scheduled (or manual) summarize attempt finds the previous one still
  // running -- the only observable symptom of a slow provider call quietly falling behind the
  // fixed-interval loop, since skipped ticks otherwise leave no trace at all. Guarded on
  // railStatusLevel (not a separate flag) so a repeat skip while already showing 'behind' does not
  // keep rewriting the note, and so nothing here can escalate past a higher-ranked condition (e.g.
  // a fatal 'problem') already on the rail -- updateStatus's own LEVEL_RANK guard (view.js) blocks
  // that regardless.
  function noteSkippedSummarizeTick() {
    ctx.state.skippedSummarizeTicks = (ctx.state.skippedSummarizeTicks || 0) + 1;
    if (ctx.state.skippedSummarizeTicks >= WALL_BEHIND_SKIP_THRESHOLD && ctx.state.railStatusLevel !== 'behind') {
      updateStatus(
        ctx,
        'Running behind: summarizing is taking longer than the update interval, so the display is behind the room.',
        { level: 'behind' }
      );
    }
  }

  // Called whenever a summarize attempt actually gets to run (the in-flight guard did not skip
  // it) -- the skip streak that led to 'behind' is over regardless of whether this attempt goes on
  // to succeed or fail, so the counter resets unconditionally. The VISIBLE note is deliberately
  // NOT cleared here: clearing it merely because a new attempt started, before knowing whether it
  // succeeds, would be optimistic rather than honest -- a call that starts late and then fails
  // leaves the wall exactly as behind as before. The note only clears on confirmed success, via
  // resetSummarizeBackoff below (same reasoning as clearSpeechDroppedAlert).
  function resetSkippedSummarizeTicks() {
    ctx.state.skippedSummarizeTicks = 0;
  }

  // Mirrors clearSpeechDroppedAlert's guard: only recover the rail if 'behind' is the level
  // actually showing, so this never clobbers a higher-ranked condition that has since taken over.
  function clearWallBehindAlert() {
    if (ctx.state.railStatusLevel !== 'behind') return;
    const recoveredLevel = activeTranscriptionStatusLevel();
    updateStatus(ctx, recoveredLevel === 'listening' ? 'Listening.' : 'Manual mode.', {
      level: recoveredLevel
    });
  }

  // Debugging/tuning recorder (ADR-0004): reflects whether appends are ACTUALLY succeeding, not
  // merely whether recording was requested -- INV-10's "the indicator must be truthful" doctrine,
  // applied to this surface. Looked up by id rather than through ctx.dom, since this is a minimal,
  // deliberately separate surface from Marlow's operator-rail status classifier (view.js), not a
  // redesign of it.
  function updateRecordingIndicator() {
    const el = typeof document !== 'undefined' ? document.getElementById('recordingIndicator') : null;
    if (!el) return;
    if (!ctx.state.recordingEnabled) {
      el.textContent = 'Not recording.';
      el.dataset.state = 'off';
      return;
    }
    if (ctx.state.recordingOk === false) {
      el.textContent = 'Recording stopped: could not write to the local session file.';
      el.dataset.state = 'failed';
      return;
    }
    if (ctx.state.recordingOk === null || ctx.state.recordingOk === undefined) {
      // Armed, but nothing has actually been written yet, so saying "recording to a local file" here
      // would be a claim we cannot back. ADR-0004 asked for an indicator truthful about whether
      // writes are LANDING rather than whether recording was requested, and this is precisely the
      // state where those two answers differ: at page load, and for the whole first quiet stretch of
      // a meeting, no flush has happened and the very first one may still fail.
      el.textContent = 'Recording is on. Nothing written yet.';
      el.dataset.state = 'armed';
      return;
    }
    el.textContent = 'Recording session to a local file.';
    el.dataset.state = 'on';
  }

  function setRecordingEnabled(nextEnabled) {
    ctx.state.recordingEnabled = Boolean(nextEnabled);
    localStorage.setItem(STORAGE.recordingEnabled, String(ctx.state.recordingEnabled));
    if (!ctx.state.recordingEnabled) {
      // Nothing queued while off should later leak out the moment it's re-enabled.
      //
      // If the session's header record is still sitting unflushed in that queue, dropping it here
      // would leave the file with no header at all once recording resumes -- the exact "cannot tell
      // what produced this recording by reading it" gap issue #4 exists to close. So un-arm the flag
      // and let the next record re-queue it. A header that already reached the file is not in the
      // queue, so it stays written exactly once.
      const queued = Array.isArray(ctx.state.recordingQueue) ? ctx.state.recordingQueue : [];
      if (queued.some((record) => record?.t === 'header')) ctx.state.recordingHeaderQueued = false;
      ctx.state.recordingQueue = [];
    } else {
      // A fresh "on" is worth trusting again until proven otherwise -- the next flush will correct
      // this immediately if writes are still failing.
      ctx.state.recordingOk = null;
    }
    updateRecordingIndicator();
  }

  // Batches whatever chunk/summary records have queued since the last tick into one request,
  // rather than a fetch per chunk during a live meeting. NEVER throws and NEVER awaited by its
  // caller -- a failed or slow write here must be invisible to the transcription/summarize loop,
  // which is the one non-negotiable this whole instrument answers to. A failure degrades to
  // "recording stopped" (surfaced via updateRecordingIndicator) and nothing else.
  // The single entry point for queueing a record, and the only one any call site should use.
  //
  // ADR-0004's "never damages a meeting" constraint covers the SHAPING of a record, not just the
  // network write. Building a record is pure and ought not to throw, but the call sites sit in two
  // places where a throw would do real harm rather than merely losing a record: inside
  // handleTranscriptEvent, where it would drop live speech; and inside summarizeCurrentText's catch
  // block, where escaping would skip the failure counting below it and the operator would never get
  // the "Problem" escalation for a provider that genuinely is failing. Either one turns a debugging
  // instrument into an INV-10 lie -- a status surface that is wrong about what is broken -- so the
  // recorder swallows its own faults here and stays silent about them.
  // Issue #4: the header record is what lets a survived-too-long recording be recognised as stale
  // by reading the file, instead of by remembering which meeting used which prompt/commit. Written
  // once, and first -- before any chunk or summary record ever reaches the queue -- by piggybacking
  // on the very first queueRecord call of the session rather than a separate call site, so there is
  // exactly one place that can get the ordering wrong.
  function ensureRecordingHeaderQueued() {
    if (ctx.state.recordingHeaderQueued) return;
    ctx.state.recordingQueue.push(buildHeaderRecord({
      appCommit: ctx.state.appCommit,
      promptHash: computeSummaryPromptHash(),
      maxWords: ctx.state.summaryMaxWords,
      provider: ctx.state.summarizationSource,
      intervalSeconds: ctx.state.summaryIntervalSeconds,
      displayCap: MAX_DISPLAY_ITEMS
    }));
    ctx.state.recordingHeaderQueued = true;
  }

  function queueRecord(build) {
    if (!ctx.state.recordingEnabled) return;
    try {
      ensureRecordingHeaderQueued();
      ctx.state.recordingQueue.push(build());
      scheduleUnloopedFlush();
    } catch (_error) {
      // Deliberately silent: a recorder that cannot even shape a record has nothing useful to say to
      // the operator mid-meeting, and the flush indicator already reports whether writes are landing.
    }
  }

  // #138. The summarize loop is the only thing that drains the recording queue, and it only runs
  // while listening -- so anything queued outside that window sat in memory until the tab closed and
  // was then simply gone. Three ways in, and the second is the one that costs the most:
  //
  //   A session where the operator only ever types (never presses Start) writes nothing at all.
  //   stopListening() clears the loop and THEN runs its final summarize, so the closing summary of
  //     every meeting -- the one you would most want -- was queued with nothing left to write it.
  //   Anything queued while paused waits for a resume that may never come.
  //
  // Debounced rather than immediate so a burst of typed cards is one write, not one per card. If the
  // loop is running it already owns the drain, so this stays out of its way. A double flush is
  // harmless regardless: flushRecordingQueue splices the queue empty synchronously, so whichever
  // call arrives second finds nothing to send.
  function scheduleUnloopedFlush() {
    if (ctx.state.loopHandle) return;
    if (ctx.state.recordingFlushTimer) clearTimeoutFn(ctx.state.recordingFlushTimer);
    ctx.state.recordingFlushTimer = setTimeoutFn(() => {
      ctx.state.recordingFlushTimer = null;
      flushRecordingQueue();
    }, UNLOOPED_RECORDING_FLUSH_MS);
  }

  async function flushRecordingQueue() {
    const queue = ctx.state.recordingQueue;
    if (!Array.isArray(queue) || !queue.length) return;
    const batch = queue.splice(0, queue.length);
    try {
      const response = await fetchImpl('/api/recording/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: ctx.state.recordingSessionId, records: batch })
      });
      const ok = Boolean(response?.ok);
      if (ok !== ctx.state.recordingOk) {
        ctx.state.recordingOk = ok;
        updateRecordingIndicator();
      }
    } catch (_error) {
      if (ctx.state.recordingOk !== false) {
        ctx.state.recordingOk = false;
        updateRecordingIndicator();
      }
    }
  }

  // Every call -- the interval tick, a test calling directly, or stopListening's final drain --
  // is routed through this thin wrapper so the promise of "whatever summarize call is currently
  // running" is always reachable from ctx.state, not just from whichever caller happens to hold
  // it. stopListening needs exactly that: it must await the call already in flight (if any)
  // before starting its own final drain, or the two could race and double-consume the bucket.
  // The two early returns live HERE rather than inside the real call, so that a call which never
  // ran cannot become the promise everyone else awaits. startNewSpeaker and stopListening await
  // summarizeCallPromise to be sure the outgoing speaker's tail is drained; when a skipped tick
  // overwrote it with its own resolved no-op, that await returned instantly, their forced
  // settleMs: 0 drain was then skipped by the in-flight guard too, and the tail merged into the next
  // speaker's first card in first person (#76). A skipped call resolves immediately rather than
  // handing back the in-flight promise, because the tick callers await their own return value and
  // must not be made to block on a slow call they were turned away from.
  function summarizeCurrentText(text, options) {
    if (ctx.state.paused) return Promise.resolve();
    if (ctx.state.summarizeInFlight) {
      noteSkippedSummarizeTick();
      return Promise.resolve();
    }
    const promise = runSummarizeCurrentText(text, options);
    ctx.state.summarizeCallPromise = promise;
    return promise;
  }

  // #54. A bucket-draining tick (text undefined) drains at most one complete mode run per
  // interval, and runs now break on a speaker change (#51), so a second speaker landing in the
  // same tick used to wait a full BUCKET_TICK_MS behind the first. Here we keep draining complete
  // runs out of the SAME tick instead of waiting for the next one -- but only when the previous
  // drain actually SUCCEEDED (unpaused, no error): a failing provider must still fail exactly once
  // per tick, or a loop that keeps retrying it inflates summarizeFailureCount and trips Marlow's
  // escalation threshold early during exactly the outage backlog this loop exists to drain safely.
  // Hard-capped independently of that success gate, because an outage backlog sitting in the bucket
  // while the provider recovers is precisely the case where "keep draining while runs remain" would
  // otherwise turn into an unbounded burst of calls the moment the provider comes back. Hitting the
  // cap is counted in summarizeDrainCapHits and passed to updateStatus, but that call alone does NOT
  // put it in front of the operator -- updateStatus with no level only writes #status, which lives
  // inside the closed settings dialog. Whether this needs a rail-visible surface is Marlow's call,
  // not mine; summarizeDrainCapHits exists so a test (or Marlow's surface) can observe the cap was
  // hit without needing one.
  // A caller-supplied `text` (used only by tests) is a single explicit call, never a bucket drain,
  // so it never loops.
  // 2026-08-09, Steve's call: this used to be 5, so a real backlog (a provider outage, a long pause)
  // drained in a burst of back-to-back network calls the moment it cleared -- measured in a real
  // session as ~20 card pairs landing under a second apart, which is unreadable no matter how each
  // call was capped. With every call now capped to exactly one card, there is no burst left to drain
  // faster than the ordinary interval cadence already does; a backlog just clears one card per tick,
  // same pacing a reader gets the rest of the time, however many ticks that takes.
  const MAX_DRAIN_RUNS_PER_TICK = 1;

  // Stop and a mode/speaker change are boundaries, not the ongoing interval cadence the cap above
  // paces: at those moments listening has already ended or the operator has already moved on, so
  // there is no reader-pacing reason left to hold a real backlog back, and every reason not to lose
  // it silently. Generous rather than unbounded for the same reason MAX_DRAIN_RUNS_PER_TICK has a
  // number at all -- a bucket fault must still be bounded.
  const FINAL_FLUSH_MAX_RUNS = 20;

  // Returns true when the bucket has another complete run worth draining, OR when peeking at it
  // threw (e.g. takeOldestModeRun's over-BUCKET_MAX_CHARS guard at transcript-bucket.js:109) --
  // a peek that swallowed that throw and returned false would keep the while loop's body from ever
  // running, which means drainOnce's OWN try/catch (the thing that actually counts the failure and
  // reports "Could not prepare the transcript") would never see it either. So a fault here must read
  // as "yes, go drain" rather than "no work to do": the throw is deliberately NOT handled in this
  // function, just let through so the caller enters drainOnce, which re-runs the exact same
  // partitionBucket/takeOldestModeRun call and hits its existing INV-10 reporting path.
  function hasCompleteModeRun(settleMs) {
    const { consumable } = partitionBucket(ctx.state.transcriptChunks, { settleMs });
    const run = takeOldestModeRun(consumable, { defaultMode: ctx.state.mode, defaultSpeaker: ctx.state.speakerName });
    return Boolean(run.chunks?.length);
  }

  // Peeks for more work without ever swallowing a bucket fault: a throw means "there is real,
  // unprocessed work here (it just can't be safely measured)", so the drain loop must still enter
  // the body and let drainOnce's own try/catch see the same throw and report/count it -- exactly
  // the property this wrapper exists to preserve after #54 (see hasCompleteModeRun above).
  function mustKeepDraining(settleMs) {
    try {
      return hasCompleteModeRun(settleMs);
    } catch (_error) {
      return true;
    }
  }

  async function runSummarizeCurrentText(text, { settleMs = BUCKET_SETTLE_MS, maxRuns = MAX_DRAIN_RUNS_PER_TICK } = {}) {
    if (text) {
      await drainOnce(text, settleMs);
      return;
    }
    let runs = 0;
    let ok = true;
    while (ok && !ctx.state.paused && runs < maxRuns && mustKeepDraining(settleMs)) {
      runs += 1;
      ok = await drainOnce(undefined, settleMs);
    }
    // The cap-hit check below is purely informational (whether a real backlog remains after the
    // cap), so a fault here is treated as "no cap message" rather than forced true -- the fault
    // itself was already counted/reported by drainOnce on whichever iteration hit it, and will be
    // again next tick since drainOnce never removes the offending chunk (INV-11).
    let stillPending = false;
    try {
      stillPending = ok && !ctx.state.paused && runs >= maxRuns && hasCompleteModeRun(settleMs);
    } catch (_error) {
      stillPending = false;
    }
    if (stillPending) {
      ctx.state.summarizeDrainCapHits = (ctx.state.summarizeDrainCapHits || 0) + 1;
      // 2026-08-09 (Steve, "we should honor that interval... no catch up"): an ordinary tick capped
      // at MAX_DRAIN_RUNS_PER_TICK (1) hitting this every time a second run is already queued is
      // not a fault, it is the interval working as designed -- the next run simply waits for the
      // next tick, same as any other pacing. A message here was actively misleading in two
      // directions: on an ordinary tick it called normal pacing a "backlog," and at a boundary
      // flush (Stop, mode change) with maxRuns raised well past 1, Stop specifically has already
      // killed the interval by this point (pauseActiveTranscription, above stopListening), so "the
      // next few ticks" is a promise nothing will keep. Only the boundary-flush case is worth
      // surfacing at all, and only without that promise.
      if (maxRuns > MAX_DRAIN_RUNS_PER_TICK) {
        updateStatus(ctx, 'A large backlog remained after the flush; some speech may not have been summarized.');
      }
    }
  }

  // The actual single-run body, unchanged from before #54 except for its return value: `true`
  // means "consumed successfully while unpaused", the one condition under which it is safe for
  // the loop above to immediately ask for another run; everything else (paused, bucket fault,
  // provider failure, or a deduped no-op that never reached the network) returns `false` and ends
  // the tick's drain right there, exactly as a single un-looped call would have.
  async function drainOnce(text, settleMs = BUCKET_SETTLE_MS) {
    resetSkippedSummarizeTicks();

    let consumedChunks = null;
    let sendMode = ctx.state.mode;
    let sendSpeaker = ctx.state.speakerName;
    let recent;
    if (text) {
      recent = normalizeText(text);
    } else {
      // Wrapped because this runs OUTSIDE the provider try/catch below and the only caller is a
      // fire-and-forget setInterval tick. A throw here used to surface as nothing at all: an unhandled
      // rejection in the console, no status change, and a rail still reading "Listening" while not one
      // card would ever be produced again. Silence is the worst available response, so a bucket fault
      // is reported through the same failure path a dead provider uses (INV-10) -- the operator is
      // told something is wrong even though we cannot tell them it is our bug rather than the model's.
      try {
        const { consumable } = partitionBucket(ctx.state.transcriptChunks, { settleMs });
        // The whole oldest contiguous mode run, not the oldest ~1000 characters -- lag is now bounded
        // at one card, whatever the volume, and the run's own text (built by takeOldestModeRun itself
        // from these exact chunks) is what gets sent below, so "sent" and "consumed" are provably the
        // same set. A later mode in the bucket ends the run early: one summarize call must never span
        // two modes, since its prompt carries a single `Mode:` line.
        const run = takeOldestModeRun(consumable, { defaultMode: ctx.state.mode, defaultSpeaker: ctx.state.speakerName });
        consumedChunks = run.chunks;
        sendMode = run.mode;
        sendSpeaker = run.speaker;
        recent = run.text;
      } catch (error) {
        // The bucket is deliberately NOT drained or trimmed here. Whatever is in it is the only copy
        // of those words, and discarding them to recover from our own fault would lose real speech.
        ctx.state.summarizeFailureCount = (ctx.state.summarizeFailureCount || 0) + 1;
        if (ctx.state.summarizeFailureCount === 3) {
          escalateSummarizeFailure();
        }
        // Mirrors the provider-failure path below rather than forcing 'problem' on the first fault:
        // the rail's escalation rule is Marlow's, and a one-off is a blip there for the same reason it
        // is here. A bucket fault is deterministic, so it will recur each tick and reach the threshold
        // within seconds anyway -- no need to special-case it.
        updateStatus(
          ctx,
          `Could not prepare the transcript: ${error?.message || error}`,
          ctx.state.summarizeFailureAlertActive ? { level: 'problem' } : undefined
        );
        return false;
      }
    }
    // hasSubstantiveContent only rejects text with no letter or digit in it at all (see its own
    // comment in summary-prompt.js) -- it does NOT catch filler like "Okay." or "Let's see.", which
    // both contain real letters. Before #120, filler like that still reached the network, and the
    // model's own reply was often display-side rejected by isNonAnswerLine ("Nothing was said.").
    // Verbatim passthrough (#120) skips the network call entirely for a short, punctuated run, so
    // that incidental filter no longer applies to it -- passthrough-eligible filler can now reach
    // the display verbatim, so the passthrough branch below gates it with isFillerLine (Steve's
    // call, 2026-08-16). Left in the bucket, not consumed, either way: the same treatment an empty
    // chunk already gets.
    if (!recent || recent === ctx.state.lastSentText || !hasSubstantiveContent(recent)) return false;

    ctx.state.summarizeInFlight = true;
    updateStatus(ctx, 'Summarizing...');
    // Dim rather than remove: these chunks are still in the bucket (INV-11 only drains it on
    // success) and stay visible until this call resolves one way or the other. Set BEFORE the
    // await, so the dim shows the moment the call goes out, not once it comes back.
    if (consumedChunks?.length) {
      ctx.state.inFlightChunks = consumedChunks;
      showRecentTranscript();
    }

    const summarizeStartedAt = nowFn();
    try {
      // #61. Two things the old `transcriptItems.slice(-10)` got wrong. The window was smaller
      // than one call's own output can be (RUNAWAY_LINE_GUARD is 12), so after a full round of
      // announcements the oldest card was already outside it and the model could restate it,
      // with cleanModelLines unable to catch it either since it dedupes against this same list.
      // And cards release one at a time, so anything still in cardReleaseQueue is not in
      // transcriptItems yet and was invisible here regardless of the size. Those cards are going
      // on screen, so the model has to be told about them.
      //
      // Hoisted above the passthrough/summarizer branch (#120) so both share the exact same
      // dedupe window: passthrough must not lose the duplicate-suppression the summarizer path
      // has always had just because it skips the network call that used to carry it.
      const visibleLines = [...ctx.state.transcriptItems, ...cardReleaseQueue.pendingItems()]
        .slice(-DEDUPE_WINDOW_LINES)
        .map((item) => item.text);

      // shouldAcceptModelLine is the same accept/reject gate the summarizer path has always run on
      // its own reply -- vague/refusal/non-answer pattern rejection plus dedupe against
      // visibleLines. Passthrough never touches a model, but it must not lose that guard just
      // because it skips the call that used to carry it: a repeated short utterance (someone
      // saying "Amen." twice) still must not land as two cards. Cato, #120 review, 2026-08-16.
      //
      // isFillerLine gates passthrough only, not the summarizer path -- the summarizer path already
      // has its own incidental filter (isNonAnswerLine on the model's reply) and this is not a
      // change to that path's behavior. Steve's call, 2026-08-16: a filler word must not occupy a
      // reading-load card slot verbatim just because it happens to be short and punctuated.
      const result = isPassthroughEligible(recent, ctx.state.readingBudget?.words)
        && shouldAcceptModelLine(recent, visibleLines)
        && !isFillerLine(recent)
        // cleanModelLine, not raw recent -- shouldAcceptModelLine already decided on the cleaned
        // form (it calls cleanModelLine internally), and every existing path in this codebase
        // (cleanModelLinesWithLoss, used by both driver.summarize() implementations) displays the
        // exact string it judged. Displaying raw `recent` instead would have broken that invariant
        // silently: a pasted line ("- Sacrament meeting starts at nine.") is judged clean but shown
        // with its bullet marker still attached. Warrick, #120 review, 2026-08-16.
        ? { line: cleanModelLine(recent), verbatim: true, wasShortened: false, discardedByCap: 0, discardedByCapClient: 0 }
        : await (async () => {
            const driver = await ensureSummarizationDriver();
            return driver.summarize({
              mode: sendMode,
              recentTranscript: recent,
              visibleLines,
              maxWords: ctx.state.summaryMaxWords,
              // The level is DERIVED from the reading budget, never set by hand -- one quantity, so the
              // words-per-card setting and the amount of compression can never disagree. Measured pace is
              // about one word every two seconds, which puts the live path on brief.
              // mode matters as much as the budget: information mode must never take brief, because brief
              // keeps one line and a round of announcements then loses every fact after the first.
              level: chooseSummaryLevel({ cardWords: ctx.state.summaryMaxWords, mode: sendMode }),
              // Rolling window, not a fixed turn count (Steve, 2026-08-09): a live conversation shifts
              // topic, and a turn cap that reaches back several minutes anchors the model on a topic that
              // has already moved on. Filtered here, at the point of use, rather than trimmed on push, so
              // the window is always relative to NOW rather than to whenever a card last landed.
              history: ctx.state.summaryHistory.filter((turn) => nowFn() - turn.at < SUMMARY_HISTORY_WINDOW_MS)
            });
          })();

      // Debugging/tuning recorder (ADR-0004): records what was actually sent and what came back,
      // independent of the INV-11 consume/pause logic below -- a call that succeeded but landed
      // during a pause is still real evidence about the provider and the prompt, so it is recorded
      // regardless of the early `if (ctx.state.paused) return;` a few lines down.
      queueRecord(() => buildSummaryRecord({
        at: nowFn(),
        mode: sendMode,
        consumedIds: (consumedChunks || []).map((chunk) => chunk.at),
        // previousBlock itself no longer reaches any prompt (#66); this is the closest true
        // statement left about whether the call carried prior context, since summaryHistory is
        // what actually reaches the model now.
        hadPreviousBlock: ctx.state.summaryHistory.length > 0,
        sent: recent,
        returned: result.line || '',
        provider: result.verbatim ? 'passthrough' : ctx.state.summarizationSource,
        ok: true,
        latencyMs: nowFn() - summarizeStartedAt,
        wasShortened: result.wasShortened,
        verbatim: result.verbatim,
        discardedByCap: result.discardedByCap,
        discardedByCapClient: result.discardedByCapClient
      }));

      resetSummarizeBackoff();

      if (ctx.state.paused) return false;
      // The bucket only drains on success while unpaused -- a failed or pause-interrupted request
      // re-sends the same sentences next tick (INV-11).
      ctx.state.lastSentText = recent;
      if (consumedChunks?.length) {
        ctx.state.transcriptChunks = removeConsumed(ctx.state.transcriptChunks, consumedChunks);
        showRecentTranscript();
      }
      const recoveredLevel = activeTranscriptionStatusLevel();
      if (result.line) {
        // Labelled from the CHUNK's own mode/speaker (sendMode/sendSpeaker), not current state --
        // backlogged speech must read under the mode and speaker it was actually said in, even if
        // the operator has since switched modes or retyped the speaker field (issue #40).
        const landed = addLine(result.line, { source: 'ai', mode: sendMode, speaker: sendSpeaker, paced: true });
        // The wall is no longer empty, so stop summarizing on arrival and let the interval own the
        // cadence from here (#31). Gated on addLine actually landing a card: it returns false when the
        // line normalizes away or yields no items, and claiming the wall is no longer empty while it
        // still is would be this bug returning quietly (Cato). Set before anything below that could
        // throw, so a later failure cannot leave it stuck on.
        if (landed) ctx.state.firstCardShown = true;
        updateStatus(ctx, `Added: ${result.line}`, { level: recoveredLevel });
        // Same `recent`/result.line the recording above logs, so history and the recording can
        // never disagree. Capped at the most recent 6 turns; the server independently caps at 8.
        // Capped generously by count here (well past SUMMARY_HISTORY_WINDOW_MS at any real interval)
        // purely so the array cannot grow unbounded across a long meeting; the time filter at the
        // call site above is what actually decides what the model sees.
        ctx.state.summaryHistory = [...ctx.state.summaryHistory, { spoken: recent, shown: result.line, at: nowFn() }].slice(-30);
        return true;
      } else {
        updateStatus(ctx, result.reason || 'No new useful line.', { level: recoveredLevel });
        return true;
      }
    } catch (error) {
      queueRecord(() => buildSummaryRecord({
        at: nowFn(),
        mode: sendMode,
        consumedIds: (consumedChunks || []).map((chunk) => chunk.at),
        hadPreviousBlock: ctx.state.summaryHistory.length > 0,
        sent: recent,
        returned: '',
        provider: ctx.state.summarizationSource,
        ok: false,
        error: String(error?.message || error).slice(0, 200),
        latencyMs: nowFn() - summarizeStartedAt
      }));
      ctx.state.summarizeFailureCount = (ctx.state.summarizeFailureCount || 0) + 1;
      if (ctx.state.summarizeFailureCount === 3) {
        escalateSummarizeFailure();
      }
      updateStatus(
        ctx,
        `Could not summarize: ${error.message}`,
        ctx.state.summarizeFailureAlertActive ? { level: 'problem' } : undefined
      );
      return false;
    } finally {
      ctx.state.summarizeInFlight = false;
      // Every exit path -- success, failure, or the early `if (ctx.state.paused) return;` above --
      // lands here. On success the chunks are already gone from the bucket (removeConsumed ran
      // above), so clearing this and re-rendering is a no-op for them; on failure or a
      // pause-interrupted response they were never removed, so this un-dims the exact same text,
      // proving INV-11 rather than merely asserting it.
      if (ctx.state.inFlightChunks?.length) {
        ctx.state.inFlightChunks = [];
        showRecentTranscript();
      }
    }
  }

  // Pressing a mode button ALWAYS starts fresh, whether or not the mode actually changed.
  //
  // Changing mode has to clear the history, and that was a real bug: previousBlock was already
  // mode-guarded, but summaryHistory was a flat list, so switching from speaker to prayer carried
  // the outgoing speaker's testimony into the prayer as conversational context.
  //
  // Pressing the mode you are ALREADY on clears it too, which is Steve's idea and a better control
  // than the one I built. During testimony meeting he never leaves speaker mode, so a
  // mode-change-only reset would never fire, and the buttons are already under his hand.
  async function setMode(mode) {
    const changed = ctx.state.mode !== mode;
    // Song is typed, not heard (#106): listening through a hymn feeds sung audio into a prompt built
    // for speech, and the app has no way to tell "the hymn ended" from silence. Auto-pause on entry,
    // auto-resume on exit -- but only ours to touch: a manual Pause press clears songAutoPaused, so
    // an operator's own call is never overridden by this switching back.
    const enteringSong = mode === 'song' && ctx.state.mode !== 'song';
    const leavingAutoPausedSong = ctx.state.mode === 'song' && mode !== 'song' && ctx.state.songAutoPaused;

    // Every mode press clears the speaker-name field, whether or not the mode actually changed --
    // pressing the mode you are already on is the "new speaker in testimony meeting" gesture (same
    // reason summaryHistory resets unconditionally below), and a name typed for whoever was talking
    // before must never survive onto whoever comes next. This is separate from the CARD label
    // (view.js), which is a persistent corner nameplate shown on every card for as long as this
    // field holds a value -- clearing the field here is exactly what makes new cards stop getting a
    // label, without needing separate logic for that.
    setSpeakerName('');

    // 2026-08-10 reordering (Steve): dump, THEN switch -- not the other way round. A real session:
    // he pressed Information only after the prayer had finished speaking, but the bucket had not
    // been drained yet (the 20s interval hadn't ticked), so the leftover prayer content was still
    // sitting there when he clicked. The old order flipped ctx.state.mode to 'information'
    // immediately and only THEN flushed -- the flush itself still drained the right chunks (each
    // one is tagged with the mode it was captured under, not read from current state), but any
    // chunk arriving DURING the flush would have been captured under the mode already switched to,
    // and the whole operation reads, and should behave, as one atomic unit: "clean dump and switch,
    // just like hitting Stop or clicking for a new speaker." So the flush is awaited BEFORE the
    // mode, driver, and buttons change at all -- nothing about the new mode exists yet while the
    // old one's leftover content is still being sent.
    await startNewSpeaker();

    ctx.state.mode = mode;
    if (transcriptionDriver && typeof transcriptionDriver.setMode === 'function') {
      transcriptionDriver.setMode(mode);
    }
    updateModeButtons(ctx);
    // The program-tab datalist filters by the ACTIVE mode (Steve's spec: generic across all four),
    // so a mode switch has to refresh it even when the program list itself hasn't changed.
    updateSpeakerDatalist(ctx);
    // The mode-change divider used to wait for the first card actually landing in the new mode --
    // sometimes a real wait, if the operator switches ahead of the speaker starting. Steve, live: he
    // wants the line the moment he clicks, not on first item push. renderDisplay computes a pending
    // divider off ctx.state.mode alone when it differs from the last real card's mode, so calling it
    // here (ctx.state.mode is already updated above) is what makes that immediate.
    renderDisplay(ctx);

    let message = changed ? `Mode changed to ${mode}. Starting fresh.` : `Starting fresh in ${mode} mode.`;
    if (enteringSong && ctx.state.listening && !ctx.state.paused) {
      ctx.state.songAutoPaused = true;
      void pauseAi();
      message = 'Song mode. Microphone paused -- type the hymn.';
      // #3: entering song mode used to go silent on the card display itself -- the reader has no
      // audio and no line-of-sight to the operator, so silence reads as "the app broke," not "music
      // is playing." Reuses the same manual-line path an operator's own typed text goes through
      // (source: 'manual'), so it renders through the ordinary song-mode card, not a separate
      // display path -- see createTranscriptCard's isManualSong handling in view.js.
      addLine('Music is playing.', { source: 'manual', mode: 'song', speaker: '' });
    } else if (leavingAutoPausedSong) {
      ctx.state.songAutoPaused = false;
      void resumeAi();
    }
    updateStatus(ctx, message);
    // updateStatus with no level writes only to #status, which lives inside the settings dialog --
    // unreadable during a meeting, when the panel is closed and this button is the one the operator
    // presses most. Pressing the mode you are already on changes nothing else on screen either (the
    // buttons re-render identically), so without this the clear is completely silent. Same benign
    // polite flash Clear/Undo use.
    flashRailNote(ctx, message, { setTimeoutFn, clearTimeoutFn });
  }

  // Display-only (issue #40): stored so it can be captured onto the next chunk/card, never fed to
  // any summarization prompt. Empty is a valid, ordinary value -- it means no label, never
  // "Unknown" -- so this deliberately does nothing beyond a trim; it must not invent a name.
  function setSpeakerName(name, { syncInput = true } = {}) {
    ctx.state.speakerName = String(name || '').trim();
    // Keep the rail input in sync when the name changes from somewhere other than the operator
    // typing into it directly -- currently only a replay driving its recorded speaker changes.
    // syncInput: false is what makes that true: the input's own 'input' listener passes it,
    // because trimming on every keystroke and writing the trimmed result straight back into the
    // live DOM value fought the operator typing a space -- "James " differs from trimmed "James",
    // so the field snapped back to "James" the instant the space key was pressed, silently eating
    // it. Real bug, caught live: "I am not able to enter a space character into that textbox."
    if (syncInput && ctx.dom.speakerNameInput && ctx.dom.speakerNameInput.value !== ctx.state.speakerName) {
      ctx.dom.speakerNameInput.value = ctx.state.speakerName;
    }
  }

  // Per-meeting program list (Steve's ruling: typed fresh each meeting, never persisted -- unlike
  // audioDeviceId/transcriptionSource in the STORAGE map above). Add/remove are structural changes,
  // so they rebuild the settings-tab rows; editing a row's own name is NOT re-rendered here (only
  // the datalist is refreshed) so an operator mid-keystroke never has their own input torn down and
  // rebuilt out from under their cursor.
  function addProgramEntry() {
    ctx.state.program = [...(ctx.state.program || []), { name: '', mode: 'speaker' }];
    renderProgramPanel(ctx);
    updateSpeakerDatalist(ctx);
  }

  function updateProgramEntry(index, patch) {
    ctx.state.program = (ctx.state.program || []).map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    updateSpeakerDatalist(ctx);
  }

  function removeProgramEntry(index) {
    ctx.state.program = (ctx.state.program || []).filter((_, i) => i !== index);
    renderProgramPanel(ctx);
    updateSpeakerDatalist(ctx);
  }

  // Program-tab send button: pushes the speaker-name input's current text to the display as a
  // header card (icon + mode label + text only, see createTranscriptCard's isHeader branch) in the
  // ACTIVE mode -- same addLine/commitItems pipeline "Show now" and "Music is playing" use, not the
  // summarizer. Deliberately does not clear the input or touch ctx.state.speakerName: that field is
  // still the ordinary speaker nameplate for cards that follow.
  function sendHeaderLine(text) {
    return addLine(text, { source: 'manual', mode: ctx.state.mode, speaker: '', isHeader: true });
  }

  function setFontSize(nextSize) {
    ctx.state.fontSize = clampFontSize(nextSize, ctx.state.fontSize);
    saveViewerSettings(ctx);
    syncViewerControls(ctx);
  }

  function setDisplayMargin(nextMargin) {
    ctx.state.displayMargin = clampDisplayMargin(nextMargin, ctx.state.displayMargin);
    if (ctx.state.displayMarginAdjusting) {
      setDisplayMarginGuidesVisible(ctx, true);
    } else {
      flashDisplayMarginGuides(ctx, { setTimeoutFn, clearTimeoutFn });
    }
    saveViewerSettings(ctx);
    syncViewerControls(ctx);
  }

  function setFontFamily(nextFamily) {
    ctx.state.fontFamily = clampFontFamily(nextFamily, ctx.state.fontFamily);
    saveViewerSettings(ctx);
    syncViewerControls(ctx);
  }

  function setFontWeight(nextWeight) {
    ctx.state.fontWeight = clampFontWeight(nextWeight, ctx.state.fontWeight);
    saveViewerSettings(ctx);
    syncViewerControls(ctx);
  }

  function beginDisplayMarginAdjustment() {
    ctx.state.displayMarginAdjusting = true;
    clearDisplayMarginGuideTimer(ctx, { clearTimeoutFn });
    setDisplayMarginGuidesVisible(ctx, true);
  }

  function endDisplayMarginAdjustment() {
    ctx.state.displayMarginAdjusting = false;
    clearDisplayMarginGuideTimer(ctx, { clearTimeoutFn });
    setDisplayMarginGuidesVisible(ctx, false);
  }

  // The one pace this budget is derived from: the applied profile's measured median, or the app's
  // documented default with none applied (reading-pace.js's DEFAULT_MEDIAN_WPM). Never read directly
  // by anything outside this file -- everything else goes through recomputeSummaryMaxWords below, so
  // there is exactly one place that turns a pace into a word count.
  function medianWpmForBudget() {
    // Explicitly > 0 rather than ?? -- a 0 is not nullish, so `??` let a profile whose median
    // computed to zero through as a real pace, and every card after that was sized from it.
    const measured = Number(ctx.state.readingPaceProfile?.medianWpm);
    return Number.isFinite(measured) && measured > 0 ? measured : DEFAULT_MEDIAN_WPM;
  }

  // Words per card is DERIVED, not an independent setting (issue #44, Steve's call confirmed by
  // Ansel): reading load is one rate, and a slider that could disagree with the measured pace is how
  // it disagreed. Called whenever either input changes -- the interval (setSummaryInterval below) or
  // the applied profile (applyReadingPaceProfile) -- so ctx.state.summaryMaxWords can never go stale
  // against either.
  //
  // 2026-08-09: Steve needs a fast mid-meeting override, without re-running the whole reading-pace
  // measurement. setSummaryMaxWordsOverride (below) sets summaryMaxWordsManual, and this function
  // then does nothing until a real profile is applied again -- the override can never disagree with
  // a profile because choosing it always drops back to no profile first (see that function).
  function recomputeSummaryMaxWords() {
    if (ctx.state.summaryMaxWordsManual) return;
    // The whole budget is stored, not just the clamped word count, so the view never recomputes it.
    // A first version had the view derive its own copy from state and it read one interval behind --
    // it ran before summaryIntervalSeconds was committed, so the screen said "8 words, too short" at
    // a 20s interval where the real answer is 10 and fine. Two places computing one quantity is the
    // exact fault #44 exists to remove, and putting the second one in the DISPLAY is worse, because
    // that is the copy a person reads and trusts.
    const budget = readingBudget(medianWpmForBudget(), ctx.state.summaryIntervalSeconds);
    const unchanged = budget.words === ctx.state.summaryMaxWords
      && budget.belowFloor === ctx.state.readingBudget?.belowFloor
      && budget.rawWords === ctx.state.readingBudget?.rawWords;
    if (unchanged) return;
    ctx.state.readingBudget = budget;
    ctx.state.summaryMaxWords = budget.words;
    updateSummaryMaxWordsControl(ctx);
  }

  // The fast override itself: sets an exact word count directly, bypassing the pace/interval
  // arithmetic entirely. Clears any applied profile FIRST -- a manual number and a reader's measured
  // pace could otherwise silently disagree, which is exactly the failure #44 removed, so this never
  // lets the two coexist. Reselecting the profile afterward (applyReadingPaceProfile) always wins
  // back over this, restoring its own pace, interval, and word count together.
  function setSummaryMaxWordsOverride(words) {
    // Checked against readingPaceProfile itself, not readingPaceProfileName -- a caller can apply a
    // profile object directly without ever setting the remembered name (applyLastReadingPaceProfile
    // sets the name first, but applyReadingPaceProfile alone does not), and this must still catch it.
    // setReadingPaceProfileName('') is not reused here: it no-ops when the name is already '', which
    // would silently skip clearing a profile applied that other way.
    if (ctx.state.readingPaceProfile) {
      ctx.state.readingPaceProfileName = '';
      localStorage.setItem(STORAGE.readingPaceProfileName, '');
      applyReadingPaceProfile(null, null);
      populateReadingPaceProfileOptions();
    }
    const clamped = clampSummaryMaxWordsOverride(words, ctx.state.summaryMaxWords);
    ctx.state.summaryMaxWordsManual = true;
    ctx.state.summaryMaxWords = clamped;
    ctx.state.readingBudget = {
      rawWords: clamped,
      words: clamped,
      belowFloor: clamped < USABLE_CARD_WORDS_FLOOR,
      marginal: clamped >= USABLE_CARD_WORDS_FLOOR && clamped < MARGINAL_CARD_WORDS_CEILING
    };
    updateSummaryMaxWordsControl(ctx);
    updateStatus(ctx, `Words per card set to ${clamped}.`);
  }

  function setSummaryInterval(nextInterval) {
    // #56. The slider's own min is moved to match, but the floor has to hold here too: a stored
    // value from a faster profile, a keyboard press, or a caller passing a number directly all
    // arrive without going past the control.
    const next = Math.max(
      usableIntervalFloor(ctx),
      clampSummaryIntervalSeconds(nextInterval, ctx.state.summaryIntervalSeconds)
    );
    if (next === ctx.state.summaryIntervalSeconds) return;
    ctx.state.summaryIntervalSeconds = next;
    localStorage.setItem(STORAGE.summaryInterval, String(next));
    updateSummaryIntervalControl(ctx);
    recomputeSummaryMaxWords();
    updateStatus(ctx, `Update interval set to ${next}s.`);
    if (ctx.state.listening && !ctx.state.paused) {
      startLoop();
    }
  }

  // Applies a saved reader profile (or clears it, when profile is null/unusable) as a full bookmark
  // of settings, not just a pace number: the font size it was measured at, and the update interval
  // its measured pace actually recommends, both get restored along with it. Steve, 2026-08-09: a
  // profile that only restored pace left the interval wherever it happened to be, so picking a
  // profile after nudging the slider silently landed on a mix of "this reader's measured pace" and
  // "whatever was last dragged" with no way back to the profile's own numbers short of re-measuring.
  //
  // The interval is recomputed from medianWpm via the same recommendSummaryIntervalSeconds arithmetic
  // the results screen already shows (public/reading-pace.js), not a value stored on the profile --
  // existing profiles carry only recordedAt/fontSizePx/cards, and recomputing means an old profile
  // saved before this existed still gets a real interval instead of nothing.
  function applyReadingPaceProfile(name, profile) {
    // Any explicit profile selection -- a real one or "No profile" -- always wins over a stale
    // manual override (2026-08-09): the whole point of reselecting is landing back on that choice's
    // own numbers, not a value left over from before it was picked.
    ctx.state.summaryMaxWordsManual = false;
    const medianWpm = medianWpmFromProfile(profile);
    if (medianWpm == null) {
      ctx.state.readingPaceProfile = null;
      // The control has to be re-rendered even though no value changed: clearing a profile lowers
      // the floor again, and a slider left at the old minimum forbids what the setter now permits,
      // with no way back below it by dragging (Cato, gating #97).
      updateSummaryIntervalControl(ctx);
      recomputeSummaryMaxWords();
      return;
    }
    ctx.state.readingPaceProfile = {
      name,
      medianWpm,
      recordedAt: profile.recordedAt || null,
      fontSizePx: profile.fontSizePx
    };
    if (Number.isFinite(profile.fontSizePx) && profile.fontSizePx !== ctx.state.fontSize) {
      // Say it. setFontSize persists through saveViewerSettings, so loading a profile silently
      // overwrote a size the operator had deliberately set for the room, with the old value gone and
      // nothing on screen explaining the change. Restoring the measured size is right (the pace is
      // only valid at the size it was measured at) but it is not something to do behind their back.
      const previous = ctx.state.fontSize;
      setFontSize(profile.fontSizePx);
      updateStatus(ctx, `Text size set to ${ctx.state.fontSize}px, the size this reading pace was measured at (was ${previous}px).`);
    }
    const recommendedWords = recommendWordsPerCard(medianWpm, READING_PACE_COMFORTABLE_SECONDS).words;
    const recommendedInterval = recommendSummaryIntervalSeconds(medianWpm, recommendedWords).seconds;
    if (recommendedInterval !== ctx.state.summaryIntervalSeconds) {
      const previousInterval = ctx.state.summaryIntervalSeconds;
      setSummaryInterval(recommendedInterval);
      updateStatus(ctx, `Update interval set to ${ctx.state.summaryIntervalSeconds}s, recommended for this reader's measured pace (was ${previousInterval}s).`);
    } else {
      // setSummaryInterval never runs when the recommendation matches what's already set, and it is
      // the only other thing that re-renders the control -- without this a slower profile's raised
      // floor never reaches the slider's own min/max.
      updateSummaryIntervalControl(ctx);
    }
    recomputeSummaryMaxWords();
  }

  // Runs once at boot (start-app.js). No profile pointer, a fetch failure, or a server that refuses
  // (off-loopback, or simply not there) all leave ctx.state.readingPaceProfile at its initial null --
  // the app must work with none set exactly as it did before this existed, so every failure path here
  // is silent, never a status message or an alert the operator did not ask for.
  async function applyLastReadingPaceProfile() {
    const name = ctx.state.readingPaceProfileName;
    if (!name) return;
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        `/api/reading-pace/${encodeURIComponent(name)}`,
        {},
        { setTimeoutFn, clearTimeoutFn }
      );
      if (!response.ok) return;
      const profile = await response.json();
      applyReadingPaceProfile(name, profile);
    } catch {
      // Server unreachable, request timed out, or a malformed response -- none of these are worth
      // surfacing for a nice-to-have applied silently at boot. medianWpmForBudget's own fallback
      // (DEFAULT_MEDIAN_WPM) already covers "no profile" correctly.
    }
    populateReadingPaceProfileOptions();
  }

  // Mirrors refreshRecordingList/populateRecordingOptions (issue #3) -- same shape, fetch the
  // server's list, rebuild the <option> set, same defensive empty-list fallback.
  async function refreshReadingPaceProfileList() {
    try {
      const response = await fetchImpl('/api/reading-pace/list');
      const data = await response.json().catch(() => ({}));
      ctx.state.availableReadingPaceProfiles = Array.isArray(data?.profiles) ? data.profiles : [];
    } catch {
      ctx.state.availableReadingPaceProfiles = ctx.state.availableReadingPaceProfiles || [];
    }
    populateReadingPaceProfileOptions();
  }

  function populateReadingPaceProfileOptions() {
    const select = ctx.dom.readingPaceProfileSelect;
    if (!select) return;

    const profiles = ctx.state.availableReadingPaceProfiles || [];
    select.innerHTML = '';

    const noneOption = createOptionElementFn();
    noneOption.value = '';
    noneOption.textContent = 'No profile (assumed pace)';
    select.appendChild(noneOption);

    for (const profile of profiles) {
      const option = createOptionElementFn();
      option.value = profile.name;
      option.textContent = profile.name;
      select.appendChild(option);
    }

    // A remembered name that no longer exists on disk (deleted since last load) falls back to no
    // profile -- same correction populateRecordingOptions makes for a deleted recording -- rather
    // than leaving the select showing a name the server has nothing behind.
    const stillExists = profiles.some((profile) => profile.name === ctx.state.readingPaceProfileName);
    select.value = stillExists ? ctx.state.readingPaceProfileName : '';
  }

  // Picking a profile (or "No profile") from the settings picker: persists the pointer, then applies
  // (or clears) it immediately, so the derived words-per-card display updates without a reload.
  function setReadingPaceProfileName(name) {
    const next = name || '';
    if (next === ctx.state.readingPaceProfileName) return;
    ctx.state.readingPaceProfileName = next;
    localStorage.setItem(STORAGE.readingPaceProfileName, next);
    if (!next) {
      applyReadingPaceProfile(null, null);
      return;
    }
    applyLastReadingPaceProfile();
  }

  // #62, Steve 2026-08-08 on the issue thread (not the 2026-08-25 comment, which only settled which
  // control "the recording toggle" meant): "in progress" is the microphone being LIVE, not
  // `listening` alone -- "AI paused with the mic stopped is a safe moment to change a provider."
  // activeTranscriptionStatusLevel()'s 'listening' is a STATIC per-driver-type flag (isLive: true
  // for browser/openai, false for demo/replay, set once at driver creation and never flipped by
  // stop()), so it alone cannot detect a pause -- pauseActiveTranscription() calls driver.stop()
  // without discarding the driver reference, so the type flag would still read 'listening' after a
  // pause. `paused` is the actual stop signal here; the type flag only rules out demo/replay, which
  // are never "live" regardless of pause state, so rehearsing never locks anything.
  function syncMeetingLock() {
    ctx.state.meetingInProgress = Boolean(
      ctx.state.listening && !ctx.state.paused && activeTranscriptionStatusLevel() === 'listening'
    );
    syncSettingsPanel(ctx);
    applyMeetingInProgressLock(ctx);
  }

  async function startListening({ force = false } = {}) {
    if (ctx.state.listening && !force) return;
    if (ctx.state.transcriptionSource === 'openai' && !ctx.state.openAiReady) {
      updateStatus(ctx, 'OpenAI transcription is unavailable until OPENAI_API_KEY is set.', { level: 'problem' });
      return;
    }

    // Same reasoning as #106's awaitingNewSpeakerArrival just below: the operator's own Start press
    // begins a new speaker, an internal force:true resume (pause/resume, song mode's auto-resume)
    // continues the same one, so only a genuine press clears the name.
    if (!force) setSpeakerName('');

    const driver = await ensureTranscriptionDriver();
    if (typeof driver.setMode === 'function') driver.setMode(ctx.state.mode);

    try {
      await driver.start({ currentMode: ctx.state.mode });
      // NOT a liveness signal -- this only means "a transcription driver is running" and
      // stop/pause/loop logic depends on that. Whether a microphone is actually live comes from
      // the driver's own `isLive` via activeTranscriptionStatusLevel().
      ctx.state.listening = true;
      ctx.dom.startListening.disabled = true;
      ctx.dom.stopListening.disabled = false;
      // #62: freeze controls that change what the pipeline does, not just how the result looks.
      syncMeetingLock();
      // #106: only the operator's own Start press, not an internal force:true resume (pause/resume,
      // song mode's auto-resume) -- those continue the same speaker, they are not a new one.
      if (!force) ctx.state.awaitingNewSpeakerArrival = true;
      startLoop();
      // Replay is not a live source, so the rail must never say "Listening" for it: the driver
      // states its own level (manual while replaying, problem when the recording could not be
      // loaded or holds no lines), and overwriting that here would both claim a live microphone
      // and wipe a real failure the operator needs to see. The silence watchdog is meaningless
      // too -- a gap in a recording is not a dead microphone, so "Check mic" would be a lie.
      if (!ctx.state.paused && activeTranscriptionStatusLevel() === 'listening') {
        updateStatus(ctx, 'Listening.', { level: 'listening' });
        startSilenceWatchdog();
      }
    } catch (error) {
      updateStatus(ctx, `Could not start listening: ${error.message}`, { level: 'problem' });
    }
  }

  async function pauseActiveTranscription() {
    clearInterval(ctx.state.loopHandle);
    ctx.state.loopHandle = null;
    idleTranscriptProgressBar();
    if (transcriptionDriver) {
      await transcriptionDriver.stop();
    }
  }

  async function stopListening() {
    ctx.state.listening = false;
    stopSilenceWatchdog();
    stopAudioLevelTest();
    // Clears the loop's interval synchronously (see pauseActiveTranscription), so no further
    // scheduled tick can start after this point -- only a call already in flight before Stop was
    // pressed can still be racing us.
    await pauseActiveTranscription();
    // INV-11's finish line: Stop is the one moment we know for certain the speaker is not
    // mid-sentence, so it must force a drain that bypasses BUCKET_SETTLE_MS's "still talking"
    // hold -- otherwise an unpunctuated final chunk (Chrome's Web Speech API routinely fails to
    // punctuate a closing utterance) sits in the bucket forever, since nothing else will ever
    // drain it once listening has stopped.
    //
    // If a scheduled call was already mid-flight when Stop was pressed, awaiting it here first
    // (rather than firing the drain in parallel) is what prevents a double-send: that call's own
    // removeConsumed() will have already run by the time this await resolves, so the drain below
    // only ever sees whatever text is genuinely still unconsumed.
    if (ctx.state.summarizeCallPromise) {
      await ctx.state.summarizeCallPromise;
    }
    await summarizeCurrentText(undefined, { settleMs: 0, maxRuns: FINAL_FLUSH_MAX_RUNS });
    ctx.state.summaryHistory = [];
    // After the flush above, not before -- whatever was still in the bucket must drain under the
    // speaker who was actually talking when it was said.
    setSpeakerName('');
    ctx.dom.startListening.disabled = false;
    ctx.dom.stopListening.disabled = true;
    // Cato, PR #149 round 3: stopListening() never reset `paused`, so Start -> Pause -> Stop ->
    // Start left it stuck true across the boundary. Before #62 that was a narrower cosmetic gap
    // (the Pause button kept reading "Resume", and the "Manual mode." status below never fired).
    // Since #62 it is a real hole: syncMeetingLock()'s `!ctx.state.paused` term reads the stale
    // value at the SECOND Start, computes meetingInProgress as false, and every lockable control
    // stays unlocked with a live microphone actually running. Stop is unambiguously "the meeting
    // is over" -- nothing can be paused when nothing is running, so this resets it here rather
    // than leaving it for the next pause/resume cycle to correct by accident.
    ctx.state.paused = false;
    updatePauseButton(ctx);
    // #62: releases the freeze applied in startListening.
    syncMeetingLock();
    // The `!ctx.state.paused` guard this used to carry is gone now that paused is always false by
    // this point -- Stop always means the rail says "Manual mode.", not just an unpaused Stop.
    updateStatus(ctx, 'Manual mode.', { level: 'manual' });
  }

  async function pauseAi() {
    ctx.state.paused = true;
    updatePauseButton(ctx);
    stopSilenceWatchdog();
    // Two different questions, and they must not share an answer. `wasListening` decides whether
    // there is a driver to stop (control flow); only a genuinely live source may be described as
    // a stopped microphone (wording). Sourcing the sentence from state.listening claimed "microphone
    // stopped" during a replay, where there is no microphone -- the same lie as the recovery sites
    // above. pauseActiveTranscription() stops the driver without discarding it, so the helper still
    // answers correctly after the await.
    const wasListening = ctx.state.listening;
    const wasLiveCapture = activeTranscriptionStatusLevel() === 'listening';
    if (wasListening) {
      await pauseActiveTranscription();
    }
    // #62: releases the freeze the moment the mic genuinely stops, per `paused` above.
    syncMeetingLock();
    return wasLiveCapture;
  }

  async function resumeAi() {
    ctx.state.paused = false;
    updatePauseButton(ctx);
    if (ctx.state.listening) {
      await startListening({ force: true });
      // Same honesty rule as startListening: there is no microphone behind replay, so resuming it
      // must not announce one. startListening() has already let the driver state its own level.
      // undefined (not false) when listening but not live -- silent, same as the original code's
      // fall-through: a replay resuming must not claim a microphone it doesn't have, but it also
      // never claimed to be "stopped" either.
      return activeTranscriptionStatusLevel() === 'listening' ? true : undefined;
    }
    return false;
  }

  async function togglePauseAi() {
    // A manual press always wins going forward: whatever auto-pause put us here (song mode included)
    // stops being this function's business the moment the operator makes their own call.
    ctx.state.songAutoPaused = false;
    if (!ctx.state.paused) {
      const wasLiveCapture = await pauseAi();
      updateStatus(
        ctx,
        wasLiveCapture
          ? 'AI paused — microphone stopped. Manual lines still work.'
          : 'AI paused. Manual lines still work.',
        { level: 'paused' }
      );
      return;
    }

    const resumedLive = await resumeAi();
    if (resumedLive) {
      updateStatus(ctx, 'AI resumed — microphone listening again.', { level: 'listening' });
    } else if (resumedLive === false) {
      updateStatus(ctx, 'AI resumed. Microphone is still stopped.', { level: 'manual' });
    }
  }

  async function setTranscriptionSource(source) {
    if (!source || ctx.state.transcriptionSource === source) return;

    // Cato, PR #149 B3: the old guard stopped whenever `listening` was true but only restarted
    // when also `!paused`, so switching source while paused ran the FULL stopListening() teardown
    // (final flush, summaryHistory cleared, speaker name cleared, Stop disabled/Start enabled,
    // rail to "Manual mode.") and then never restarted -- silently ending the meeting while the
    // rail still read "Paused" and Resume did nothing. Reachable because #62 only locks these
    // buttons while genuinely, unpaused, live -- pausing releases them.
    //
    // While paused there is nothing live to stop: pauseActiveTranscription() already called
    // driver.stop() when the operator paused. So this only needs the same teardown+restart dance
    // when genuinely listening and not paused; while paused (or not listening at all), swapping
    // the source is enough -- ensureTranscriptionDriver() already rebuilds lazily from the wrong-id
    // check the next time startListening() runs, which is exactly what resumeAi() calls.
    const wasGenuinelyListening = ctx.state.listening && !ctx.state.paused;
    if (wasGenuinelyListening) {
      await stopListening();
    }

    ctx.state.transcriptionSource = source;
    localStorage.setItem(STORAGE.transcriptionSource, source);
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);

    if (wasGenuinelyListening) {
      await startListening();
    }
  }

  function setSummarizationSource(source) {
    // The falsy guard runs FIRST: a call with no source is not a choice, and recording one would let
    // a stray call mark the operator as having picked whatever happens to be selected. Re-picking the
    // current source IS a choice, though -- clicking Demo while already on Demo is exactly how someone
    // confirms it deliberately -- so the flag is set for that case before the no-op early-out.
    if (!source) return;
    ctx.state.summarizationSourceChosen = true;
    localStorage.setItem(STORAGE.summarizationSourceChosen, 'true');
    // Persist WHAT was chosen before the no-op early-out, not after it. Re-picking the already-selected
    // source is the commonest way to set the chosen flag (it is how you confirm a default), and the old
    // order returned before this line ran -- leaving chosen=true with no stored source at all. Observed
    // in the wild on 2026-07-30. The two values are meant to be read together by INV-13, so a stored
    // half of the pair is worse than neither half: it asserts the operator decided, without recording
    // what they decided, and the source then silently comes from the load-time default instead.
    const unchanged = ctx.state.summarizationSource === source;
    ctx.state.summarizationSource = source;
    localStorage.setItem(STORAGE.summarizationSource, source);
    if (unchanged) return;
    summarizationDriver = null;
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);
  }

  function promptProviderSetup(kind, source) {
    if (!kind || !source) return;
    if (source === 'browser') {
      updateStatus(ctx, 'Browser speech recognition is not available in this browser.');
      return;
    }
    ctx.state.registrationProvider = source;
    ctx.state.pendingProviderSelection = { provider: source, kind, source };
    updateStatus(ctx, `Add ${source === 'openai' ? 'an OpenAI' : 'a Claude'} key to use this provider.`);
    openSettingsForProvider(source, kind);
  }

  async function saveProviderKey(provider, value) {
    const clean = normalizeText(value || '');
    if (!clean) {
      updateStatus(ctx, `Paste a ${provider === 'claude' ? 'Claude' : 'OpenAI'} key before saving.`);
      return;
    }
    const response = await fetchImpl('/api/provider/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey: clean })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Saving provider key failed.');
    }
    applyProviderConfig(data);
    updateStatus(ctx, `${provider === 'claude' ? 'Claude' : 'OpenAI'} key saved.`);
    applyPendingSelection(provider);
  }

  async function testProviderKey(provider, value) {
    // Only ever send a key the operator just typed. This used to fall back to
    // `ctx.state.providerKeys[provider]`, which is NOT a key string -- everywhere else in the app it is
    // the descriptor object from /api/config ({configured, origin, label, masked}, see view.js:820 and
    // provider-availability.js:7). normalizeText stringifies it to the literal "[object Object]", which
    // was then sent as the API key and rejected, so Test failed for everyone whose provider was actually
    // configured -- the only people who would press it. There is deliberately no client-side key to fall
    // back to (INV-12 keeps keys off the browser), so an empty string is correct: it tells the server to
    // use its own key, which is exactly what we want to be testing.
    const clean = normalizeText(typeof value === 'string' ? value : '');
    updateStatus(ctx, `Testing ${provider === 'claude' ? 'Claude' : 'OpenAI'} key...`);
    try {
      const response = await fetchWithTimeout(fetchImpl, '/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey: clean
        })
      }, { setTimeoutFn, clearTimeoutFn });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Provider test failed.');
      }
      updateStatus(ctx, `${provider === 'claude' ? 'Claude' : 'OpenAI'} key verified.`);
    } catch (error) {
      updateStatus(ctx, `${provider === 'claude' ? 'Claude' : 'OpenAI'} key test failed: ${error.message}`);
    }
  }

  async function deleteProviderKey(provider) {
    const response = await fetchImpl('/api/provider/key', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Deleting provider key failed.');
    }
    applyProviderConfig(data);
    updateStatus(ctx, `${provider === 'claude' ? 'Claude' : 'OpenAI'} key removed.`);
    clearPendingSelection(provider);
  }

  function setRegistrationProvider(provider) {
    if (provider !== 'openai' && provider !== 'claude') return;
    ctx.state.registrationProvider = provider;
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);
  }

  async function ensureSelectedTranscriptionSourceExists() {
    if (ctx.state.transcriptionSource === 'browser') return;
    // Demo needs nothing, so it can never be the "your source went away" case.
    if (ctx.state.transcriptionSource === 'demo') return;
    if (ctx.state.transcriptionSource === 'openai' && ctx.state.openAiReady) return;
    // A persisted replay selection is honoured as long as at least one recording still exists --
    // this used to fall through to the generic case below, which force-fell-back to browser and
    // silently kicked the operator's choice every reload.
    if (ctx.state.transcriptionSource === 'replay' && ctx.state.availableRecordings?.length) return;
    await setTranscriptionSource('browser');
  }

  function resolveAvailableSummarizationSource() {
    // 2026-08-09 reversal (Steve): a fresh install used to default here to demo with nothing
    // configured and nothing chosen, on the reasoning that demo is a harmless out-of-the-box state.
    // A real incident showed the cost of ever reaching demo by anything other than an explicit
    // click: a dropped/misread flag reaching this branch would put fabricated content on a live
    // wall with nothing to distinguish it from a real summary. Falling through to the ordinary
    // unready-openai fallback below is the safer unconfigured state -- it renders as "no key
    // configured, manual mode still works" (see server/summarization.js), never as scripted text
    // that looks real.
    //
    // Demo needs no key, so an EXPLICIT choice of it is always honoured -- and the chosen flag is
    // what makes it explicit. This check used to read the source alone, which was safe only while
    // 'demo' in storage could mean nothing else. Once the keyless first run started writing 'demo'
    // there too, the two meanings became indistinguishable: add a key later, reload, and this rule
    // honoured a "choice" nobody made, putting rehearsal-script sentences on a live wall with no
    // alert. That is INV-13's exact failure, so demo must never be reachable without the flag.
    if (ctx.state.summarizationSource === 'demo' && ctx.state.summarizationSourceChosen) return 'demo';
    if (ctx.state.summarizationSource === 'openai' && ctx.state.openAiReady) return 'openai';
    if (ctx.state.summarizationSource === 'claude' && ctx.state.anthropicReady) return 'claude';
    if (ctx.state.anthropicReady) return 'claude';
    if (ctx.state.openAiReady) return 'openai';
    return getDefaultSummarizationSource();
  }

  async function ensureSelectedSummarizationSourceExists() {
    const previousSource = ctx.state.summarizationSource;
    const nextSource = resolveAvailableSummarizationSource();
    if (nextSource === previousSource) return;

    ctx.state.summarizationSource = nextSource;
    localStorage.setItem(STORAGE.summarizationSource, nextSource);
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);
    // The switch itself is not an error -- summaries are still running -- but it is a fact the
    // operator did not choose and should be told about, transiently, rather than left to notice
    // only by checking Settings. A silent automatic provider switch is its own kind of dishonesty
    // even though nothing is broken.
    const label = nextSource === 'claude' ? 'Claude' : nextSource === 'openai' ? 'OpenAI' : nextSource;
    flashRailNote(ctx, `Summaries switched to ${label} (previous source unavailable).`);
  }

  function isTypingTarget(target) {
    return Boolean(target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
  }

  async function loadRuntimeConfig() {
    try {
      // Fetched alongside /api/config rather than after it -- both are independent, and
      // ensureSelectedTranscriptionSourceExists() below needs the recording list settled before it
      // can honour (or fall back from) a persisted replay selection.
      // The catch is attached here, not at the await: startApp() renders before this runs and the
      // recording list is a nice-to-have, so a failure in it must never fail the boot path. Two
      // real ways it bites without this -- /api/config throwing first leaves this promise with no
      // handler at all (unhandled rejection), and a rejection reaching the await below would both
      // skip ensureSelectedSummarizationSourceExists() and mis-report a recordings problem as
      // "Could not read AI status".
      const recordingListLoaded = refreshRecordingList().catch((error) => {
        console.warn('[recordings]', error?.message || error);
      });
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const data = await response.json();
      applyProviderConfig(data);
      await recordingListLoaded;
      await ensureSelectedSummarizationSourceExists();
      await ensureSelectedTranscriptionSourceExists();
    } catch (error) {
      if (ctx.dom.apiWarning) {
        ctx.dom.apiWarning.textContent = 'Could not read AI status. Manual lines still work.';
      }
      if (ctx.dom.alertsSection) {
        ctx.dom.alertsSection.hidden = false;
      }
      updateStatus(ctx, `Could not read AI status: ${error.message}`);
    }
  }

  function applyProviderConfig(data = {}) {
    // Issue #4: the only place the app learns the commit it is actually running -- the browser has
    // no git. 'unknown' (start-app.js's initial state) survives untouched if this field is ever
    // absent, which is the honest answer, not an empty string or a guess.
    if (data.appCommit) ctx.state.appCommit = data.appCommit;
    ctx.state.providerKeys = data.providerKeys || ctx.state.providerKeys || {};
    ctx.state.serverOpenAiReady = Boolean(data.hasOpenAIKey);
    ctx.state.serverAnthropicReady = Boolean(data.hasAnthropicKey);
    ctx.state.openAiReady = Boolean(
      ctx.state.providerKeys.openai?.configured || ctx.state.serverOpenAiReady
    );
    ctx.state.anthropicReady = Boolean(
      ctx.state.providerKeys.claude?.configured || ctx.state.serverAnthropicReady
    );
    updateProviderAvailability();
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);
  }

  function updateProviderAvailability() {
    syncSettingsPanel(ctx);
    updateStatus(
      ctx,
      ctx.state.openAiReady
        ? 'Manual mode is ready. OpenAI key detected.'
        : ctx.state.anthropicReady
          ? 'Manual mode is ready. Browser transcription and Claude summaries are available.'
          // 2026-08-09 reversal (Steve): demo is no longer an implicit fallback for a keyless
          // install, so this can no longer say summaries "work with no key" -- they do not run at
          // all until a key is added or Demo is explicitly selected. Browser transcription and
          // manual typing are the only things genuinely available here.
          : 'Manual mode is ready. Browser transcription works with no key. Add a provider key in AI services for live summaries, or select Demo to see the app end-to-end.'
    );
  }

  // The indicator must be right from the first frame, not merely once a toggle or a tick runs it --
  // otherwise a page load with recording on by default would show nothing until the first summarize
  // tick, an honest-looking gap that is itself a small dishonesty (INV-10).
  updateRecordingIndicator();

  // Fast-and-testimony meeting: ten or more unrelated people in an hour, usually not introduced by
  // name. Stopping and starting between them would reset context, but it tears down the microphone
  // and the VAD for about a second, and a second is a large fraction of a ninety second testimony.
  // This gives the same fresh start with no gap in capture.
  //
  // Order matters. Drain FIRST, while the outgoing speaker's history is still in place, so their
  // last sentence is summarized with their own context rather than the next person's. Only then
  // clear. settleMs 0 is the same forced drain stopListening uses, for the same reason: nothing else
  // will ever come along to flush that tail.
  async function startNewSpeaker() {
    // Wait out any call already in flight FIRST, exactly as stopListening does a few lines below,
    // and for a sharper reason here. summarizeCurrentText returns early while summarizeInFlight
    // is set, so without this the drain is silently skipped while the history is cleared anyway.
    // The outgoing speaker's tail then stays in the bucket, and since testimony meeting never
    // leaves speaker mode, takeOldestModeRun merges it into one contiguous run with the next
    // speaker's opening: one card spanning two people, written in confident first person, which
    // neither the operator nor a reader who cannot hear the room could detect.
    if (ctx.state.summarizeCallPromise) {
      await ctx.state.summarizeCallPromise;
    }
    await summarizeCurrentText(undefined, { settleMs: 0, maxRuns: FINAL_FLUSH_MAX_RUNS });
    ctx.state.summaryHistory = [];
    ctx.state.lastSentText = '';
    // #106: the new speaker's first complete sentence deserves the same #31 fast path the very
    // first speaker of the meeting gets, not a wait on whatever is left of the old interval.
    ctx.state.awaitingNewSpeakerArrival = true;
  }

  return {
    addLine,
    cancelClearArm,
    clearLines,
    handleTranscriptEvent,
    setRecordingEnabled,
    // Exposed so a test (or a future replay/diagnostics tool) can trigger a flush deterministically
    // instead of waiting on the real setInterval inside startLoop.
    flushRecordingQueue,
    deleteProviderKey,
    focusProviderKey: openSettingsForProvider,
    isTypingTarget,
    isProviderConfigured: (provider) => isProviderConfigured(ctx, provider),
    isSourceConfigured: (kind, source) => isSourceConfigured(ctx, kind, source),
    loadRuntimeConfig,
    setDisplayMargin,
    setFontSize,
    setFontFamily,
    setFontWeight,
    setMode,
    setSpeakerName,
    addProgramEntry,
    updateProgramEntry,
    removeProgramEntry,
    sendHeaderLine,
    setPanelOpen: (open, options) => {
      if (!open) stopAudioLevelTest();
      else refreshMicReadiness();
      return setSettingsOpen(ctx, open, options);
    },
    setSummaryInterval,
    setSummaryMaxWordsOverride,
    applyReadingPaceProfile,
    applyLastReadingPaceProfile,
    refreshReadingPaceProfileList,
    setReadingPaceProfileName,
    setSummarizationSource,
    setTranscriptionSource,
    setRegistrationProvider,
    promptProviderSetup,
    saveProviderKey,
    showRecentTranscript,
    startListening,
    startLoop,
    stopListening,
    testProviderKey,
    summarizeCurrentText,
    togglePauseAi,
    undoLine,
    removeItem,
    updateItemText,
    updatePauseButton: () => updatePauseButton(ctx),
    toggleSettingsOpen: () => {
      const next = !(ctx.state.settingsOpen ?? ctx.state.panelOpen);
      if (!next) stopAudioLevelTest();
      else refreshMicReadiness();
      return setSettingsOpen(ctx, next);
    },
    setSettingsOpen: (open, options) => {
      if (!open) stopAudioLevelTest();
      else refreshMicReadiness();
      return setSettingsOpen(ctx, open, options);
    },
    populateAudioDeviceOptions,
    refreshMicReadiness,
    setAudioDeviceId,
    refreshRecordingList,
    setSelectedRecordingId,
    setReplaySpeed,
    toggleAudioLevelTest,
    stopAudioLevelTest,
    updateSourceButtons: () => updateSourceButtons(ctx),
    syncViewerControls: () => syncViewerControls(ctx),
    saveViewerSettings: () => saveViewerSettings(ctx),
    beginDisplayMarginAdjustment,
    endDisplayMarginAdjustment,
    renderDisplay: () => renderDisplay(ctx)
  };
}
