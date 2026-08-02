// Reading-pace measurement page (issue #14). Standalone, not linked from the main app UI. Flow:
// intro -> 2 discarded practice cards -> 8 timed real cards -> "All done." Results are reached
// only via ?results, so the reader (Deaf, ASL-first, low vision) can never land on his own
// numbers. Never shown to him: a timer, countdown, score, speed, or "too slow" state. No audio.
import { clampFontSize } from './services/view-settings.js';
import {
  median,
  cardWordsPerMinute,
  recommendWordsPerCard,
  recommendSummaryIntervalSeconds,
  longerCardsReadSlower,
  READING_PACE_COMFORTABLE_SECONDS
} from './services/reading-pace.js';
import { PRACTICE_CARDS, READING_PACE_CARDS } from './services/reading-pace-cards.js';

const STORAGE_KEY = 'readingPaceResults';

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Matches the live app's own read: public/controller/start-app.js reads the same 'fontSize' key
// through clampFontSize, so a value this page never wrote (or an old one from a previous session)
// still resolves exactly the way it would on the real display.
function currentFontSize() {
  return clampFontSize(localStorage.getItem('fontSize'), 84);
}

function applyDisplayFontSize() {
  document.documentElement.style.setProperty('--font-size', `${currentFontSize()}px`);
}

function loadStoredResults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveResultsLocally(results) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  } catch {
    // Best-effort persistence only; a full/blocked localStorage should not stop the flow.
  }
}

// Durable save (issue #44, first slice of named reader profiles): persists the named result to disk
// via the server instead of only localStorage, which loses the measurement on a cleared browser and
// can't move between machines. localStorage is still written first, unconditionally, as the
// fallback of last resort -- this call only ever adds to that, never replaces it.
async function saveResultsToDisk(name, results) {
  try {
    const response = await fetch('/api/reading-pace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, payload: results })
    });
    if (!response.ok) return false;
    const body = await response.json();
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}

// Prefers the saved file on disk, falling back to whatever is in localStorage on this device.
async function loadResultsForDisplay(name) {
  if (name) {
    try {
      const response = await fetch(`/api/reading-pace/${encodeURIComponent(name)}`);
      if (response.ok) {
        const payload = await response.json();
        if (payload && Array.isArray(payload.cards)) return payload;
      }
    } catch {
      // Fall through to localStorage below.
    }
  }
  return loadStoredResults();
}

function runMeasurementFlow() {
  const introScreen = document.getElementById('introScreen');
  const cardScreen = document.getElementById('cardScreen');
  const doneScreen = document.getElementById('doneScreen');
  const startButton = document.getElementById('startButton');
  const nextButton = document.getElementById('nextButton');
  const paceCardText = document.getElementById('paceCardText');

  let finalResults = null;

  // Practice cards first (times discarded), then the real, recorded cards.
  const sequence = [
    ...PRACTICE_CARDS.map((text) => ({ text, practice: true })),
    ...READING_PACE_CARDS.map((text) => ({ text, practice: false }))
  ];

  let index = 0;
  let cardShownAt = 0;
  const results = [];

  function showCard() {
    const card = sequence[index];
    paceCardText.textContent = card.text;
    cardShownAt = performance.now();
  }

  // A press this fast is a double-press or a bounce, not a person reading. The median survives one
  // 13,000 wpm outlier, but the longer-cards-read-slower slope does not: a single bad sample can
  // invert that verdict. Ignoring the press costs him nothing (he presses again) and keeps the
  // sample honest.
  const MIN_PLAUSIBLE_PRESS_MS = 700;

  function advance() {
    const card = sequence[index];
    const ms = performance.now() - cardShownAt;

    if (ms < MIN_PLAUSIBLE_PRESS_MS) return;

    if (!card.practice) {
      results.push({ text: card.text, words: wordCount(card.text), chars: card.text.length, ms });
    }

    index += 1;

    if (index >= sequence.length) {
      cardScreen.hidden = true;
      doneScreen.hidden = false;
      // Record the font size the run was measured at. It is the one variable that voids the whole
      // exercise: a pace measured at a different type size does not transfer to the display, and
      // without it stored there is no way to tell afterwards whether it did.
      finalResults = {
        recordedAt: new Date().toISOString(),
        fontSizePx: currentFontSize(),
        cards: results
      };
      // localStorage write is unconditional and happens immediately -- this is the fallback of last
      // resort, not something contingent on the operator naming and saving the profile below.
      saveResultsLocally(finalResults);
      return;
    }

    showCard();
  }

  startButton.addEventListener('click', () => {
    introScreen.hidden = true;
    cardScreen.hidden = false;
    showCard();
  });

  nextButton.addEventListener('click', advance);

}

function formatWpm(wpm) {
  return `${Math.round(wpm)} wpm`;
}

async function renderResults() {
  // Hide every other screen first. Without this the intro sat above the results with a live START
  // button: opening ?results in front of the reader showed him the instructions again, and a stray
  // press would have restarted the run and overwritten what had just been measured.
  for (const id of ['introScreen', 'cardScreen', 'doneScreen']) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  const resultsScreen = document.getElementById('resultsScreen');
  resultsScreen.hidden = false;

  // ?results=NAME looks up the named saved profile on disk first; plain ?results (or a lookup
  // failure) falls back to whatever this device has in localStorage.
  const name = new URLSearchParams(window.location.search).get('results') || '';
  const stored = await loadResultsForDisplay(name);

  // The save handler belongs HERE, not in runMeasurementFlow. The form lives on this screen and
  // this screen is the only one that renders on ?results, so a listener attached in the other
  // entrypoint never exists when the button is pressed. Worse than dead: with no handler the form
  // did a native GET, dropping ?results, landing on the intro screen with a live START, and arming
  // a re-run that would overwrite the very results being saved.
  const saveProfileForm = document.getElementById('saveProfileForm');
  const saveProfileName = document.getElementById('saveProfileName');
  const saveProfileStatus = document.getElementById('saveProfileStatus');

  if (saveProfileForm) {
    saveProfileForm.addEventListener('submit', async (event) => {
      // Unconditional, and first: a native submit is what caused the failure above, so it must be
      // prevented even when there is nothing to save.
      event.preventDefault();
      const readerName = saveProfileName.value.trim();
      if (!readerName) {
        saveProfileStatus.textContent = 'Give it a name first.';
        return;
      }
      if (!stored) {
        saveProfileStatus.textContent = 'Nothing to save: no results on this device.';
        return;
      }

      saveProfileStatus.textContent = 'Saving...';
      const saved = await saveResultsToDisk(readerName, stored);
      saveProfileStatus.textContent = saved
        ? `Saved as "${readerName}".`
        : 'Could not save to disk. Still kept on this device.';
    });
  }
  const emptyBlock = document.getElementById('resultsEmpty');
  const body = document.getElementById('resultsBody');

  if (!stored || !Array.isArray(stored.cards) || stored.cards.length === 0) {
    emptyBlock.hidden = false;
    body.hidden = true;
    return;
  }

  emptyBlock.hidden = true;
  body.hidden = false;

  const cards = stored.cards;
  const wpmValues = cards.map((card) => cardWordsPerMinute(card));

  const tableBody = document.getElementById('resultsTableBody');
  tableBody.replaceChildren(
    ...cards.map((card, cardIndex) => {
      const row = document.createElement('tr');
      const wpm = wpmValues[cardIndex];
      row.innerHTML = `
        <td>${cardIndex + 1}. ${card.text}</td>
        <td>${card.words}</td>
        <td>${(card.ms / 1000).toFixed(1)}</td>
        <td>${formatWpm(wpm)}</td>
      `;
      return row;
    })
  );

  const medianWpm = median(wpmValues);
  const fastestIndex = wpmValues.indexOf(Math.max(...wpmValues));
  const slowestIndex = wpmValues.indexOf(Math.min(...wpmValues));

  document.getElementById('resultsMedian').textContent = formatWpm(medianWpm);
  document.getElementById('resultsFastest').textContent =
    `${formatWpm(wpmValues[fastestIndex])} -- "${cards[fastestIndex].text}"`;
  document.getElementById('resultsSlowest').textContent =
    `${formatWpm(wpmValues[slowestIndex])} -- "${cards[slowestIndex].text}"`;

  const slope = longerCardsReadSlower(cards);
  const slopeLabel =
    slope.verdict === 'yes'
      ? 'Yes -- longer cards read proportionally slower.'
      : slope.verdict === 'no'
        ? 'No -- pace held steady or improved on longer cards.'
        : slope.verdict === 'not-enough-data'
          ? 'Not enough data to tell.'
          : 'Unclear from this sample.';
  document.getElementById('resultsSlope').textContent = slopeLabel;

  const wordsRec = recommendWordsPerCard(medianWpm, READING_PACE_COMFORTABLE_SECONDS);
  const intervalRec = recommendSummaryIntervalSeconds(medianWpm, wordsRec.words);

  document.getElementById('resultsRecommendation').textContent =
    `Recommended: ${wordsRec.words} words per card, ${intervalRec.seconds}s update interval.`;
  document.getElementById('resultsRecommendationMath').textContent =
    `Words: ${medianWpm.toFixed(1)} wpm / 60 * ${wordsRec.seconds}s = ${wordsRec.rawWords.toFixed(1)} words, ` +
    `snapped to ${wordsRec.words}. Interval: ${wordsRec.words} words / ${medianWpm.toFixed(1)} wpm * 60 = ` +
    // "rounded" was a lie whenever the raw value fell outside the settings range: below about 16 wpm
    // the raw interval exceeds the 30s ceiling and gets clamped, not rounded, and saying "rounded"
    // there hides that the recommendation is the limit of what the app can be set to rather than
    // what the arithmetic asked for.
    `${intervalRec.rawSeconds.toFixed(1)}s, ${Math.round(intervalRec.rawSeconds) === intervalRec.seconds ? 'rounded' : 'clamped'} to ${intervalRec.seconds}s.`;

  const rawJson = document.getElementById('resultsRawJson');
  rawJson.value = JSON.stringify(stored, null, 2);

  document.getElementById('downloadResults').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(stored, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'reading-pace-results.json';
    link.click();
    URL.revokeObjectURL(url);
  });
}

applyDisplayFontSize();

if (new URLSearchParams(window.location.search).has('results')) {
  renderResults();
} else {
  runMeasurementFlow();
}
