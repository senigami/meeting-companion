import { buildSummarizePrompt, cleanModelLine, shouldAcceptModelLine, SUMMARY_MAX_WORDS } from '../public/services/summary-prompt.js';
import { readResponseJson, responseErrorMessage } from '../public/services/response.js';
import { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from './model-config.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

// maxWords arrives as untrusted client input and its only consumer is buildSummarizePrompt, which
// clamps it there -- next to the prompt text it protects, so a prompt can never claim a limit that
// was not honoured. It is deliberately NOT re-clamped here: a second clamp would be a second home for
// the same rule, and the two could drift apart while both looked correct.
export async function summarizeWithSource({
  source = 'openai',
  mode = 'speaker',
  recentTranscript = '',
  visibleLines = [],
  maxWords = SUMMARY_MAX_WORDS,
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
        visibleLines,
        maxWords
      });
    case 'claude':
      return summarizeWithClaude({
        anthropicApiKey,
        anthropicModel,
        fetchImpl,
        mode,
        recentTranscript: text,
        visibleLines,
        maxWords
      });
    default:
      throw new Error(`Unsupported summarization source: ${source}`);
  }
}

async function summarizeWithOpenAI({ client, mode, recentTranscript, visibleLines, maxWords }) {
  if (!client) {
    return { line: '', reason: 'OPENAI_API_KEY is not set. Manual mode still works.' };
  }

  const prompt = buildSummarizePrompt({ mode, recentTranscript, visibleLines, maxWords });
  const completion = await client.chat.completions.create({
    model: DEFAULT_OPENAI_MODEL,
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
  visibleLines,
  maxWords
}) {
  if (!anthropicApiKey) {
    return { line: '', reason: 'ANTHROPIC_API_KEY is not set. Manual mode still works.' };
  }

  const prompt = buildSummarizePrompt({ mode, recentTranscript, visibleLines, maxWords });
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

  const data = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(responseErrorMessage(data.error?.message ? { error: data.error.message } : data, 'Summarization failed.'));
  }

  const output = Array.isArray(data.content)
    ? data.content.filter((chunk) => chunk?.type === 'text').map((chunk) => chunk.text || '').join(' ')
    : '';
  let line = cleanModelLine(output);
  if (!shouldAcceptModelLine(line, visibleLines)) line = '';
  if (line.length > 140) line = line.slice(0, 137).trimEnd() + '...';
  return { line };
}
