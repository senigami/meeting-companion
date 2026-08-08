import OpenAI from 'openai';
import { PROVIDER_ERROR_TYPES, throwProviderError } from '../errors.js';

// classify maps the openai SDK's own error shape into the shared vocabulary. The SDK already gives
// us an HTTP status on every APIError subclass, so this is a lookup, not a guess.
function classify(error) {
  const status = error?.status;
  if (status === 401 || status === 403) return PROVIDER_ERROR_TYPES.AUTH;
  if (status === 429) return PROVIDER_ERROR_TYPES.RATE_LIMIT;
  // The SDK throws APIConnectionError when the fetch itself fails -- DNS, a dropped connection,
  // offline -- as opposed to a response the provider actually sent back. Matched on the SDK's own
  // error class, not on "status is missing": a plain bug in this adapter also has no status, and
  // calling that a network failure sends whoever is debugging it at the wrong thing.
  if (error instanceof OpenAI.APIConnectionError) return PROVIDER_ERROR_TYPES.NETWORK;
  return PROVIDER_ERROR_TYPES.UNKNOWN;
}

export async function callOpenAI({ apiKey, messages, maxTokens, model, fetchImpl }) {
  // A fresh client per call, built from the already-resolved key handed to us. This package never
  // sees the provider-key store or the precedence chain that produced this string -- see the
  // package README.
  //
  // maxRetries: 0 -- the SDK retries 429s and 5xxs twice by default with backoff. Neither call site
  // this package replaced retried, and inventing that behaviour here would be adding it silently
  // rather than by decision (out of scope per issue #9).
  const client = new OpenAI({ apiKey, fetch: fetchImpl, maxRetries: 0 });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages
    });
  } catch (error) {
    return throwProviderError(classify(error), error?.message || 'OpenAI request failed.', {
      provider: 'openai',
      detail: error?.message || '',
      apiKey
    });
  }

  const text = completion?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    return throwProviderError(
      PROVIDER_ERROR_TYPES.MALFORMED_RESPONSE,
      'OpenAI response did not contain a text reply.',
      { provider: 'openai', apiKey }
    );
  }

  return { text };
}
