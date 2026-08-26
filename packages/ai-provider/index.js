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
const ACCEPTED_OPTIONS = Object.freeze(['provider', 'apiKey', 'messages', 'maxTokens', 'model', 'fetchImpl', 'timeoutMs']);

// Neither adapter had any deadline at all, so a provider that accepted the connection and then
// never answered held the call open forever. A browser calling through a server does not save you
// here: the browser's own timeout ends the browser's wait, and nothing propagates that back, so
// the server keeps the socket and the upstream connection until the process dies. Over a long
// meeting against a flaky provider those accumulate.
//
// A bound belongs in this seam rather than in either adapter, because "wait forever" is not a
// choice any caller of this package would make on purpose, and this directory gets copied into
// repos where nobody reads the adapters. Callers that want a different bound pass timeoutMs;
// passing 0 or a non-finite value opts out entirely, which is the only way back to the old
// behaviour and has to be written down to get.
const DEFAULT_TIMEOUT_MS = 30000;

// Exported for its own tests. Testing this through callProvider cannot reach the composition branch
// below: the Claude adapter passes no signal, and the only caller that does is the OpenAI SDK, from
// inside itself. A test that builds its own `init.signal` at the adapter layer is testing a layering
// that does not exist, and passes with the composition deleted.
export function withTimeout(fetchImpl, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetchImpl;
  return async (url, init = {}) => {
    const controller = new AbortController();
    // The OpenAI SDK supplies its own signal, so ours composes with the caller's rather than
    // replacing it -- overwriting init.signal would quietly disarm the SDK's own cancellation.
    if (init.signal) {
      if (init.signal.aborted) controller.abort(init.signal.reason);
      else init.signal.addEventListener('abort', () => controller.abort(init.signal.reason), { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error(`Provider call exceeded ${timeoutMs}ms`)), timeoutMs);
    // NOT cleared when fetchImpl resolves, and that is the whole point. `fetch` settles as soon as
    // the response HEADERS arrive; both adapters then read the body (`response.json()`), which is
    // its own unbounded wait. Clearing the timer here bounded time-to-headers only, so a provider
    // that answered instantly and then stalled mid-body was exactly as unbounded as before --
    // measured still hanging at 2s under a 300ms deadline. Leaving it armed lets the abort reach a
    // stalled body read, which is the failure this exists to stop.
    //
    // unref'd instead, so a timer still armed on a call that already finished cannot hold the event
    // loop open. Firing later on a settled controller is a no-op.
    timer.unref?.();
    return fetchImpl(url, { ...init, signal: controller.signal });
  };
}

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

  const { provider, apiKey, messages, maxTokens, model, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const boundedFetch = withTimeout(fetchImpl, timeoutMs);
  switch (provider) {
    case 'openai':
      return callOpenAI({ apiKey, messages, maxTokens, model, fetchImpl: boundedFetch });
    case 'claude':
      return callClaude({ apiKey, messages, maxTokens, model, fetchImpl: boundedFetch });
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
