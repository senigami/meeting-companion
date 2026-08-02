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
function applyDisplayFontSize() {
  const stored = localStorage.getItem('fontSize');
  const size = clampFontSize(stored, 84);
  document.documentElement.style.setProperty('--font-size', `${size}px`);
}

function loadStoredResults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveResults(results) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  } catch {
    // Best-effort persistence only; a full/blocked localStorage should not stop the flow.
  }
}

function runMeasurementFlow() {
  const introScreen = document.getElementById('introScreen');
  const cardScreen = document.getElementById('cardScreen');
  const doneScreen = document.getElementById('doneScreen');
  const startButton = document.getElementById('startButton');
  const nextButton = document.getElementById('nextButton');
  const paceCardText = document.getElementById('paceCardText');

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

  function advance() {
    const card = sequence[index];
    const ms = performance.now() - cardShownAt;

    if (!card.practice) {
      results.push({ text: card.text, words: wordCount(card.text), chars: card.text.length, ms });
    }

    index += 1;

    if (index >= sequence.length) {
      cardScreen.hidden = true;
      doneScreen.hidden = false;
      saveResults({ recordedAt: new Date().toISOString(), cards: results });
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

function renderResults() {
  const resultsScreen = document.getElementById('resultsScreen');
  resultsScreen.hidden = false;

  const stored = loadStoredResults();
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
    `${intervalRec.rawSeconds.toFixed(1)}s, rounded to ${intervalRec.seconds}s.`;

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
