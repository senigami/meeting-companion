import { cleanModelLinesWithLoss, RUNAWAY_LINE_GUARD, SUMMARY_MAX_WORDS } from '../public/services/summary-prompt.js';
import { SUMMARY_INTERVAL_MAX_SECONDS } from '../public/services/view-settings.js';
import { buildMinimalSummarizeMessages } from '../public/services/summary-prompt-minimal.js';
import { packLinesIntoCards } from '../public/services/card-packing.js';
import { isSummaryLevel } from '../public/services/summary-level.js';
import { readResponseJson, responseErrorMessage } from '../public/services/response.js';
import { shortenToLimit } from '../public/services/text.js';
import { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from './model-config.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

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
  previousBlock = '',
  visibleLines = [],
  maxWords = SUMMARY_MAX_WORDS,
  level = 'condense',
  history = [],
  openaiClient = null,
  anthropicApiKey = process.env.ANTHROPIC_API_KEY || '',
  anthropicModel = DEFAULT_ANTHROPIC_MODEL,
  fetchImpl = fetch
} = {}) {
  const text = String(recentTranscript).trim();
  if (!text) return { line: '' };
  const words = boundWords(maxWords);

  switch (source || 'openai') {
    case 'openai':
      return summarizeWithOpenAI({
        client: openaiClient,
        mode,
        recentTranscript: text,
        previousBlock,
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
        previousBlock,
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

async function summarizeWithOpenAI({ client, mode, recentTranscript, previousBlock, visibleLines, maxWords, level = 'condense', history = [] }) {
  if (!client) {
    return { line: '', reason: 'OPENAI_API_KEY is not set. Manual mode still works.' };
  }

  // buildMinimalSummarizeMessages is the conversational-turns prompt proven in
  // scripts/simulate-meeting.js (real user/assistant turns instead of prior context pasted into
  // one message). The Claude path below also uses it (#47) -- both providers share one prompt now.
  const messages = buildMinimalSummarizeMessages({ recentTranscript, mode, maxWords, level, history });
  const completion = await client.chat.completions.create({
    model: DEFAULT_OPENAI_MODEL,
    temperature: 0.2,
    max_tokens: replyTokenBudget({ level, maxWords }),
    messages
  });

  return finishReply(completion.choices?.[0]?.message?.content || '', visibleLines, { mode, maxWords, level });
}

// The post-processing both providers share. It was inline in the OpenAI branch, and bringing Claude to
// parity (#47) meant re-deriving every rule in it -- which is precisely how the two drifted into being
// different applications wearing one setting. One function now, so a rule added for one provider
// cannot silently miss the other.
function finishReply(rawText, visibleLines, { mode, maxWords, level }) {
  // brief is ONE card by contract: nothing to pack, and no second line to accept. Letting either
  // through would hand the reader more than the level promised, which is the whole quantity the level
  // exists to control.
  if (level === 'brief') {
    return finishLines(rawText, visibleLines, { maxLines: 1 });
  }

  // Packing applies to the CONDENSE modes only. In information mode each line is a separate
  // announcement, and merging two because they happened to fit the word budget is wrong -- a hymn
  // number and a benediction assignment are two things a reader looks for separately.
  //
  // RUNAWAY_LINE_GUARD for every mode including information, not the MAX_LINES_PER_CALL default of 3
  // (#49): announcements are one line each, so 3 was a hard ceiling on how many facts could survive a
  // tick, and the fourth was dropped silently. Ansel ruled 12, with the release queue doing the
  // pacing rather than the cap. The same constant is imported by the client drivers, which used to
  // re-cap at 3 and undo all of it (#63).
  const packs = mode === 'speaker' || mode === 'prayer';
  return finishLines(rawText, visibleLines, {
    cardWords: packs ? maxWords : null,
    maxLines: RUNAWAY_LINE_GUARD
  });
}

// Splits the raw model reply into accepted, ordered, deduped lines (cleanModelLines), optionally
// packs them into word-budgeted cards (OpenAI path only -- see cardWords below),
// shortens each line independently to the display char cap, and rejoins survivors with newlines so
// transcript-display.js's splitByThought turns each into its own card. wasShortened is true if ANY
// line needed shortening -- the per-call telemetry signal stays a single boolean either way.
function finishLines(rawText, visibleLines, { cardWords = null, maxLines = undefined } = {}) {
  const { accepted: acceptedLines, discardedByCap } = cleanModelLinesWithLoss(
    rawText,
    visibleLines,
    maxLines ? { maxLines } : undefined
  );
  // cardWords null means "leave the model's line breaks alone" -- the Claude path, whose prompt
  // still asks for three finished lines. The OpenAI path passes a budget, because its prompt now
  // returns one thought per line and something has to decide where the cards actually break.
  const packedLines = cardWords ? packLinesIntoCards(acceptedLines, { cardWords }) : acceptedLines;
  let anyShortened = false;

  const shortenedLines = packedLines.map((line) => {
    const shortened = shortenToLimit(line, DISPLAY_LINE_MAX_CHARS);
    if (shortened !== line) anyShortened = true;
    return shortened;
  });

  // discardedByCap is reported separately from wasShortened on purpose (#58). They are different
  // failures: shortening trims a line's characters and the line still arrives, while a discard means
  // real speech never reached the reader. Collapsing them into one boolean is what made three
  // successive silent-loss defects look like clean calls.
  return { line: shortenedLines.join('\n'), wasShortened: anyShortened, discardedByCap };
}

async function summarizeWithClaude({
  anthropicApiKey,
  anthropicModel,
  fetchImpl,
  mode,
  recentTranscript,
  previousBlock,
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
  // buildMinimalSummarizeMessages returns [system, ...history turns, user]. Anthropic takes the system
  // prompt as its own top-level field rather than as a message, so it is split off here; the
  // remaining user/assistant turns map across unchanged.
  const messages = buildMinimalSummarizeMessages({ recentTranscript, mode, maxWords, level, history });
  const [systemMessage, ...turns] = messages;
  const response = await fetchImpl(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_API_VERSION,
      'x-api-key': anthropicApiKey
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: replyTokenBudget({ level, maxWords }),
      temperature: 0.2,
      system: systemMessage.content,
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content }))
    })
  });

  const data = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(responseErrorMessage(data.error?.message ? { error: data.error.message } : data, 'Summarization failed.'));
  }

  const output = Array.isArray(data.content)
    ? data.content.filter((chunk) => chunk?.type === 'text').map((chunk) => chunk.text || '').join('\n')
    : '';
  // Identical post-processing to the OpenAI path, through the same function so the two cannot drift.
  return finishReply(output, visibleLines, { mode, maxWords, level });
}
