import { buildSummarizePrompt, cleanModelLines, RUNAWAY_LINE_GUARD } from '../summary-prompt.js';
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
    async summarize({ mode = 'speaker', recentTranscript = '', previousBlock = '', visibleLines = [], maxWords, level, history = [] } = {}) {
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
          level,
          history
        })
      }, { setTimeoutFn, clearTimeoutFn });

      const data = await readResponseJson(response);
      if (!response.ok) throw new Error(responseErrorMessage(data, 'Summarization failed.'));
      // The server (server/summarization.js) already ran cleanModelLines against visibleLines and
      // joined survivors with newlines -- re-running it here (rather than the old single-line
      // cleanModelLine, which collapsed those newlines back into one blob) keeps each idea on its
      // own line so transcript-display.js's splitByThought renders one card per idea.
      // RUNAWAY_LINE_GUARD explicitly, not the default. Without it this re-capped the server's
      // already-cleaned reply at 3 and silently undid #49: five announcements out of the server,
      // three onto the wall. The server is authoritative about how many lines survive; this call
      // exists only to keep them on separate lines, never to re-decide the count.
      const line = cleanModelLines(data.line || '', visibleLines, { maxLines: RUNAWAY_LINE_GUARD }).join('\n');
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
