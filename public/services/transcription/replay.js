import { normalizeText } from '../text.js';

// GitHub issue #3: replay a recorded session back through the live transcript -> summarize ->
// display pipeline. The recording is NDJSON written by session-recording.js/session-recorder.js
// (ADR-0004): one `{ t: 'chunk', at, id, mode, text }` record per final transcript line, plus
// `{ t: 'summary', ... }` records this driver ignores entirely -- replay only re-drives the
// transcription side, never the summarizer's own history.
//
// A recording holds no partials, only finals, so this driver must never synthesize one -- that
// would invent data the recording does not contain. It is also, deliberately, the one source an
// operator can never mistake for a live feed: every status it reports states its own level rather
// than relying on the prose classifier (see runtime.js's onStatus comment for why that guessing
// game already burned a real diagnostic once).

const VALID_SPEEDS = new Set(['1', '4', 'max']);

export function normalizeReplaySpeed(speed) {
  const clean = String(speed ?? '1');
  return VALID_SPEEDS.has(clean) ? clean : '1';
}

// A truncated/garbled line is an expected condition, not a corrupt file -- the recorder appends
// fire-and-forget while a live meeting is still running, so the very last line can be cut off
// mid-write. Skip it and keep going rather than aborting the whole replay.
function parseChunks(raw) {
  const chunks = [];
  const lines = String(raw || '').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!record || record.t !== 'chunk') continue;

    const at = Date.parse(record.at);
    if (!Number.isFinite(at)) continue;

    chunks.push({ at, mode: record.mode || 'speaker', speaker: record.speaker || '', text: record.text || '' });
  }

  return chunks;
}

export function createReplayTranscriptionDriver({
  onEvent = () => {},
  onStatus = () => {},
  onModeChange = () => {},
  // Issue #40: a replay must reproduce the same speaker labels the operator actually saw, so the
  // recorded chunk's speaker is re-applied the same way its recorded mode already is.
  onSpeakerChange = () => {},
  fetchImpl = fetch,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  recordingId = '',
  speed = '1'
} = {}) {
  let mode = 'speaker';
  let speaker = '';
  let running = false;
  let timers = [];
  // `running` alone cannot cancel a start() that is parked on the fetch below: Start is only
  // disabled after start() resolves, so a second click (or a stop/start) mid-fetch leaves the
  // first call to resume with running back to true and schedule a duplicate set of timers --
  // every line of the recording emitted twice. The token makes a superseded start() bail out.
  let startToken = 0;

  function emit(text) {
    const clean = normalizeText(text);
    if (!clean) return;
    onEvent({ source: 'replay', type: 'final', text: clean });
  }

  function schedule(delay, fn) {
    const timer = setTimeoutFn(fn, delay);
    timers.push(timer);
    return timer;
  }

  function clearTimers() {
    for (const timer of timers) clearTimeoutFn(timer);
    timers = [];
  }

  // null divisor means "max": every chunk fires at delay 0, still in recorded order, still
  // through setTimeoutFn so a test's fake clock can drive it deterministically.
  function speedDivisor() {
    if (speed === 'max') return null;
    const numeric = Number(speed);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  }

  // Timers are laid out synchronously up front from an absolute cursor, the same shape as
  // demo.js's playScript(), so timing is reproducible and every one of them is reachable by
  // stop()'s clearTimers().
  function playChunks(chunks) {
    if (chunks.length === 0) {
      onStatus('This recording has no transcript lines to replay.', { level: 'problem' });
      running = false;
      return;
    }

    const firstAt = chunks[0].at;
    const divisor = speedDivisor();

    for (const chunk of chunks) {
      const delay = divisor === null ? 0 : Math.max(0, (chunk.at - firstAt) / divisor);
      const entryMode = chunk.mode || 'speaker';
      const entrySpeaker = chunk.speaker || '';

      schedule(delay, () => {
        // Mode and speaker are both applied before this chunk's text is emitted, and only when
        // each actually changes, so the summarizer/display see the mode and speaker the recording
        // says were active without re-announcing either on every single line.
        if (entryMode !== mode) {
          mode = entryMode;
          onModeChange(entryMode);
        }
        if (entrySpeaker !== speaker) {
          speaker = entrySpeaker;
          onSpeakerChange(entrySpeaker);
        }
        emit(chunk.text);
      });
    }

    const lastAt = chunks[chunks.length - 1].at;
    const finishDelay = divisor === null ? 0 : Math.max(0, (lastAt - firstAt) / divisor);
    schedule(finishDelay, () => {
      onStatus('Replay finished.', { level: 'manual' });
    });
  }

  return {
    id: 'replay',
    label: 'Replay',
    // Reads a recorded file, not a live microphone -- the status rail must never say
    // "Listening" for this driver, and the silence watchdog must stay off (a gap in a
    // recording is not a dead microphone).
    isLive: false,
    isAvailable() {
      return Boolean(recordingId);
    },
    setMode(nextMode) {
      mode = nextMode || 'speaker';
    },
    async start({ currentMode } = {}) {
      mode = currentMode || mode;
      const token = ++startToken;
      if (running) clearTimers();
      running = true;

      // States its own level explicitly rather than depending on transcriptionStatusLevel()'s
      // prose-sniffing fallback -- the whole point of replay is that it must never be mistaken
      // for a live feed.
      onStatus('Replaying a recorded session — not live.', { level: 'manual' });

      if (!recordingId) {
        onStatus('No recording selected to replay.', { level: 'problem' });
        running = false;
        return;
      }

      let raw;
      try {
        const response = await fetchImpl(`/api/recording/${encodeURIComponent(recordingId)}`);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        raw = await response.text();
      } catch (error) {
        // A superseded start()'s failure must not report a problem over the live one, nor clear
        // its `running` flag out from under it.
        if (token !== startToken) return;
        onStatus(`Could not load the recording: ${error.message}`, { level: 'problem' });
        running = false;
        return;
      }

      if (!running || token !== startToken) return;
      playChunks(parseChunks(raw));
    },
    async stop() {
      running = false;
      clearTimers();
    }
  };
}
