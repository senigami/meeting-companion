import { PROVIDER_ERROR_TYPES, throwProviderError } from '../errors.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

function classify(status) {
  if (status === 401 || status === 403) return PROVIDER_ERROR_TYPES.AUTH;
  if (status === 429) return PROVIDER_ERROR_TYPES.RATE_LIMIT;
  return PROVIDER_ERROR_TYPES.UNKNOWN;
}

export async function callClaude({ apiKey, messages, maxTokens, model, fetchImpl }) {
  // Anthropic takes the system prompt as its own top-level field rather than as a message in the
  // array. The caller builds one canonical [system, ...turns] array for both providers; splitting
  // it back apart is this adapter's job, not the caller's, so callProvider stays one call shape.
  const [systemMessage, ...turns] = messages;

  let response;
  try {
    response = await fetchImpl(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_API_VERSION,
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        system: systemMessage?.content,
        messages: turns.map((turn) => ({ role: turn.role, content: turn.content }))
      })
    });
  } catch (error) {
    // fetchImpl itself threw -- no response came back at all, so this is a transport failure, not
    // anything the provider said. Neither call site classified this before; it is unclassified
    // failure that the shared vocabulary now names correctly.
    return throwProviderError(PROVIDER_ERROR_TYPES.NETWORK, error?.message || 'Claude request failed.', {
      provider: 'claude',
      detail: error?.message || '',
      apiKey
    });
  }

  let data;
  try {
    data = await readJsonBody(response);
  } catch (error) {
    // Reading the body can fail after the headers arrived (a dropped connection mid-stream). Letting
    // that escape would hand the caller a raw error that skipped both the shared vocabulary and the
    // API-key leak check, which is the one thing nothing on the far side of a copy would catch.
    return throwProviderError(PROVIDER_ERROR_TYPES.NETWORK, error?.message || 'Claude response could not be read.', {
      provider: 'claude',
      detail: error?.message || '',
      apiKey
    });
  }

  if (!response.ok) {
    // `raw` is the non-JSON fallback (an HTML 502 from a proxy, a plain-text rate-limit notice). It
    // has to reach `detail`: the caller's operator-facing copy is chosen by regex-matching this
    // text, so dropping it turns "the account has no API credit left" back into a bare
    // "Summarization failed." -- the silent-failure shape that message exists to prevent.
    // `error` as a bare string is not Anthropic's own shape, but a proxy in front of it can produce
    // one, and the base branch surfaced it. Dropping it loses the same operator copy `raw` exists
    // to keep.
    const detail = typeof data?.error?.message === 'string'
      ? data.error.message
      : (typeof data?.error === 'string'
        ? data.error
        : (typeof data?.raw === 'string' ? data.raw : ''));
    return throwProviderError(classify(response.status), detail || 'Claude request failed.', {
      provider: 'claude',
      detail,
      apiKey
    });
  }

  if (!Array.isArray(data.content)) {
    return throwProviderError(
      PROVIDER_ERROR_TYPES.MALFORMED_RESPONSE,
      'Claude response did not contain a content array.',
      { provider: 'claude', apiKey }
    );
  }

  const text = data.content
    .filter((chunk) => chunk?.type === 'text')
    .map((chunk) => chunk.text || '')
    .join('\n');

  return { text };
}

// text() first, then parse -- deliberately the same order as the app this was extracted from
// (public/services/response.js readResponseJson). Calling json() first throws away a non-JSON error
// body entirely, and that body is often the only thing saying WHY the call failed.
async function readJsonBody(response) {
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (!text || !text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  if (typeof response.json === 'function') {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
  return {};
}
