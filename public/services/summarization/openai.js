import { buildSummarizePrompt, cleanModelLines } from '../summary-prompt.js';
import { readResponseJson, responseErrorMessage } from '../response.js';
import { fetchWithTimeout } from '../fetch-timeout.js';

export function createOpenAISummarizer({
  fetchImpl = fetch,
  onStatus = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  return {
    id: 'openai',
    label: 'OpenAI',
    async summarize({ mode = 'speaker', recentTranscript = '', previousBlock = '', visibleLines = [], maxWords, history = [] } = {}) {
      const text = String(recentTranscript).trim();
      if (!text) return { line: '' };

      const response = await fetchWithTimeout(fetchImpl, '/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          recentTranscript: text,
          previousBlock,
          visibleLines,
          maxWords,
          history
        })
      }, { setTimeoutFn, clearTimeoutFn });

      const data = await readResponseJson(response);
      if (!response.ok) throw new Error(responseErrorMessage(data, 'Summarization failed.'));
      // The server (server/summarization.js) already ran cleanModelLines against visibleLines and
      // joined survivors with newlines -- re-running it here (rather than the old single-line
      // cleanModelLine, which collapsed those newlines back into one blob) keeps each idea on its
      // own line so transcript-display.js's splitByThought renders one card per idea.
      const line = cleanModelLines(data.line || '', visibleLines).join('\n');
      if (!line && data.reason) onStatus(data.reason);
      return {
        line,
        prompt: buildSummarizePrompt({ mode, recentTranscript: text, previousBlock, visibleLines, maxWords }),
        // Passed straight through from server/summarization.js's own before/after shortenToLimit
        // comparison -- the recording instrument's (ADR-0004) measurement of whether the prompt-side
        // length fix in 909fe1e actually fires, not just whether the line happened to be long.
        wasShortened: Boolean(data.wasShortened)
      };
    }
  };
}
