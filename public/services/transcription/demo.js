import { normalizeText } from '../text.js';

// A scripted ~3.5-minute meeting (roughly 470 words at the speaking rate below), used to exercise the transcript-bucket ->
// summarize -> display pipeline with no microphone and no API key. Each
// sentence streams in word by word at a natural speaking rate (see
// WORDS_PER_MINUTE below), then a short, slightly varied pause separates it
// from the next sentence — the way a live speech-recognition engine and a
// real speaker actually behave, not a block of text plopping in every few
// seconds.
// Each entry names the summarization `mode` the real summarizer should be in while it processes
// that line, and an optional `proves` tag naming the coverage scenario the entry exists for (see
// docs/09-demo-scenarios.md for the full matrix). `proves` is test-facing only — most
// lines are plain connective tissue and carry no tag. `pauseBeforeMs`, where present, adds an
// extra deterministic gap before that entry on top of the normal length-derived pause, used only
// for the silence-watchdog scenario.
export const DEMO_SCRIPT = [
  { text: 'Good morning, everyone, and welcome. So good to see so many familiar faces, and a few new ones too.', mode: 'speaker', proves: 'speaker-narrative' },
  { text: 'Before we begin, a warm welcome to the Hendersons, who are visiting with us for the first time today.', mode: 'speaker' },
  { text: 'A few notices before we get started.', mode: 'speaker' },
  { text: 'There is a working bee at the hall this coming Saturday morning from nine, to tidy the garden beds and clear the gutters before winter.', mode: 'speaker' },
  { text: 'If you can bring gloves and a rake, that would be a great help. We will have a chance to catch up together once the work is done.', mode: 'speaker' },
  { text: 'Also, a reminder that the youth are organizing a working bee at the Hendersons place next Sunday afternoon, mowing lawns and doing a few odd jobs. Please let one of the youth leaders know if you can lend a hand.', mode: 'speaker', proves: 'speaker-invitation' },
  { text: 'We do want to remember Margaret Ellis and her family this week, following the passing of her husband Tom on Tuesday.', mode: 'speaker' },
  { text: 'Tom had been part of this community for 42 years, right up until the end, and would be so touched to see everyone gathered like this.', mode: 'speaker', proves: 'speaker-embedded-number' },
  { text: 'The funeral service will be held at the chapel on Thursday, 11:00 a.m., and all are welcome to attend.', mode: 'information', proves: 'info-date-time-place' },
  { text: 'Please do keep Margaret and the family in your thoughts and prayers over the coming days.', mode: 'speaker' },
  { text: 'Let us stand together now and turn to our first hymn.', mode: 'speaker' },
  { text: 'This morning we are singing an old favourite, a hymn about grace that carries us through difficult seasons.', mode: 'song', proves: 'song-commentary-must-not-appear' },
  { text: 'Let us pray together as we begin.', mode: 'speaker' },
  { text: 'Gracious God, thank you for gathering us here again this morning, in this place, with these people.', mode: 'prayer' },
  { text: 'We bring before you those who are grieving, those who are unwell, and those who are far from home this week.', mode: 'prayer', proves: 'prayer-multiple-requests' },
  { text: 'Be near to Margaret and her family in these difficult days, and give them comfort beyond what words can offer.', mode: 'prayer' },
  { text: 'We ask this in a spirit of hope and gratitude. Amen.', mode: 'prayer' },
  { text: 'Thank you. Please be seated.', mode: 'speaker' },
  { text: 'This morning I want to talk about what it means to show up for one another, especially when things are hard.', mode: 'speaker' },
  { text: 'It is easy to be present when everything is going well, but the real test of community comes in the harder seasons.', mode: 'speaker' },
  { text: 'Think about the people who showed up for you at your lowest point. Chances are it was not with grand gestures.', mode: 'speaker' },
  { text: 'He never made a fuss about it, he just turned up, every single time, without being asked.', mode: 'speaker', proves: 'speaker-pronoun-heavy' },
  { text: 'It was a lift to an appointment when a car would not start, a phone call at the right moment, someone sitting quietly beside you.', mode: 'speaker' },
  { text: 'That is the kind of community we are called to be for one another, patient and present, not perfect.', mode: 'speaker' },
  { text: 'So this week, I would encourage each of us to think of one person who might need that kind of showing up.', mode: 'speaker' },
  { text: 'It might be a phone call, it might be mowing someone\'s lawn, it might just be sitting with them for a while.', mode: 'speaker' },
  { text: 'Let us close in a moment of quiet reflection before we finish this morning.', mode: 'speaker' },
  { text: 'For our closing hymn, we will sing hymn number 152.', mode: 'information', proves: 'info-hymn-number' },
  { text: 'Hymn 152, ready to sing, so please stand if you are able.', mode: 'song', proves: 'song-status-with-number' },
  { text: 'Oh gentle light upon the hills, and grace that never fails, we lift our voices to the sky, and walk where mercy trails.', mode: 'song', proves: 'song-lyrics-must-not-appear' },
  { text: 'Before we close, a reading from John, chapter 3, verses 16 to 18, for anyone wanting to look it up this week.', mode: 'information', proves: 'info-scripture-reference' },
  { text: 'Next week, could we please have platform 1 and microphone 2 covered by the same volunteers as last month.', mode: 'information', proves: 'info-assignments' },
  { text: 'Also, the working bee starts at 9:00, morning tea runs for 20 minutes at 10:30, and wristbands are available at the front desk.', mode: 'information', proves: 'info-multi-fact' },
  { text: 'If it is not too much trouble, and only if people have a spare moment, the roster for the next 4 weeks is now up on the notice board.', mode: 'information', proves: 'info-courtesy-padding' },
  { text: 'Heavenly Father, thank you for this day. Amen.', mode: 'prayer', proves: 'prayer-short' },
  { text: 'Heavenly Father, we come before you again, and we just want to say thank you, thank you for the sunshine this week, and for safe travels for the Hendersons, and we ask that you would be with anyone who is traveling in the week ahead, and we ask that you would watch over the youth as they plan their working bee, and we remember again those who are unwell, and we just ask for your peace over this whole community, in Jesus name, Amen.', mode: 'prayer', proves: 'prayer-long-rambling' },
  { text: 'So, um, you know, I just wanted to, uh, say thank you to everyone who helped out last week.', mode: 'speaker', proves: 'edge-disfluency' },
  { text: 'The car park will be resurfaced next month, so please park on the street where you can.', mode: 'speaker', proves: 'edge-duplicate-line' },
  { text: 'The car park will be resurfaced next month, so please park on the street where you can.', mode: 'speaker' },
  { text: 'It has been a big year for this little community, with the working bees and the visits and the meals shared around and the quiet help nobody sees and the way everyone just keeps turning up for each other no matter what the week has thrown at them.', mode: 'speaker', proves: 'edge-run-on' },
  { text: 'and if anyone wants to grab a cuppa afterwards we will be out the back near the kitchen', mode: 'speaker', proves: 'edge-unpunctuated-tail' },
  { text: 'Let us take one more moment of quiet before we finish.', mode: 'speaker', proves: 'edge-silence-gap', pauseBeforeMs: 25000 },
  { text: 'Amen.', mode: 'prayer', proves: 'edge-minimal-utterance' }
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
  onModeChange = () => {},
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
      // pauseBeforeMs is an explicit extra gap on top of the normal length-derived pause, used
      // only for the silence-watchdog scenario -- it does not replace the deterministic default.
      if (sentence.pauseBeforeMs) cursor += sentence.pauseBeforeMs;

      // The mode is applied before this entry's own text is emitted, so the summarizer that later
      // consumes this text sees the mode the scenario actually belongs to, not whatever mode a
      // prior entry left behind.
      const entryMode = sentence.mode || 'speaker';
      schedule(cursor, () => onModeChange(entryMode));

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
    isLive: false,
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
