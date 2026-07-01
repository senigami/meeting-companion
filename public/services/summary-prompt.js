export function modeInstruction(mode = 'speaker') {
  switch (mode) {
    case 'information':
      return 'Prioritize exact dates, times, places, hymn numbers, assignments, and announcements.';
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
  visibleLines = []
} = {}) {
  const visibleBlock = visibleLines.filter(Boolean).length
    ? visibleLines.filter(Boolean).map((line) => `- ${line}`).join('\n')
    : '- none';

  return `
You are creating large-print assistive text for one deaf and low-vision person during a church meeting.

Return zero or one line.
Only add a line when the transcript contains something useful that is new or more specific than the lines already shown.
If the moment is vague or repetitive, return an empty string.
Avoid lines like "He is talking about faith."

Write a single short line that would help someone reading from across the room.
Do not use labels such as "main point," "speaker," "summary," or "announcement."
Do not say "still talking about."
Use plain, specific language.
Preserve names, dates, times, hymn numbers, scripture references, assignments, and places.
Maximum 14 words.
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
