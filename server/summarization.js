import { buildSummarizePrompt, cleanModelLines, SUMMARY_MAX_WORDS } from '../public/services/summary-prompt.js';
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

// maxWords arrives as untrusted client input and its only consumer is buildSummarizePrompt, which
// clamps it there -- next to the prompt text it protects, so a prompt can never claim a limit that
// was not honoured. It is deliberately NOT re-clamped here: a second clamp would be a second home for
// the same rule, and the two could drift apart while both looked correct.
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

  switch (source || 'openai') {
    case 'openai':
      return summarizeWithOpenAI({
        client: openaiClient,
        mode,
        recentTranscript: text,
        previousBlock,
        visibleLines,
        maxWords,
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
        maxWords
      });
    default:
      throw new Error(`Unsupported summarization source: ${source}`);
  }
}

async function summarizeWithOpenAI({ client, mode, recentTranscript, previousBlock, visibleLines, maxWords, level = 'condense', history = [] }) {
  if (!client) {
    return { line: '', reason: 'OPENAI_API_KEY is not set. Manual mode still works.' };
  }

  // OpenAI path only, deliberately: buildMinimalSummarizeMessages is the conversational-turns
  // prompt proven in scripts/simulate-meeting.js (real user/assistant turns instead of prior
  // context pasted into one message). The Claude path below still uses buildSummarizePrompt --
  // that is NOT an oversight, it is the two providers being on different prompts for now.
  const messages = buildMinimalSummarizeMessages({ recentTranscript, mode, maxWords, level, history });
  const completion = await client.chat.completions.create({
    model: DEFAULT_OPENAI_MODEL,
    temperature: 0.2,
    // Up to three 14-word lines plus newlines and punctuation is roughly 70-90 tokens; 300 gives
    // headroom without inviting the model to ramble. Left unset (no cap) on the OpenAI path before
    // this change, which is why raising it only mattered on the Anthropic branch below -- but a call
    // that also needs a per-line explanation for a dense chunk deserves the same headroom here.
    max_tokens: 300,
    messages
  });

  // brief is ONE card by contract: nothing to pack, and no second line to accept. Letting either
  // through would quietly hand the reader more than the level promised, which is the whole quantity
  // the level exists to control.
  if (level === 'brief') {
    return finishLines(completion.choices?.[0]?.message?.content || '', visibleLines, { maxLines: 1 });
  }

  // Packing applies to the CONDENSE modes only. In information mode each line is a separate
  // announcement, and merging two of them into one card because they happened to fit the word
  // budget is wrong -- "Closing hymn 301" and "Sister Ellsworth will offer the benediction" are two
  // things a reader looks for separately, not one sentence. (Caught by the line-order test, which
  // failed the moment packing was applied to every mode.)
  //
  // For the condense modes, maxLines goes well above MAX_LINES_PER_CALL on purpose: the prompt now
  // returns one thought per line, so three would truncate a long testimony mid-way. 12 is a runaway
  // guard, not a display limit -- packLinesIntoCards decides how many cards those become.
  const packs = mode === 'speaker' || mode === 'prayer';
  return finishLines(completion.choices?.[0]?.message?.content || '', visibleLines, {
    cardWords: packs ? maxWords : null,
    maxLines: packs ? 12 : undefined
  });
}

// Splits the raw model reply into accepted, ordered, deduped lines (cleanModelLines), optionally
// packs them into word-budgeted cards (OpenAI path only -- see cardWords below),
// shortens each line independently to the display char cap, and rejoins survivors with newlines so
// transcript-display.js's splitByThought turns each into its own card. wasShortened is true if ANY
// line needed shortening -- the per-call telemetry signal stays a single boolean either way.
function finishLines(rawText, visibleLines, { cardWords = null, maxLines = undefined } = {}) {
  const acceptedLines = cleanModelLines(rawText, visibleLines, maxLines ? { maxLines } : undefined);
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

  return { line: shortenedLines.join('\n'), wasShortened: anyShortened };
}

async function summarizeWithClaude({
  anthropicApiKey,
  anthropicModel,
  fetchImpl,
  mode,
  recentTranscript,
  previousBlock,
  visibleLines,
  maxWords
}) {
  if (!anthropicApiKey) {
    return { line: '', reason: 'ANTHROPIC_API_KEY is not set. Manual mode still works.' };
  }

  const prompt = buildSummarizePrompt({ mode, recentTranscript, previousBlock, visibleLines, maxWords });
  const response = await fetchImpl(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_API_VERSION,
      'x-api-key': anthropicApiKey
    },
    body: JSON.stringify({
      model: anthropicModel,
      // Was 64: enough for one 14-word line but not three -- three lines plus newlines runs
      // roughly 70-90 tokens, so 64 would truncate the third line mid-sentence rather than drop it
      // cleanly, which is worse. 300 matches the OpenAI path's headroom.
      max_tokens: 300,
      temperature: 0.2,
      system: 'Return only the line text, one idea per line, or an empty string. No quotes. No markdown.',
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
    ? data.content.filter((chunk) => chunk?.type === 'text').map((chunk) => chunk.text || '').join('\n')
    : '';
  return finishLines(output, visibleLines);
}
