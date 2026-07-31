import { buildSummarizePrompt, cleanModelLines } from '../summary-prompt.js';
import { readResponseJson, responseErrorMessage } from '../response.js';
import { fetchWithTimeout } from '../fetch-timeout.js';

export function createClaudeSummarizer({
  fetchImpl = fetch,
  onStatus = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  return {
    id: 'claude',
    label: 'Claude',
    async summarize({ mode = 'speaker', recentTranscript = '', previousBlock = '', visibleLines = [], maxWords } = {}) {
      const text = String(recentTranscript).trim();
      if (!text) return { line: '' };

      const response = await fetchWithTimeout(fetchImpl, '/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'claude',
          mode,
          recentTranscript: text,
          previousBlock,
          visibleLines,
          maxWords
        })
      }, { setTimeoutFn, clearTimeoutFn });

      const data = await readResponseJson(response);
      if (!response.ok) throw new Error(responseErrorMessage(data, 'Summarization failed.'));
      // See openai.js: cleanModelLines preserves the server's newline-separated ideas instead of
      // collapsing them back into one blob.
      const line = cleanModelLines(data.line || '', visibleLines).join('\n');
      if (!line && data.reason) onStatus(data.reason);
      return {
        line,
        prompt: buildSummarizePrompt({ mode, recentTranscript: text, previousBlock, visibleLines, maxWords }),
        wasShortened: Boolean(data.wasShortened)
      };
    }
  };
}
