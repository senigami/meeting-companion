import { buildSummarizePrompt, cleanModelLine, shouldAcceptModelLine } from '../summary-prompt.js';

export function createClaudeSummarizer({
  fetchImpl = fetch,
  onStatus = () => {}
} = {}) {
  return {
    id: 'claude',
    label: 'Claude',
    async summarize({ mode = 'speaker', recentTranscript = '', visibleLines = [] } = {}) {
      const text = String(recentTranscript).trim();
      if (!text) return { line: '' };

      const response = await fetchImpl('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'claude',
          mode,
          recentTranscript: text,
          visibleLines
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Summarization failed.');
      const line = shouldAcceptModelLine(cleanModelLine(data.line || ''), visibleLines) ? cleanModelLine(data.line || '') : '';
      if (!line && data.reason) onStatus(data.reason);
      return { line, prompt: buildSummarizePrompt({ mode, recentTranscript: text, visibleLines }) };
    }
  };
}
