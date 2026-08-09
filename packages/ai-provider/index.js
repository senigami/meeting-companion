import { callOpenAI } from './adapters/openai.js';
import { callClaude } from './adapters/claude.js';

export { ProviderError, PROVIDER_ERROR_TYPES } from './errors.js';

// The single seam a consuming repo depends on. Everything else in this directory is
// implementation detail an adapter needs; this is the only function meant to be called from
// outside it.
//
// `messages` is one canonical [system, ...turns] array for BOTH providers -- the caller builds it
// once, and each adapter does its own provider-specific reshaping (Claude splits the system
// message out; OpenAI sends the array as-is). Do not build a Claude-shaped or OpenAI-shaped
// messages array in the caller; that is exactly the duplication this seam exists to remove.
const ACCEPTED_OPTIONS = Object.freeze(['provider', 'apiKey', 'messages', 'maxTokens', 'model', 'fetchImpl']);

export async function callProvider(options = {}) {
  // An option this seam does not understand is REJECTED, never quietly dropped. Both adapters pin
  // values a caller might reasonably expect to control (temperature, retries), so passing
  // `temperature: 0.9` and getting 0.2 would look like it worked and would not. Same shape as the
  // retired `openaiClient` parameter one layer up, and worse here: this directory gets COPIED into
  // other repos, where nobody has read this file before calling it.
  const unknown = Object.keys(options).filter((key) => !ACCEPTED_OPTIONS.includes(key));
  if (unknown.length) {
    throw new Error(`callProvider: unsupported option(s) ${unknown.join(', ')}. Accepted: ${ACCEPTED_OPTIONS.join(', ')}.`);
  }

  const { provider, apiKey, messages, maxTokens, model, fetchImpl = fetch } = options;
  switch (provider) {
    case 'openai':
      return callOpenAI({ apiKey, messages, maxTokens, model, fetchImpl });
    case 'claude':
      return callClaude({ apiKey, messages, maxTokens, model, fetchImpl });
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
