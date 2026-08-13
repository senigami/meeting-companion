import { cleanModelLinesWithLoss, RUNAWAY_LINE_GUARD, SUMMARY_MAX_WORDS } from '../public/services/summary-prompt.js';
import { SUMMARY_INTERVAL_MAX_SECONDS } from '../public/services/view-settings.js';
import { buildMinimalSummarizeMessages } from '../public/services/summary-prompt-minimal.js';
import { isSummaryLevel } from '../public/services/summary-level.js';
import { responseErrorMessage } from '../public/services/response.js';
import { shortenToLimit } from '../public/services/text.js';
import { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from './model-config.js';
import { callProvider, ProviderError, PROVIDER_ERROR_TYPES } from '../packages/ai-provider/index.js';

// A displayed line must never exceed this, but it must also never be reached by cutting inside a
// word or bolting on an ellipsis -- see shortenToLimit (public/services/text.js) for why. Same
// bound as the pre-existing (buggy) clamp; the 140-char figure itself was never in question, only
// how the line got there.
const DISPLAY_LINE_MAX_CHARS = 140;

// maxWords arrives as untrusted request input, and the comment that used to sit here said its only
// consumer was buildSummarizePrompt, which clamped it. That stopped being true when the minimal prompt
// took over: it clamps nothing, so `maxWords: 100000` produced a prompt reading "no more than 100000
// words". Measured 2026-08-04 while bringing the Claude path to parity (#47), which would have widened
// the gap to both providers.
//
// The ceiling is DERIVED so it cannot bind on any real reader, and that property is the whole point.
// A first version used a flat 40, and Cato showed the comment defending it was false: readingBudget has
// no upper clamp, so an 80 wpm reader at a 30 second interval already reaches 40 and anything faster was
// silently losing budget. A bound that can quietly reduce what the reader gets is a reading-load
// decision, and those belong to Ansel, not here.
//
// So it is pinned to something no person does: the longest interval the app allows, times a reading
// pace far above any human reading a wall display. That bounds absurd input while provably never
// touching a derived budget. If a real calibration ever approaches it, this is the wrong constant and
// the fix is Ansel's, not a bigger number here.
const IMPLAUSIBLE_WPM = 400;
const MAX_WORDS_HARD_CEILING = Math.round((IMPLAUSIBLE_WPM / 60) * SUMMARY_INTERVAL_MAX_SECONDS);
const boundWords = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return SUMMARY_MAX_WORDS;
  return Math.min(Math.round(numeric), MAX_WORDS_HARD_CEILING);
};
// How many tokens the reply is allowed, DERIVED from what we actually asked for.
//
// It was a flat 300 on both paths, with a comment describing "three 14-word lines" -- a cap that
// stopped existing in #59. Cato found it while tracing every bound on one call (#65): twelve lines at
// a high word budget is roughly 400 tokens and cannot fit in 300, so the reply is cut mid-line.
//
// That is worse than a dropped line, and the distinction is the point. A dropped line is absent. A cut
// line arrives as a partial sentence and is displayed as a finished card, so the reader gets a
// fragment presented with the same confidence as a whole thought, and nothing reports it: wasShortened
// describes shortenToLimit, which is a different mechanism (#58).
//
// So it is derived from the two numbers that decide how much text we asked for. The rate is set for
// the WORST case rather than the average one, and the worst case here is the protected category:
// plain English runs about 1.3 tokens a word, but the things this prompt must keep verbatim tokenize
// far worse. "John 14:26-27" is roughly 6 tokens for 2 words, "9:00 a.m." 4 to 5 for 2, and names and
// hymn numbers 2 to 3 each, so a reference-dense line runs 2.5 to 3.
//
// 3, not the 2 I first wrote. Cato measured the dense case and showed 2 was reachable at a 14-word
// budget: 12 lines needed about 470 tokens against an allowance of 416, and a line cut THERE is the
// costliest fragment possible, because it is exactly the content the reader cannot afford to have
// mangled. Overestimating costs nothing (max_tokens is a ceiling, not a reservation; the worst case
// works out around 7300, well inside both providers' limits) while underestimating puts a fragment on
// the wall.
const TOKENS_PER_WORD = 3;
// Newlines and a short refusal or empty reply. Punctuation is already inside the per-word rate.
// Confirmed adequate for a twelve line reply; it deliberately does NOT try to absorb a per-word
// shortfall, which would scale across every word and is the rate's job.
const TOKEN_SLACK = 80;

export function replyTokenBudget({ level, maxWords }) {
  const lines = level === 'brief' ? 1 : RUNAWAY_LINE_GUARD;
  return lines * maxWords * TOKENS_PER_WORD + TOKEN_SLACK;
}

export async function summarizeWithSource({
  source = 'openai',
  mode = 'speaker',
  recentTranscript = '',
  visibleLines = [],
  maxWords = SUMMARY_MAX_WORDS,
  level = 'condense',
  history = [],
  openaiApiKey = process.env.OPENAI_API_KEY || '',
  anthropicApiKey = process.env.ANTHROPIC_API_KEY || '',
  anthropicModel = DEFAULT_ANTHROPIC_MODEL,
  fetchImpl = fetch,
  openaiClient
} = {}) {
  // openaiClient was retired when the OpenAI adapter moved into packages/ai-provider (issue #9),
  // which takes a key string, not an SDK client -- see the caller, not this function, for how a
  // client-based default gets resolved to one. An unrecognised parameter silently doing nothing is
  // exactly the #58/#63 failure shape one layer up (a call that reports success while quietly not
  // doing what the caller asked), so this fails loudly instead of ignoring it.
  if (openaiClient !== undefined) {
    throw new Error('summarizeWithSource: openaiClient is no longer accepted; pass openaiApiKey (a string) and fetchImpl instead.');
  }

  const text = String(recentTranscript).trim();
  if (!text) return { line: '' };
  const words = boundWords(maxWords);

  switch (source || 'openai') {
    case 'openai':
      return summarizeWithOpenAI({
        apiKey: openaiApiKey,
        fetchImpl,
        mode,
        recentTranscript: text,
        visibleLines,
        maxWords: words,
        // The requested level is honoured -- the client derives it from the reading budget and this
        // layer must not second-guess that. The ONE thing enforced here is the information-mode
        // guard, because brief keeps a single line and an announcement round then loses facts
        // silently rather than failing. That belongs at the point of use as well as at the caller:
        // this is where an untrusted request body arrives.
        level: mode === 'information' ? 'condense' : (isSummaryLevel(level) ? level : 'condense'),
        history
      });
    case 'claude':
      return summarizeWithClaude({
        anthropicApiKey,
        anthropicModel,
        fetchImpl,
        mode,
        recentTranscript: text,
        visibleLines,
        maxWords: words,
        // Same information-mode guard as the OpenAI branch, for the same reason: brief keeps one
        // line, so an announcements round would lose every fact after the first.
        level: mode === 'information' ? 'condense' : (isSummaryLevel(level) ? level : 'condense'),
        history
      });
    default:
      throw new Error(`Unsupported summarization source: ${source}`);
  }
}

async function summarizeWithOpenAI({ apiKey, fetchImpl, mode, recentTranscript, visibleLines, maxWords, level = 'condense', history = [] }) {
  if (!apiKey) {
    return { line: '', reason: 'OPENAI_API_KEY is not set. Manual mode still works.' };
  }

  // buildMinimalSummarizeMessages is the conversational-turns prompt proven in
  // scripts/simulate-meeting.js (real user/assistant turns instead of prior context pasted into
  // one message). The Claude path below also uses it (#47) -- both providers share one prompt now.
  const messages = buildMinimalSummarizeMessages({ recentTranscript, mode, maxWords, level, history });
  // The request/response adapter (building the call, parsing the reply text, classifying failure)
  // lives in packages/ai-provider -- see issue #9. Everything above and below this call is
  // calibrated to THIS app's reading-load model and stays here.
  let rawText;
  try {
    ({ text: rawText } = await callProvider({
      provider: 'openai',
      apiKey,
      messages,
      maxTokens: replyTokenBudget({ level, maxWords }),
      model: DEFAULT_OPENAI_MODEL,
      fetchImpl
    }));
  } catch (error) {
    rawText = emptyReplyOrRethrow(error);
  }

  return finishReply(rawText, visibleLines);
}

// A 200 whose body carries no usable text (OpenAI returning `content: null` on a refusal, Claude
// returning no content array) is treated as the model having nothing to say: empty reply, no error.
// That is what both branches did before the provider adapters moved into packages/ai-provider
// (#9), and #9 is an extraction -- the package now names this failure `malformed-response`, which is
// the right vocabulary for a general caller, but adopting it here would change what an operator sees
// on a path the card never asked to change. Whether it SHOULD stay silent is a real question, asked
// separately; it is not this refactor's to answer.
function emptyReplyOrRethrow(error) {
  if (error instanceof ProviderError && error.type === PROVIDER_ERROR_TYPES.MALFORMED_RESPONSE) {
    return '';
  }
  throw error;
}

// The post-processing both providers share. It was inline in the OpenAI branch, and bringing Claude to
// parity (#47) meant re-deriving every rule in it -- which is precisely how the two drifted into being
// different applications wearing one setting. One function now, so a rule added for one provider
// cannot silently miss the other.
// ONE card per summarize call, every mode, every level, no exceptions (Steve, 2026-08-10: "Multiple
// cards per call is never correct... should not exist for any mode, anywhere"). This used to hold
// only for brief and information (#105) while speaker and prayer could still pack several thoughts
// into several word-budgeted cards via packLinesIntoCards -- a real prayer produced 4 cards from
// one chunk. That packing capability is gone.
//
// A first version of this enforcement kept only the model's first accepted line and DISCARDED the
// rest -- wrong, caught immediately (Steve): "if it returned 2 sentences then both would be on the
// same card. no artificial splitting." One card per call means everything the model actually said
// lands on that one card, joined together -- never split across several cards, and never thrown
// away to force a single line. finishLines below joins every accepted line with a space instead of
// a newline, so transcript-display.js's splitByThought (which turns each newline into its own
// card) never sees more than one to split.
function finishReply(rawText, visibleLines) {
  return finishLines(rawText, visibleLines);
}

// Splits the raw model reply into accepted, ordered, deduped lines (cleanModelLines), joins ALL of
// them into one card (space-separated, never a newline -- see finishReply above), and shortens the
// result to the display char cap if needed. wasShortened is true if the joined line needed
// shortening. maxLines stays a generous safety cap (RUNAWAY_LINE_GUARD, not 1) purely against a
// truly runaway reply; an ordinary 2-3 sentence answer never comes close to it.
function finishLines(rawText, visibleLines) {
  const { accepted: acceptedLines, discardedByCap } = cleanModelLinesWithLoss(rawText, visibleLines, { maxLines: RUNAWAY_LINE_GUARD });
  const joined = acceptedLines.join(' ');
  const shortened = shortenToLimit(joined, DISPLAY_LINE_MAX_CHARS);

  // discardedByCap is reported separately from wasShortened on purpose (#58). They are different
  // failures: shortening trims a line's characters and the line still arrives, while a discard means
  // real speech never reached the reader. Collapsing them into one boolean is what made three
  // successive silent-loss defects look like clean calls.
  return { line: shortened, wasShortened: shortened !== joined, discardedByCap };
}

async function summarizeWithClaude({
  anthropicApiKey,
  anthropicModel,
  fetchImpl,
  mode,
  recentTranscript,
  visibleLines,
  maxWords,
  level = 'condense',
  history = []
}) {
  if (!anthropicApiKey) {
    return { line: '', reason: 'ANTHROPIC_API_KEY is not set. Manual mode still works.' };
  }

  // Steve on #47, 2026-08-04: "Claude is supported for live transcription but untested as I do not
  // have claude api key. In theory it should work the same as the openai one." So it runs the SAME
  // prompt, levels and line guard now, rather than the older buildSummarizePrompt.
  //
  // What it was before: one pasted-context user message, no summarization levels, no third-person
  // brief, no card packing, and a line cap of 3 -- so an announcements round on Claude still dropped
  // the fourth announcement long after #49 was fixed for OpenAI, and switching provider mid-meeting
  // moved the behaviour under the operator with nothing saying so.
  //
  // buildMinimalSummarizeMessages returns [system, ...history turns, user]. Splitting the system
  // message into Anthropic's top-level `system` field is now the package's job (packages/ai-provider,
  // issue #9) -- one canonical messages array goes in for both providers.
  const messages = buildMinimalSummarizeMessages({ recentTranscript, mode, maxWords, level, history });

  let rawText;
  try {
    ({ text: rawText } = await callProvider({
      provider: 'claude',
      apiKey: anthropicApiKey,
      messages,
      maxTokens: replyTokenBudget({ level, maxWords }),
      model: anthropicModel,
      fetchImpl
    }));
  } catch (error) {
    // A 200 with no usable content was an empty reply before the extraction, not a failure -- see
    // emptyReplyOrRethrow. Checked BEFORE the enrichment below, which would otherwise turn it into
    // an operator-facing error the old code never raised.
    if (error instanceof ProviderError && error.type === PROVIDER_ERROR_TYPES.MALFORMED_RESPONSE) {
      return finishReply(emptyReplyOrRethrow(error), visibleLines);
    }

    // Preserves the pre-existing Claude behaviour exactly: turn the provider's own error text into
    // an operator-actionable message via responseErrorMessage (public/services/response.js), which
    // is app UI judgment and deliberately did not move into the package.
    if (error instanceof ProviderError) {
      const detail = error.detail || '';
      throw new Error(responseErrorMessage(detail ? { error: detail } : {}, 'Summarization failed.'));
    }
    throw error;
  }

  // Identical post-processing to the OpenAI path, through the same function so the two cannot drift.
  return finishReply(rawText, visibleLines);
}
