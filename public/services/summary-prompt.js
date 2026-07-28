// The display contract, in one place: a card is at most this many words, because it is read at a
// distance in one glance by someone who may be hard of hearing. Exported so every summarizer honours
// the same number -- the demo summarizer used its own character budget and put lines on the wall
// twice this long, and nothing caught it because the limit only existed as prose inside the prompt.
export const SUMMARY_MAX_WORDS = 14;

// The operator can set a card length, but maxWords lands directly inside the prompt text sent to the
// model, so it is clamped rather than trusted: anything non-numeric or outside the range falls back
// to the shared default. The clamp lives here, next to the prompt it protects, so the number in a
// prompt is always the number that was honoured -- when the clamp lived only on the server, the
// client could hand back a prompt claiming a limit the server had already rejected.
export const MAX_WORDS_MIN = 6;
export const MAX_WORDS_MAX = 24;

export function clampMaxWords(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return SUMMARY_MAX_WORDS;
  const rounded = Math.round(numeric);
  if (rounded < MAX_WORDS_MIN || rounded > MAX_WORDS_MAX) return SUMMARY_MAX_WORDS;
  return rounded;
}

export function modeInstruction(mode = 'speaker') {
  switch (mode) {
    case 'information':
      return 'Prioritize exact dates, times, places, hymn numbers, assignments, and announcements. Copy every number, name, and date exactly; drop the surrounding courtesy words rather than shortening a detail.';
    case 'song':
      return 'Only show hymn or song status. Do not show lyrics or commentary.';
    case 'prayer':
      return 'Write a short prayer-shaped line that keeps the main requests and tone. Start with a simple opening like "Heavenly Father" and end with "Amen". Do not summarize line by line.';
    case 'speaker':
    default:
      return 'Focus on the specific story, event, teaching, feeling, invitation, or example.';
  }
}

export function cleanModelLine(line = '') {
  return String(line).trim().replace(/^[-•*]\s*/, '').replace(/^"|"$/g, '').replace(/\s+/g, ' ');
}

function lineKey(line = '') {
  return cleanModelLine(line).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isVagueLine(line = '') {
  return [
    /^he is talking about faith$/i,
    /^she is talking about faith$/i,
    /^they are talking about faith$/i,
    /\b(talking|speaking|sharing|discussing) about faith\b/i,
    /\b(talking|speaking|sharing|discussing) about the message\b/i,
    /^\s*(something important is being shared|the speaker is giving encouragement|they are sharing something important)\s*$/i,
    /^\s*(faith|message|encouragement|teaching|lesson|announcement|summary)\s*$/i,
    /\bstill talking about\b/i
  ].some((pattern) => pattern.test(line));
}

export function shouldAcceptModelLine(line, visibleLines = []) {
  const clean = cleanModelLine(line);
  if (!clean) return false;
  if (isVagueLine(clean)) return false;

  const key = lineKey(clean);
  if (!key) return false;

  const visibleKeys = visibleLines.map(lineKey);
  if (visibleKeys.includes(key)) return false;

  return true;
}

export function buildSummarizePrompt({
  mode = 'speaker',
  recentTranscript = '',
  visibleLines = [],
  maxWords = SUMMARY_MAX_WORDS
} = {}) {
  const wordLimit = clampMaxWords(maxWords);
  const visibleBlock = visibleLines.filter(Boolean).length
    ? visibleLines.filter(Boolean).map((line) => `- ${line}`).join('\n')
    : '- none';

  return `
You are creating large-print assistive text for one deaf, low-vision person during a church meeting.
American Sign Language is their first language and English is their second, so write clean, simple
English -- never ASL gloss or ASL word order, which is not a writing system and reads as broken text.
They read slowly and see poorly, so every word on the card has to earn its place: one card is one
glance, and a word spent on filler is a word they pay for.

Return zero or one line.
Only add a line when the transcript contains something useful that is new or more specific than the lines already shown.
If the moment is vague or repetitive, return an empty string.
Avoid lines like "He is talking about faith."

Write a single short line that would help someone reading from across the room.
Do not use labels such as "main point," "speaker," "summary," or "announcement."
Do not say "still talking about."
Use plain, specific language.
Lead with the topic or the person the line is about, then say what about it. Never open with a
subordinate clause ("If you are able to help, ...") -- put the thing first ("Working bee Saturday").
Preserve names, dates, times, hymn numbers, scripture references, assignments, and places exactly as
they were said. These are what a reader cannot recover from context; never paraphrase a number.
Use everyday words and no abbreviations. No idioms, figures of speech, sarcasm, or wordplay: if the
speaker used one, write what it means instead of what they said.
Name the person rather than writing "he", "she", or "they", unless the name is on a visible line
directly above.
One idea per line. Active voice. Do not join two thoughts with "and" or a semicolon.
Maximum ${wordLimit} words, and fewer whenever fewer will do.
Do not add information.
If nothing new or useful was communicated, return an empty string.

Mode: ${mode}
${modeInstruction(mode)}

Prayer mode should read like a short, simple prayer rather than a status note.

Do not produce generic statements such as:
- He is talking about faith.
- They are talking about the message.
- Something important is being shared.
- The speaker is giving encouragement.

Visible lines already shown:
${visibleBlock}

Recent transcript:
${String(recentTranscript).trim()}
`.trim();
}
