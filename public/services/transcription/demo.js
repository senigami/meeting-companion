import { normalizeText } from '../text.js';

// A scripted ~3.5-minute meeting (roughly 470 words at the speaking rate below), used to exercise the transcript-bucket ->
// summarize -> display pipeline with no microphone and no API key. Each
// sentence streams in word by word at a natural speaking rate (see
// WORDS_PER_MINUTE below), then a short, slightly varied pause separates it
// from the next sentence — the way a live speech-recognition engine and a
// real speaker actually behave, not a block of text plopping in every few
// seconds.
export const DEMO_SCRIPT = [
  { text: 'Good morning, everyone, and welcome. So good to see so many familiar faces, and a few new ones too.' },
  { text: 'Before we begin, a warm welcome to the Hendersons, who are visiting with us for the first time today.' },
  { text: 'A few notices before we get started.' },
  { text: 'There is a working bee at the hall this coming Saturday morning from nine, to tidy the garden beds and clear the gutters before winter.' },
  { text: 'If you can bring gloves and a rake, that would be a great help. We will have a chance to catch up together once the work is done.' },
  { text: 'Also, a reminder that the youth are organizing a working bee at the Hendersons place next Sunday afternoon, mowing lawns and doing a few odd jobs. Please let one of the youth leaders know if you can lend a hand.' },
  { text: 'We do want to remember Margaret Ellis and her family this week, following the passing of her husband Tom on Tuesday.' },
  { text: 'The funeral service will be held at the chapel on Thursday at eleven, and all are welcome to attend.' },
  { text: 'Please do keep Margaret and the family in your thoughts and prayers over the coming days.' },
  { text: 'Let us stand together now and turn to our first hymn.' },
  { text: 'This morning we are singing an old favourite, a hymn about grace that carries us through difficult seasons.' },
  { text: 'Let us pray together as we begin.' },
  { text: 'Gracious God, thank you for gathering us here again this morning, in this place, with these people.' },
  { text: 'We bring before you those who are grieving, those who are unwell, and those who are far from home this week.' },
  { text: 'Be near to Margaret and her family in these difficult days, and give them comfort beyond what words can offer.' },
  { text: 'We ask this in a spirit of hope and gratitude. Amen.' },
  { text: 'Thank you. Please be seated.' },
  { text: 'This morning I want to talk about what it means to show up for one another, especially when things are hard.' },
  { text: 'It is easy to be present when everything is going well, but the real test of community comes in the harder seasons.' },
  { text: 'Think about the people who showed up for you at your lowest point. Chances are it was not with grand gestures.' },
  { text: 'It was a lift to an appointment when a car would not start, a phone call at the right moment, someone sitting quietly beside you.' },
  { text: 'That is the kind of community we are called to be for one another, patient and present, not perfect.' },
  { text: 'So this week, I would encourage each of us to think of one person who might need that kind of showing up.' },
  { text: 'It might be a phone call, it might be mowing someone\'s lawn, it might just be sitting with them for a while.' },
  { text: 'Let us close in a moment of quiet reflection before we finish this morning.' }
];

// Ordinary conversational/pulpit speech runs roughly 130-160 words per
// minute; 145 sits in the middle of that range and reads as an unhurried,
// natural speaking pace on screen.
const WORDS_PER_MINUTE = 145;
const MS_PER_WORD = 60000 / WORDS_PER_MINUTE;

// A short, natural beat between sentences rather than a metronomic gap.
// Derived deterministically from the sentence's own length (longer sentences
// tend to be followed by a slightly longer breath) so replays are
// reproducible and Math.random() stays out of testable code.
const BASE_PAUSE_MS = 500;
const PAUSE_VARIANCE_MS = 900;

function sentencePauseMs(text) {
  return BASE_PAUSE_MS + (text.length % 7) * (PAUSE_VARIANCE_MS / 7);
}

export function createDemoTranscriptionDriver({
  onEvent = () => {},
  onStatus = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  script = DEMO_SCRIPT
} = {}) {
  let mode = 'speaker';
  let running = false;
  let timers = [];

  function emit(type, text) {
    const clean = normalizeText(text);
    if (!clean) return;
    onEvent({ source: 'demo', type, text: clean });
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

  function playScript() {
    let cursor = 0;

    for (const sentence of script) {
      const words = sentence.text.trim().split(/\s+/);

      words.forEach((_, index) => {
        const wordCount = index + 1;
        const partialText = words.slice(0, wordCount).join(' ');
        cursor += MS_PER_WORD;
        schedule(cursor, () => emit('partial', partialText));
      });

      schedule(cursor, () => emit('final', sentence.text));
      cursor += sentencePauseMs(sentence.text);
    }

    schedule(cursor, () => {
      onStatus('Demo source finished. Press Stop, then Start to replay.');
    });
  }

  return {
    id: 'demo',
    label: 'Demo',
    isAvailable() {
      return true;
    },
    setMode(nextMode) {
      mode = nextMode || 'speaker';
    },
    async start({ currentMode } = {}) {
      mode = currentMode || mode;
      if (running) {
        clearTimers();
      }
      running = true;
      onStatus('Demo source running — replaying a sample meeting.');
      playScript();
    },
    async stop() {
      running = false;
      clearTimers();
    }
  };
}
