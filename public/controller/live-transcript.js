import { normalizeText } from '../services/text.js';

export function buildLiveTranscriptText(chunks = [], preview = '', { seconds = 12, maxChars = 240 } = {}) {
  const pruneBefore = Date.now() - 5 * 60 * 1000;
  const cutoff = Date.now() - seconds * 1000;

  const streamText = (Array.isArray(chunks) ? chunks : [])
    .filter((chunk) => chunk && chunk.at >= pruneBefore && chunk.at >= cutoff)
    .map((chunk) => normalizeText(chunk.text))
    .filter(Boolean)
    .join(' ')
    .trim();

  const combined = [streamText, normalizeText(preview)].filter(Boolean).join(' ').trim();
  return combined.length > maxChars ? combined.slice(-maxChars) : combined;
}

