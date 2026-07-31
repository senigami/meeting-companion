import { normalizeText } from '../text.js';

// TEMPORARY DEBUG INSTRUMENTATION -- branch debug/browser-transcription, do not merge.
// Every SpeechRecognition event, timestamped, so we can see what the app's own recognition
// instance is doing rather than guessing from a separate one in the console.
const DEBUG = true;
// Writes to an on-screen panel as well as the console. The console has cost us three rounds of
// "which page, which port, was it focused"; a panel you can SEE also proves you are on this build.
function debugPanel() {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById('__btDebug');
  if (!el) {
    el = document.createElement('div');
    el.id = '__btDebug';
    el.setAttribute('style', [
      'position:fixed', 'left:8px', 'bottom:8px', 'z-index:99999',
      'width:min(560px,46vw)', 'max-height:44vh', 'overflow:auto',
      'background:rgba(8,10,14,.94)', 'color:#9fe7a4', 'border:1px solid #2c4',
      'border-radius:6px', 'padding:8px 10px', 'font:11px/1.45 ui-monospace,Menlo,monospace',
      'white-space:pre-wrap', 'pointer-events:auto'
    ].join(';'));
    el.textContent = 'BROWSER TRANSCRIPTION DEBUG — if you can read this, you are on the debug build.\n';

    // Speech recognition always uses the browser's DEFAULT input device and has no way to pick
    // one. getUserMedia is given an explicit deviceId elsewhere in the app. So the mic test can
    // pass on one device while recognition listens to a different, silent one. This measures the
    // DEFAULT device the same way recognition hears it.
    const btn = document.createElement('button');
    btn.textContent = 'Test the DEFAULT microphone for 5 seconds';
    btn.setAttribute('style', 'margin:6px 0;padding:4px 8px;font:inherit;cursor:pointer');
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === 'audioinput');
        dbg('audio inputs seen by the page:', inputs.map((d) => `${d.label || '(no label)'} [${d.deviceId.slice(0, 12)}]`));

        // No deviceId on purpose: this is the default, which is what recognition listens to.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];
        dbg('DEFAULT device granted:', track?.label, track?.getSettings?.());

        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let peak = 0;
        const started = Date.now();
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i]));
          if (Date.now() - started < 5000) return void setTimeout(tick, 100);
          const db = peak > 0 ? (20 * Math.log10(peak)).toFixed(1) : '-Infinity';
          dbg(`DEFAULT device peak over 5s: ${db} dBFS ${peak === 0 ? '<-- DIGITAL SILENCE, this is the bug' : '<-- device is producing audio'}`);
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
          btn.disabled = false;
        };
        dbg('measuring the default device, please talk now...');
        tick();
      } catch (err) {
        dbg('default-device probe FAILED:', String(err));
        btn.disabled = false;
      }
    };
    el.appendChild(btn);
    document.body.appendChild(el);
  }
  return el;
}
function dbg(...args) {
  if (!DEBUG) return;
  const stamp = new Date().toISOString().slice(11, 23);
  const line = `[${stamp}] ` + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log('[bt]', line);
  const el = debugPanel();
  if (el) {
    el.textContent += line + '\n';
    el.scrollTop = el.scrollHeight;
  }
}
// Reachable from the console too, so the panel can be read even if it is behind something.
if (typeof window !== 'undefined') {
  window.__btDebug = dbg;
  // Draw the panel at load rather than on the first event, so you can tell you are on the debug
  // build BEFORE pressing anything. Also states up front whether the API exists at all.
  dbg('module loaded', {
    SpeechRecognition: typeof window.SpeechRecognition,
    webkitSpeechRecognition: typeof window.webkitSpeechRecognition,
    secureContext: window.isSecureContext,
    origin: window.location.origin
  });
}

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isFatalSpeechRecognitionError(error) {
  return !['no-speech', 'aborted'].includes(String(error || '').toLowerCase());
}

export function createBrowserTranscriptionDriver({
  onEvent = () => {},
  onStatus = () => {},
  language = 'en-US',
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  let recognition = null;
  let listening = false;
  let started = false;
  let restartFailureCount = 0;
  let restartTimer = null;

  // A transient blip (network flap, audio device hiccup) must never end
  // transcription for the rest of a meeting the operator isn't watching, so
  // restarts back off exponentially but never stop trying. 500ms lets a
  // one-off failure recover almost instantly; doubling per consecutive
  // failure spaces out a sustained outage instead of spinning; the 30s
  // ceiling keeps the driver checking often enough to notice recovery
  // quickly once the underlying condition clears.
  const RESTART_BASE_DELAY_MS = 500;
  const RESTART_MAX_DELAY_MS = 30000;

  function clearRestartTimer() {
    if (restartTimer !== null) {
      clearTimeoutFn(restartTimer);
      restartTimer = null;
    }
  }

  function attemptRestart() {
    if (!listening || !recognition) return;
    try {
      recognition.start();
      started = true;
      if (restartFailureCount > 0) {
        onStatus('Browser transcription is listening again.');
      }
      restartFailureCount = 0;
    } catch {
      restartFailureCount += 1;
      // Prefixing with "Speech recognition error:" keeps this read as
      // non-fatal by transcriptionStatusLevel in runtime.js, so the operator
      // sees "retrying", never "stopped" — while it keeps retrying.
      onStatus(`Speech recognition error: retrying microphone connection (attempt ${restartFailureCount})...`);
      scheduleRestart();
    }
  }

  function scheduleRestart() {
    clearRestartTimer();
    const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** (restartFailureCount - 1), RESTART_MAX_DELAY_MS);
    restartTimer = setTimeoutFn(() => {
      restartTimer = null;
      attemptRestart();
    }, delay);
  }

  function emit(type, text, extra = {}) {
    const clean = normalizeText(text);
    if (!clean) { dbg('emit DROPPED by normalizeText', { type, raw: text }); return; }
    dbg('emit ->', type, JSON.stringify(clean));
    onEvent({ source: 'browser', type, text: clean, ...extra });
  }

  function ensureRecognition() {
    if (recognition) return recognition;
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) return null;

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    const doc = typeof document !== 'undefined' ? document : null;
    dbg('recognition constructed', { lang: language, hasFocus: doc?.hasFocus?.(), visibility: doc?.visibilityState });

    // The events that tell us whether the microphone was ever opened, versus opened and silent.
    recognition.onstart = () => dbg('onstart -- service accepted the request');
    recognition.onaudiostart = () => dbg('onaudiostart -- MICROPHONE IS OPEN');
    recognition.onsoundstart = () => dbg('onsoundstart -- sound of any kind detected');
    recognition.onspeechstart = () => dbg('onspeechstart -- speech detected');
    recognition.onspeechend = () => dbg('onspeechend');
    recognition.onsoundend = () => dbg('onsoundend');
    recognition.onaudioend = () => dbg('onaudioend -- microphone closed');
    recognition.onnomatch = () => dbg('onnomatch -- heard something, recognized nothing');

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += `${text} `;
        else interimText += `${text} `;
      }

      restartFailureCount = 0;
      dbg('onresult', { final: finalText.trim(), interim: interimText.trim(), results: event.results.length });
      if (finalText.trim()) emit('final', finalText, { source: 'browser' });
      if (interimText.trim()) emit('partial', interimText, { source: 'browser' });
    };

    recognition.onerror = (event) => {
      const error = String(event?.error || 'unknown error');
      dbg('onerror', error, 'fatal:', isFatalSpeechRecognitionError(error));
      if (isFatalSpeechRecognitionError(error)) {
        listening = false;
        started = false;
        onStatus(`Browser transcription stopped after speech recognition error: ${error}`);
        return;
      }

      onStatus(`Speech recognition error: ${error}`);
    };
    recognition.onend = () => {
      dbg('onend', { listening, willRestart: listening });
      started = false;
      if (listening) attemptRestart();
    };

    return recognition;
  }

  return {
    id: 'browser',
    label: 'Browser',
    // A live microphone is behind this driver -- the status rail may say "Listening".
    isLive: true,
    isAvailable() {
      return Boolean(getSpeechRecognition());
    },
    async start() {
      dbg('start() called', { alreadyStarted: started, listening });
      const rec = ensureRecognition();
      if (!rec) throw new Error('Speech recognition is not available in this browser.');
      clearRestartTimer();
      listening = true;
      restartFailureCount = 0;
      if (!started) {
        try {
          rec.start();
          dbg('rec.start() returned without throwing');
        } catch (err) {
          dbg('rec.start() THREW', String(err));
          throw err;
        }
        started = true;
      } else {
        dbg('SKIPPED rec.start() because started was already true');
      }
      onStatus('Browser transcription is listening.');
    },
    async stop() {
      listening = false;
      started = false;
      clearRestartTimer();
      restartFailureCount = 0;
      if (recognition) recognition.stop();
      onStatus('Browser transcription stopped.');
    }
  };
}
