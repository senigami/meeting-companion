const state = {
  lines: [],
  mode: 'speaker',
  paused: false,
  fontSize: Number(localStorage.getItem('fontSize') || 72),
  transcriptChunks: [],
  recognition: null,
  listening: false,
  loopHandle: null,
  lastSentText: ''
};

const $ = (id) => document.getElementById(id);
const displayEls = ['line1', 'line2', 'line3', 'line4', 'line5'].map($);
const status = $('status');
const liveTranscript = $('liveTranscript');

function saveFont() {
  document.documentElement.style.setProperty('--font-size', `${state.fontSize}px`);
  localStorage.setItem('fontSize', String(state.fontSize));
}

function render() {
  const visible = [...state.lines].slice(-5);
  const padded = Array(5 - visible.length).fill('').concat(visible);
  displayEls.forEach((el, i) => { el.textContent = padded[i] || ''; });
}

function setStatus(text) { status.textContent = text; }

function addLine(line) {
  const clean = String(line || '').trim();
  if (!clean) return;
  if (state.lines[state.lines.length - 1] === clean) return;
  state.lines.push(clean);
  state.lines = state.lines.slice(-20);
  render();
}

function recentTranscript(seconds = 30) {
  const cutoff = Date.now() - seconds * 1000;
  state.transcriptChunks = state.transcriptChunks.filter(c => c.at >= cutoff - 30000);
  return state.transcriptChunks.filter(c => c.at >= cutoff).map(c => c.text).join(' ').trim();
}

function showRecentTranscript() {
  liveTranscript.textContent = recentTranscript(20);
}

async function summarize(text) {
  if (state.paused) return;
  const recent = String(text || recentTranscript(30)).trim();
  if (!recent || recent === state.lastSentText) return;
  state.lastSentText = recent;
  setStatus('Summarizing...');
  try {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: state.mode,
        recentTranscript: recent,
        visibleLines: state.lines.slice(-5)
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    if (data.line) {
      addLine(data.line);
      setStatus(`Added: ${data.line}`);
    } else {
      setStatus(data.reason || 'No new useful line.');
    }
  } catch (err) {
    setStatus(`Could not summarize: ${err.message}`);
  }
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  setStatus(`Mode changed to ${mode}.`);
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus('Speech recognition is not available in this browser. Use manual or paste text.');
    return null;
  }
  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onresult = (event) => {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += text + ' ';
      else interimText += text + ' ';
    }
    if (finalText.trim()) {
      state.transcriptChunks.push({ text: finalText.trim(), at: Date.now() });
    }
    liveTranscript.textContent = `${recentTranscript(20)} ${interimText}`.trim();
  };

  rec.onerror = (event) => setStatus(`Speech recognition error: ${event.error}`);
  rec.onend = () => {
    if (state.listening) {
      try { rec.start(); } catch {}
    }
  };
  return rec;
}

function startLoop() {
  clearInterval(state.loopHandle);
  state.loopHandle = setInterval(() => summarize(), 5000);
}

$('addManual').addEventListener('click', () => {
  addLine($('manualInput').value);
  $('manualInput').value = '';
  $('manualInput').focus();
});
$('manualInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('addManual').click();
});
$('summarizeOnce').addEventListener('click', () => summarize($('pasteTranscript').value));
$('startListening').addEventListener('click', () => {
  state.recognition ||= setupSpeechRecognition();
  if (!state.recognition) return;
  state.listening = true;
  try {
    state.recognition.start();
    startLoop();
    $('startListening').disabled = true;
    $('stopListening').disabled = false;
    setStatus('Listening. The app will add useful lines when it hears something new.');
  } catch (err) {
    setStatus(`Could not start listening: ${err.message}`);
  }
});
$('stopListening').addEventListener('click', () => {
  state.listening = false;
  clearInterval(state.loopHandle);
  if (state.recognition) state.recognition.stop();
  $('startListening').disabled = false;
  $('stopListening').disabled = true;
  setStatus('Listening stopped.');
});
$('pauseAi').addEventListener('click', () => {
  state.paused = !state.paused;
  $('pauseAi').textContent = state.paused ? 'Resume AI' : 'Pause AI';
  setStatus(state.paused ? 'AI paused. Manual lines still work.' : 'AI resumed.');
});
$('undo').addEventListener('click', () => { state.lines.pop(); render(); });
$('clear').addEventListener('click', () => { state.lines = []; render(); });
$('bigger').addEventListener('click', () => { state.fontSize = Math.min(120, state.fontSize + 6); saveFont(); });
$('smaller').addEventListener('click', () => { state.fontSize = Math.max(36, state.fontSize - 6); saveFont(); });
$('fullscreen').addEventListener('click', () => document.documentElement.requestFullscreen?.());
$('hidePanel').addEventListener('click', () => $('panel').classList.remove('open'));
document.querySelectorAll('.mode').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'h') $('panel').classList.toggle('open');
  if (e.key === 'Escape') $('panel').classList.add('open');
});

saveFont();
render();
setInterval(showRecentTranscript, 1000);
