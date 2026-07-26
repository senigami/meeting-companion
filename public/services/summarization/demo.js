import { cleanModelLine, shouldAcceptModelLine } from '../summary-prompt.js';

// FOR: pairing with the `demo` transcription source so someone can rehearse,
// check the display wall before a service starts, or run the whole app with
// no API key and no network. It is what lets the demo meeting reach the
// display at all.
//
// NOT: this is not an offline AI summarizer. It never invents, paraphrases,
// or condenses. It only selects one sentence that was actually said and
// trims it to fit the wall. Anyone reaching for "summarization without a
// key" for real meetings should look elsewhere — this is a rehearsal aid.

// Read at a distance by someone who may be hard of hearing, so the line
// needs to stay short enough to read in one glance. 72 characters is roughly
// a full width line on the display without wrapping to a third line.
const MAX_LINE_CHARS = 72;

const FILLER_OPENERS = /^(um+|uh+|so|and then|and|but|like|okay|ok|well)\b[,\s]*/i;

function splitSentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function stripFillerOpener(sentence) {
  let result = sentence.trim();
  let stripped = result.replace(FILLER_OPENERS, '').trim();
  while (stripped !== result) {
    result = stripped;
    stripped = result.replace(FILLER_OPENERS, '').trim();
  }
  return result;
}

function truncateOnWordBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const boundary = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${boundary.trim()}...`;
}

function pickCandidateSentence(recentTranscript) {
  const sentences = splitSentences(recentTranscript);
  // Prefer the most recent sentence, and prefer one that reads as complete
  // (ends with sentence punctuation) over a trailing fragment.
  const complete = sentences.filter((sentence) => /[.!?]$/.test(sentence));
  const ordered = complete.length ? complete : sentences;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const stripped = stripFillerOpener(ordered[i]);
    if (stripped) return stripped;
  }
  return '';
}

export function createDemoSummarizer(deps = {}) {
  return {
    id: 'demo',
    label: 'Demo',
    async summarize({ recentTranscript = '', visibleLines = [] } = {}) {
      const text = String(recentTranscript).trim();
      if (!text) return { line: '' };

      const candidate = pickCandidateSentence(text);
      if (!candidate) return { line: '' };

      const trimmed = truncateOnWordBoundary(candidate, MAX_LINE_CHARS);
      const line = cleanModelLine(trimmed);
      if (!shouldAcceptModelLine(line, visibleLines)) return { line: '' };

      return { line };
    }
  };
}
