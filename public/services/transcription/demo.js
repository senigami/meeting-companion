import { normalizeText } from '../text.js';

// A scripted ~2-minute meeting, used to exercise the transcript-bucket ->
// summarize -> display pipeline with no microphone and no API key. Each
// utterance's delayMs is the gap after the previous utterance's final event
// before this one starts revealing itself.
export const DEMO_SCRIPT = [
  { text: 'Good morning, everyone, and welcome. So good to see so many familiar faces, and a few new ones too.', delayMs: 1200 },
  { text: 'Before we begin, a warm welcome to the Hendersons, who are visiting with us for the first time today.', delayMs: 4500 },
  { text: 'A few notices before we get started.', delayMs: 4000 },
  { text: 'There is a working bee at the hall this coming Saturday morning from nine, to tidy the garden beds and clear the gutters before winter.', delayMs: 3000 },
  { text: 'If you can bring gloves and a rake, that would be a great help. Morning tea will be provided.', delayMs: 4000 },
  { text: 'Also, the shared lunch after the service next Sunday is back on. Please bring a plate to share if you are able.', delayMs: 4500 },
  { text: 'We do want to remember Margaret Ellis and her family this week, following the passing of her husband Tom on Tuesday.', delayMs: 4000 },
  { text: 'The funeral service will be held at the chapel on Thursday at eleven, and all are welcome to attend.', delayMs: 4000 },
  { text: 'Please do keep Margaret and the family in your thoughts and prayers over the coming days.', delayMs: 4500 },
  { text: 'Let us stand together now and turn to our first hymn.', delayMs: 5000 },
  { text: 'This morning we are singing an old favourite, a hymn about grace that carries us through difficult seasons.', delayMs: 3000 },
  { text: 'Let us pray together as we begin.', delayMs: 5500 },
  { text: 'Gracious God, thank you for gathering us here again this morning, in this place, with these people.', delayMs: 3000 },
  { text: 'We bring before you those who are grieving, those who are unwell, and those who are far from home this week.', delayMs: 4000 },
  { text: 'Be near to Margaret and her family in these difficult days, and give them comfort beyond what words can offer.', delayMs: 4500 },
  { text: 'We ask this in a spirit of hope and gratitude. Amen.', delayMs: 4000 },
  { text: 'Thank you. Please be seated.', delayMs: 5000 },
  { text: 'This morning I want to talk about what it means to show up for one another, especially when things are hard.', delayMs: 3000 },
  { text: 'It is easy to be present when everything is going well, but the real test of community comes in the harder seasons.', delayMs: 4000 },
  { text: 'Think about the people who showed up for you at your lowest point. Chances are it was not with grand gestures.', delayMs: 4500 },
  { text: 'It was a meal left on the doorstep, a phone call at the right moment, someone sitting quietly beside you.', delayMs: 4000 },
  { text: 'That is the kind of community we are called to be for one another, patient and present, not perfect.', delayMs: 4500 },
  { text: 'So this week, I would encourage each of us to think of one person who might need that kind of showing up.', delayMs: 4000 },
  { text: 'It might be a phone call, it might be dropping off dinner, it might just be sitting with them for a while.', delayMs: 4000 },
  { text: 'Let us close in a moment of quiet reflection before we finish this morning.', delayMs: 4500 }
];

function buildPartials(text) {
  const words = text.trim().split(/\s+/);
  if (words.length <= 3) return [text];
  const count = Math.max(3, Math.min(5, Math.ceil(words.length / 4)));
  const partials = [];
  for (let i = 1; i <= count; i++) {
    const wordCount = Math.max(1, Math.round((words.length * i) / count));
    partials.push(words.slice(0, wordCount).join(' '));
  }
  return partials;
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
    const partialGapMs = 300;

    for (const utterance of script) {
      cursor += utterance.delayMs;
      const partials = buildPartials(utterance.text);

      partials.forEach((partialText, index) => {
        schedule(cursor + index * partialGapMs, () => emit('partial', partialText));
      });

      const finalDelay = cursor + partials.length * partialGapMs;
      schedule(finalDelay, () => emit('final', utterance.text));
      cursor = finalDelay;
    }

    schedule(cursor + partialGapMs, () => {
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
