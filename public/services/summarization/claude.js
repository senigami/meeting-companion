import { cleanModelLinesWithLoss, RUNAWAY_LINE_GUARD } from '../summary-prompt.js';
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
    async summarize({ mode = 'speaker', recentTranscript = '', visibleLines = [], maxWords, level, history = [] } = {}) {
      const text = String(recentTranscript).trim();
      if (!text) return { line: '' };

      const response = await fetchWithTimeout(fetchImpl, '/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'claude',
          mode,
          recentTranscript: text,
          visibleLines,
          maxWords,
          // #47: without these two, selecting Claude silently dropped the summarization level and all
          // prior context, so the same setting produced a different application.
          level,
          history
        })
      }, { setTimeoutFn, clearTimeoutFn });

      const data = await readResponseJson(response);
      if (!response.ok) throw new Error(responseErrorMessage(data, 'Summarization failed.'));
      // See openai.js: cleanModelLines preserves the server's newline-separated ideas instead of
      // collapsing them back into one blob.
      // RUNAWAY_LINE_GUARD explicitly, not the default. Without it this re-capped the server's
      // already-cleaned reply at 3 and silently undid #49: five announcements out of the server,
      // three onto the wall. The server is authoritative about how many lines survive; this call
      // exists only to keep them on separate lines, never to re-decide the count.
      const { accepted, discardedByCap } = cleanModelLinesWithLoss(data.line || '', visibleLines, { maxLines: RUNAWAY_LINE_GUARD });
      const line = accepted.join('\n');
      if (!line && data.reason) onStatus(data.reason);
      return {
        line,
        wasShortened: Boolean(data.wasShortened),
        discardedByCap: Number(data.discardedByCap || 0),
        // Kept SEPARATE from the server's count rather than added to it. Cato's point, and it is the
        // better design: this pass should never discard anything, because the server already capped at
        // the same guard. A non-zero value here can only mean the server returned more accepted lines
        // than this client's cap allows, which is precisely the #63 shape. Summing turned that alarm
        // into an indistinguishable larger number; separate, it is the one signal that would catch the
        // next #63 without anybody tracing the path by hand.
        discardedByCapClient: discardedByCap
      };
    }
  };
}
