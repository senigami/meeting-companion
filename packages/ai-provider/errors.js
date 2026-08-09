// The one error vocabulary both adapters map into. A caller that wants to react to failure
// (retry, show a specific message, log a metric) should never have to know which provider it was
// talking to -- it should be able to switch on `error.type`.
export const PROVIDER_ERROR_TYPES = Object.freeze({
  AUTH: 'auth',
  RATE_LIMIT: 'rate-limit',
  NETWORK: 'network',
  MALFORMED_RESPONSE: 'malformed-response',
  UNKNOWN: 'unknown'
});

export class ProviderError extends Error {
  constructor(type, message, { provider = '', detail = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.type = type;
    this.provider = provider;
    // Raw provider-supplied text, kept separate from `message` so a caller that wants to build its
    // own operator-facing copy (regex-matching known failure strings, for example) has something to
    // match against that is guaranteed to be the provider's own words, not this package's.
    this.detail = detail;
  }
}

// The property this whole module exists to hold: a resolved API key must never be able to reach a
// human or a log through an error this package throws. There is no code map and no INV-8 note on
// the far side of a copy of this directory to catch it later, so this checks itself, at the moment
// of throwing, rather than trusting every call site to remember.
//
// Fails LOUDLY on purpose (throws a plain Error, not a ProviderError) -- a leaked key must never be
// swallowed by whatever catch block is looking for ProviderError instances.
export function throwProviderError(type, message, options = {}) {
  const error = new ProviderError(type, message, options);
  const apiKey = options.apiKey;
  if (apiKey && String(apiKey).length >= 8) {
    // The constructed error AND everything the adapter handed in. ProviderError currently keeps only
    // `provider` and `detail`, so a key smuggled in via some other option (a `cause`, a raw response
    // body) would not be on the error to find -- today. Checking the options bag too means the guard
    // still fires on the day someone widens the constructor, which is exactly when it is needed.
    const { apiKey: _key, ...rest } = options;
    if (`${serializeForLeakCheck(error)}\n${serializeForLeakCheck(rest)}`.includes(apiKey)) {
      throw new Error('ai-provider: refusing to throw an error that contains the API key. This is a bug in an adapter, not in the caller.');
    }
  }
  throw error;
}

// Walks EVERY own property (not a fixed list of message/detail/stack) plus the `cause` chain,
// because the check has to survive a future adapter attaching a field this file has never heard of
// -- a response body, a request object, a status payload. A named-field check silently stops
// covering the thing that gets added next, which is the one failure mode a self-check cannot have.
function serializeForLeakCheck(value, seen = new Set(), depth = 0) {
  if (value === null || value === undefined || depth > 4) return '';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '';
  seen.add(value);

  const parts = [];
  if (value instanceof Error) parts.push(value.message, value.stack);
  for (const key of Object.getOwnPropertyNames(value)) {
    // A property access can itself throw (a getter on an SDK error object). A leak check that
    // crashes is worse than one that skips a field, so never let it take the process down.
    let child;
    try {
      child = value[key];
    } catch {
      continue;
    }
    parts.push(key, serializeForLeakCheck(child, seen, depth + 1));
  }
  if (value.cause !== undefined) parts.push(serializeForLeakCheck(value.cause, seen, depth + 1));
  return parts.filter(Boolean).join('\n');
}
