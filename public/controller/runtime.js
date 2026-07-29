import { appendUniqueChunk, normalizeText } from '../services/text.js';
import {
  appendTranscriptItems,
  createTranscriptItems
} from '../services/transcript-display.js';
import {
  createSummarizationDriver,
  createTranscriptionDriver
} from '../services/registry.js';
import { fetchWithTimeout } from '../services/fetch-timeout.js';
import { getDefaultSummarizationSource } from '../services/catalog.js';
import {
  clampDisplayMargin,
  clampFontSize,
  clampSummaryIntervalSeconds,
  clampSummaryMaxWords
} from '../services/view-settings.js';
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
  syncViewerControls,
  setDisplayMarginGuidesVisible,
  updateSummaryIntervalControl,
  updateSummaryMaxWordsControl
} from './view.js';
import {
  bucketText,
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

const STORAGE = {
  fontSize: 'fontSize',
  displayMargin: 'displayMargin',
  summaryInterval: 'summaryIntervalSeconds',
  summaryMaxWords: 'summaryMaxWords',
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
  audioBypassForTest: 'audioBypassForTest'
};

const CLEAR_ARM_TIMEOUT_MS = 3000;
const UNDO_STATUS_MAX_CHARS = 40;

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

function truncateForStatus(text, maxChars = UNDO_STATUS_MAX_CHARS) {
  const clean = typeof text === 'string' ? text : '';
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean;
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
  const {
    createTranscriptionDriverFn = createTranscriptionDriver,
    createSummarizationDriverFn = createSummarizationDriver,
    fetchImpl = fetch,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    nowFn = Date.now,
    documentImpl = globalThis.document
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
    globalThis.requestAnimationFrame?.(() => {
      const target = ctx.dom.serviceRegistrationKeyInput;
      target?.focus?.();
      target?.select?.();
    });
  }

  function addLine(line, { source = 'manual', mode = ctx.state.mode } = {}) {
    const clean = normalizeText(line);
    if (!clean) return false;
    const nextItems = createTranscriptItems({
      text: clean,
      mode,
      source
    });
    if (!nextItems.length) return false;
    ctx.state.transcriptItems = appendTranscriptItems(ctx.state.transcriptItems, nextItems);
    renderDisplay(ctx);
    showRecentTranscript();
    return true;
  }

  function undoLine() {
    if (!ctx.state.transcriptItems.length && ctx.state.lastClearedItems) {
      const restored = ctx.state.lastClearedItems;
      ctx.state.transcriptItems = restored;
      ctx.state.lastClearedItems = null;
      renderDisplay(ctx);
      const lineWord = restored.length === 1 ? 'line' : 'lines';
      flashRailNote(ctx, `Restored ${restored.length} ${lineWord}.`, { setTimeoutFn, clearTimeoutFn });
      return;
    }
    const [removed] = ctx.state.transcriptItems.splice(-1, 1);
    renderDisplay(ctx);
    if (removed) {
      const text = `Removed: "${truncateForStatus(removed.text)}"`;
      updateStatus(ctx, text);
      flashRailNote(ctx, text, { setTimeoutFn, clearTimeoutFn });
    }
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
    ctx.state.transcriptItems = [];
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
    updateStatus(ctx, ctx.state.listening ? 'Listening.' : 'Manual mode.', {
      level: ctx.state.listening ? 'listening' : 'manual'
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

  function startSilenceWatchdog() {
    stopSilenceWatchdog();
    ctx.state.lastTranscriptEventAt = nowFn();
    scheduleSilenceCheck();
  }

  function stopSilenceWatchdog() {
    clearTimeoutFn(ctx.state.silenceWatchdogTimer);
    ctx.state.silenceWatchdogTimer = null;
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

  function handleTranscriptEvent(event) {
    if (!event?.text) return;
    noteTranscriptActivity();

    if (event.type === 'final') {
      // Tag the chunk with the mode active right now, when the words were actually captured --
      // not whatever mode happens to be selected later when this backlogged text is finally
      // summarized. Reading ctx.state.mode at summarize time let backlogged Information-mode
      // announcements drain and get labelled as Speaker once the operator had since switched modes.
      ctx.state.transcriptChunks = appendUniqueChunk(ctx.state.transcriptChunks, event.text, nowFn(), ctx.state.mode);
      ctx.state.transcriptPreview = '';
    } else if (event.type === 'partial') {
      ctx.state.transcriptPreview = normalizeText(event.text);
    }

    showRecentTranscript();
  }

  function buildTranscriptionDriver() {
    return createTranscriptionDriverFn(ctx.state.transcriptionSource, {
      onEvent: handleTranscriptEvent,
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
      fetchImpl,
      setTimeoutFn,
      clearTimeoutFn
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
    if (ctx.dom.apiWarning) {
      ctx.dom.apiWarning.hidden = true;
      ctx.dom.apiWarning.textContent = '';
    }
    if (ctx.dom.alertsSection) {
      ctx.dom.alertsSection.hidden = true;
    }
    if (ctx.dom.settingsAlertBadge) {
      ctx.dom.settingsAlertBadge.hidden = true;
    }
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
    if (ctx.dom.apiWarning) {
      ctx.dom.apiWarning.hidden = false;
      ctx.dom.apiWarning.textContent = 'AI summaries are failing. Manual lines still work.';
    }
    if (ctx.dom.alertsSection) {
      ctx.dom.alertsSection.hidden = false;
    }
    if (ctx.dom.settingsAlertBadge) {
      ctx.dom.settingsAlertBadge.hidden = false;
    }
    ctx.state.summarizeFailureAlertActive = true;
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
    updateStatus(ctx, ctx.state.listening ? 'Listening.' : 'Manual mode.', {
      level: ctx.state.listening ? 'listening' : 'manual'
    });
  }

  async function summarizeCurrentText(text) {
    if (ctx.state.paused) return;
    if (ctx.state.summarizeInFlight) {
      noteSkippedSummarizeTick();
      return;
    }
    resetSkippedSummarizeTicks();

    let consumedChunks = null;
    let sendMode = ctx.state.mode;
    let recent;
    if (text) {
      recent = normalizeText(text);
    } else {
      const { consumable } = partitionBucket(ctx.state.transcriptChunks);
      // The whole oldest contiguous mode run, not the oldest ~1000 characters -- lag is now bounded
      // at one card, whatever the volume, and the run's own text (built by takeOldestModeRun itself
      // from these exact chunks) is what gets sent below, so "sent" and "consumed" are provably the
      // same set. A later mode in the bucket ends the run early: one summarize call must never span
      // two modes, since its prompt carries a single `Mode:` line.
      const run = takeOldestModeRun(consumable, { defaultMode: ctx.state.mode });
      consumedChunks = run.chunks;
      sendMode = run.mode;
      recent = run.text;
    }
    if (!recent || recent === ctx.state.lastSentText) return;

    // The one-slot rolling-window memory: the previously sent block, held separately from the
    // bucket's own lifetime so it can be handed to the summarizer as distinct labelled context
    // (see .agent/rolling-window-brief.md). Two SEPARATE fields, not a concatenation -- the prompt
    // seat renders "previous, for context only" and "new, summarize this" under distinct labels,
    // and our dedupe only rejects an exact line match, so a concatenated blob would let the model
    // re-summarize old content in different words and sail past that dedupe as a "new" card.
    // Omitted entirely on a mode change: carrying prayer text as context into an information
    // summary invites exactly the cross-mode confusion the mode-run split just fixed.
    const previousBlock =
      ctx.state.lastSentBlock && ctx.state.lastSentBlock.mode === sendMode
        ? ctx.state.lastSentBlock.text
        : '';

    ctx.state.summarizeInFlight = true;
    updateStatus(ctx, 'Summarizing...');
    // Dim rather than remove: these chunks are still in the bucket (INV-11 only drains it on
    // success) and stay visible until this call resolves one way or the other. Set BEFORE the
    // await, so the dim shows the moment the call goes out, not once it comes back.
    if (consumedChunks?.length) {
      ctx.state.inFlightChunks = consumedChunks;
      showRecentTranscript();
    }

    try {
      const driver = await ensureSummarizationDriver();
      const result = await driver.summarize({
        mode: sendMode,
        recentTranscript: recent,
        previousBlock,
        visibleLines: ctx.state.transcriptItems.slice(-10).map((item) => item.text),
        maxWords: ctx.state.summaryMaxWords
      });

      resetSummarizeBackoff();

      if (ctx.state.paused) return;
      // The bucket only drains, and the previous-block slot only advances, on success while
      // unpaused -- a failed or pause-interrupted request re-sends the same sentences next tick
      // and does not shift the rolling window forward under it (INV-11).
      ctx.state.lastSentText = recent;
      ctx.state.lastSentBlock = { text: recent, mode: sendMode };
      if (consumedChunks?.length) {
        ctx.state.transcriptChunks = removeConsumed(ctx.state.transcriptChunks, consumedChunks);
        showRecentTranscript();
      }
      const recoveredLevel = ctx.state.listening ? 'listening' : 'manual';
      if (result.line) {
        // Labelled from the CHUNK's own mode (sendMode), not ctx.state.mode -- backlogged speech
        // must read under the mode it was actually said in, even if the operator has since switched.
        addLine(result.line, { source: 'ai', mode: sendMode });
        updateStatus(ctx, `Added: ${result.line}`, { level: recoveredLevel });
      } else {
        updateStatus(ctx, result.reason || 'No new useful line.', { level: recoveredLevel });
      }
    } catch (error) {
      ctx.state.summarizeFailureCount = (ctx.state.summarizeFailureCount || 0) + 1;
      if (ctx.state.summarizeFailureCount === 3) {
        escalateSummarizeFailure();
      }
      updateStatus(
        ctx,
        `Could not summarize: ${error.message}`,
        ctx.state.summarizeFailureAlertActive ? { level: 'problem' } : undefined
      );
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

  function setMode(mode) {
    ctx.state.mode = mode;
    if (transcriptionDriver && typeof transcriptionDriver.setMode === 'function') {
      transcriptionDriver.setMode(mode);
    }
    updateModeButtons(ctx);
    updateStatus(ctx, `Mode changed to ${mode}.`);
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

  function setSummaryInterval(nextInterval) {
    const next = clampSummaryIntervalSeconds(nextInterval, ctx.state.summaryIntervalSeconds);
    if (next === ctx.state.summaryIntervalSeconds) return;
    ctx.state.summaryIntervalSeconds = next;
    localStorage.setItem(STORAGE.summaryInterval, String(next));
    updateSummaryIntervalControl(ctx);
    updateStatus(ctx, `Update interval set to ${next}s.`);
    if (ctx.state.listening && !ctx.state.paused) {
      startLoop();
    }
  }

  function setSummaryMaxWords(nextMaxWords) {
    const next = clampSummaryMaxWords(nextMaxWords, ctx.state.summaryMaxWords);
    if (next === ctx.state.summaryMaxWords) return;
    ctx.state.summaryMaxWords = next;
    localStorage.setItem(STORAGE.summaryMaxWords, String(next));
    updateSummaryMaxWordsControl(ctx);
    updateStatus(ctx, `Words per card set to ${next}.`);
  }

  async function startListening({ force = false } = {}) {
    if (ctx.state.listening && !force) return;
    if (ctx.state.transcriptionSource === 'openai' && !ctx.state.openAiReady) {
      updateStatus(ctx, 'OpenAI transcription is unavailable until OPENAI_API_KEY is set.', { level: 'problem' });
      return;
    }

    const driver = await ensureTranscriptionDriver();
    if (typeof driver.setMode === 'function') driver.setMode(ctx.state.mode);

    try {
      await driver.start({ currentMode: ctx.state.mode });
      ctx.state.listening = true;
      ctx.dom.startListening.disabled = true;
      ctx.dom.stopListening.disabled = false;
      startLoop();
      if (!ctx.state.paused) {
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
    await pauseActiveTranscription();
    ctx.dom.startListening.disabled = false;
    ctx.dom.stopListening.disabled = true;
    if (!ctx.state.paused) {
      updateStatus(ctx, 'Manual mode.', { level: 'manual' });
    }
  }

  async function togglePauseAi() {
    ctx.state.paused = !ctx.state.paused;
    updatePauseButton(ctx);

    if (ctx.state.paused) {
      stopSilenceWatchdog();
      const wasListening = ctx.state.listening;
      if (wasListening) {
        await pauseActiveTranscription();
      }
      updateStatus(
        ctx,
        wasListening
          ? 'AI paused — microphone stopped. Manual lines still work.'
          : 'AI paused. Manual lines still work.',
        { level: 'paused' }
      );
      return;
    }

    if (ctx.state.listening) {
      await startListening({ force: true });
      updateStatus(ctx, 'AI resumed — microphone listening again.', { level: 'listening' });
    } else {
      updateStatus(ctx, 'AI resumed. Microphone is still stopped.', { level: 'manual' });
    }
  }

  async function setTranscriptionSource(source) {
    if (!source || ctx.state.transcriptionSource === source) return;

    const shouldResume = ctx.state.listening && !ctx.state.paused;
    if (ctx.state.listening) {
      await stopListening();
    }

    ctx.state.transcriptionSource = source;
    localStorage.setItem(STORAGE.transcriptionSource, source);
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);

    if (shouldResume) {
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
    if (ctx.state.summarizationSource === source) return;
    ctx.state.summarizationSource = source;
    localStorage.setItem(STORAGE.summarizationSource, source);
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
    const clean = normalizeText(value || ctx.state.providerKeys?.[provider] || '');
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
    await setTranscriptionSource('browser');
  }

  function resolveAvailableSummarizationSource() {
    // First run, nothing configured, nothing chosen: demo is the expected out-of-the-box state,
    // not an error to alert about. Only applies when zero providers are configured -- if exactly
    // one is, the existing fallback to that provider below is still correct and desirable.
    if (!ctx.state.summarizationSourceChosen && !ctx.state.openAiReady && !ctx.state.anthropicReady) {
      return 'demo';
    }
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

    // Belt and braces with the chosen-flag gate above: the unchosen first-run default is not
    // persisted at all, so storage never holds a 'demo' that means "the app picked this". A stored
    // source should only ever mean "the operator chose it" or "a real provider was substituted".
    const isFirstRunDemoDefault =
      nextSource === 'demo' && !ctx.state.summarizationSourceChosen && !ctx.state.openAiReady && !ctx.state.anthropicReady;

    ctx.state.summarizationSource = nextSource;
    if (!isFirstRunDemoDefault) localStorage.setItem(STORAGE.summarizationSource, nextSource);
    updateSourceButtons(ctx);
    syncSettingsPanel(ctx);
    // The switch itself is not an error -- summaries are still running -- but it is a fact the
    // operator did not choose and should be told about, transiently, rather than left to notice
    // only by checking Settings. A silent automatic provider switch is its own kind of dishonesty
    // even though nothing is broken. Exception: an unchosen, keyless first run defaulting to demo
    // is not a switch from the operator's point of view -- they never chose anything -- so no note.
    if (isFirstRunDemoDefault) return;
    const label = nextSource === 'claude' ? 'Claude' : nextSource === 'openai' ? 'OpenAI' : nextSource;
    flashRailNote(ctx, `Summaries switched to ${label} (previous source unavailable).`);
  }

  function isTypingTarget(target) {
    return Boolean(target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
  }

  async function loadRuntimeConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const data = await response.json();
      applyProviderConfig(data);
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
          // No keys at all is the expected first-run state, not a deficiency, and it is no longer
          // even a limited one: browser transcription works and summaries fall back to demo. Leading
          // with "OpenAI key is missing" told a brand-new operator that something was wrong with an
          // app that was in fact working, which is the same false-alarm problem the alert model had.
          : 'Manual mode is ready. Browser transcription and demo summaries work with no key. Add a provider key in AI services for live summaries.'
    );
  }

  return {
    addLine,
    cancelClearArm,
    clearLines,
    handleTranscriptEvent,
    deleteProviderKey,
    focusProviderKey: openSettingsForProvider,
    isTypingTarget,
    isProviderConfigured: (provider) => isProviderConfigured(ctx, provider),
    isSourceConfigured: (kind, source) => isSourceConfigured(ctx, kind, source),
    loadRuntimeConfig,
    setDisplayMargin,
    setFontSize,
    setMode,
    setPanelOpen: (open, options) => setSettingsOpen(ctx, open, options),
    setSummaryInterval,
    setSummaryMaxWords,
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
    updatePauseButton: () => updatePauseButton(ctx),
    toggleSettingsOpen: () => setSettingsOpen(ctx, !(ctx.state.settingsOpen ?? ctx.state.panelOpen)),
    setSettingsOpen: (open, options) => setSettingsOpen(ctx, open, options),
    updateSourceButtons: () => updateSourceButtons(ctx),
    syncViewerControls: () => syncViewerControls(ctx),
    saveViewerSettings: () => saveViewerSettings(ctx),
    beginDisplayMarginAdjustment,
    endDisplayMarginAdjustment,
    renderDisplay: () => renderDisplay(ctx)
  };
}
