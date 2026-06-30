import { buildSummarizePrompt, cleanModelLine, shouldAcceptModelLine } from '../public/services/summary-prompt.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';

export async function summarizeWithSource({
  source = 'openai',
  mode = 'speaker',
  recentTranscript = '',
  visibleLines = [],
  openaiClient = null,
  anthropicApiKey = process.env.ANTHROPIC_API_KEY || '',
  anthropicModel = DEFAULT_ANTHROPIC_MODEL,
  fetchImpl = fetch
} = {}) {
  const text = String(recentTranscript).trim();
  if (!text) return { line: '' };

  switch (source || 'openai') {
    case 'openai':
      return summarizeWithOpenAI({
        client: openaiClient,
        mode,
        recentTranscript: text,
        visibleLines
      });
    case 'claude':
      return summarizeWithClaude({
        anthropicApiKey,
        anthropicModel,
        fetchImpl,
        mode,
        recentTranscript: text,
        visibleLines
      });
    default:
      throw new Error(`Unsupported summarization source: ${source}`);
  }
}

async function summarizeWithOpenAI({ client, mode, recentTranscript, visibleLines }) {
  if (!client) {
    return { line: '', reason: 'OPENAI_API_KEY is not set. Manual mode still works.' };
  }

  const prompt = buildSummarizePrompt({ mode, recentTranscript, visibleLines });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'Return only the line text or an empty string. No quotes. No markdown.' },
      { role: 'user', content: prompt }
    ]
  });

  let line = cleanModelLine(completion.choices?.[0]?.message?.content || '');
  if (!shouldAcceptModelLine(line, visibleLines)) line = '';
  if (line.length > 140) line = line.slice(0, 137).trimEnd() + '...';
  return { line };
}

async function summarizeWithClaude({
  anthropicApiKey,
  anthropicModel,
  fetchImpl,
  mode,
  recentTranscript,
  visibleLines
}) {
  if (!anthropicApiKey) {
    return { line: '', reason: 'ANTHROPIC_API_KEY is not set. Manual mode still works.' };
  }

  const prompt = buildSummarizePrompt({ mode, recentTranscript, visibleLines });
  const response = await fetchImpl(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_API_VERSION,
      'x-api-key': anthropicApiKey
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 64,
      temperature: 0.2,
      system: 'Return only the line text or an empty string. No quotes. No markdown.',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || 'Summarization failed.');
  }

  const output = Array.isArray(data.content)
    ? data.content.filter((chunk) => chunk?.type === 'text').map((chunk) => chunk.text || '').join(' ')
    : '';
  let line = cleanModelLine(output);
  if (!shouldAcceptModelLine(line, visibleLines)) line = '';
  if (line.length > 140) line = line.slice(0, 137).trimEnd() + '...';
  return { line };
}
