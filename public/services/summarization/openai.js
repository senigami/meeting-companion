import { buildSummarizePrompt, cleanModelLine, shouldAcceptModelLine } from '../summary-prompt.js';
import { readResponseJson, responseErrorMessage } from '../response.js';

export function createOpenAISummarizer({
  fetchImpl = fetch,
  onStatus = () => {},
  getApiKey = () => ''
} = {}) {
  return {
    id: 'openai',
    label: 'OpenAI',
    async summarize({ mode = 'speaker', recentTranscript = '', visibleLines = [] } = {}) {
      const text = String(recentTranscript).trim();
      if (!text) return { line: '' };

      const response = await fetchImpl('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          recentTranscript: text,
          visibleLines
        })
      });

      const data = await readResponseJson(response);
      if (!response.ok) throw new Error(responseErrorMessage(data, 'Summarization failed.'));
      const line = shouldAcceptModelLine(cleanModelLine(data.line || ''), visibleLines) ? cleanModelLine(data.line || '') : '';
      if (!line && data.reason) onStatus(data.reason);
      return { line, prompt: buildSummarizePrompt({ mode, recentTranscript: text, visibleLines }) };
    }
  };
}
