import { normalizeText } from './text.js';

export async function readResponseJson(response) {
  if (!response) return {};

  if (typeof response.text === 'function') {
    const text = await response.text();
    if (!normalizeText(text)) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  if (typeof response.json === 'function') {
    return response.json();
  }

  return {};
}

// Provider error codes an operator can actually act on, translated into what to DO about it. These
// arrive in the server's `detail` field, which used to be discarded entirely: a key with no credit
// produced "Could not summarize: Summarization failed." on the rail while the server log said
// `insufficient_quota`. The app knew the cause and told the operator nothing, which is exactly the
// silent-failure class INV-10 exists to prevent -- and mid-meeting is the worst time to have to go
// reading server logs to find out that summaries stopped because the account is out of credit.
//
// NEVER recommend switching to Demo as a mid-meeting fix. The demo summarizer replays a rehearsal
// script; on a live display it would put words on the wall that nobody in the room said. Fabricated
// content is the worst possible failure of this app -- worse than no summaries at all -- because the
// one person relying on it cannot hear the meeting to know the wall is wrong. The sanctioned fallback
// during a live meeting is the operator typing lines themselves, which is how this was done before
// the app existed and is a known-good path. Demo sources are for rehearsal only.
const ACTIONABLE_PROVIDER_DETAILS = [
  [/insufficient_quota|exceeded your current quota|billing_hard_limit/i, 'the account has no API credit left. Add credit at the provider, and type lines manually until it is fixed.'],
  [/invalid_api_key|incorrect api key|authentication/i, 'the key was rejected. Check it in AI services, and type lines manually until it is fixed.'],
  [/rate.?limit|429|too many requests/i, 'the provider is rate limiting this key. Try a slower summary interval, and type lines manually if it keeps failing.'],
  [/model_not_found|does not exist|do not have access/i, 'this account cannot use the configured model. Type lines manually until it is fixed.']
];

export function providerDetailExplanation(detail = '') {
  const text = normalizeText(detail);
  if (!text) return '';
  const match = ACTIONABLE_PROVIDER_DETAILS.find(([pattern]) => pattern.test(text));
  return match ? match[1] : '';
}

export function responseErrorMessage(data, fallback = 'Request failed.') {
  const explanation = providerDetailExplanation(data?.detail);
  // The actionable explanation REPLACES the generic error rather than appending to it. Callers already
  // supply their own context ("Could not summarize: ..."), so keeping both produced three clauses that
  // all said failure and only one that said why: "Could not summarize: Summarization failed: the
  // account has no API credit left." A slow reader pays for every one of those words.
  if (explanation) return explanation[0].toUpperCase() + explanation.slice(1);
  return normalizeText(data?.error || data?.raw || '') || fallback;
}
