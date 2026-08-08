import { SUMMARY_MAX_WORDS, cleanModelLine, shouldAcceptModelLine } from '../summary-prompt.js';
import { TERMINAL_END } from '../transcript-bucket.js';

// FOR: pairing with the `demo` transcription source so someone can rehearse,
// check the display wall before a service starts, or run the whole app with
// no API key and no network. It is what lets the demo meeting reach the
// display at all.
//
// NOT: this is not an offline AI summarizer. It never invents or paraphrases.
// It selects the earliest complete sentence that was actually said and has not
// been shown yet, one per tick, in the order spoken, and shortens it, if it
// exceeds the shared display word limit, at whichever boundary keeps more of
// what was actually said -- see fitToWordLimit below. If nothing complete is
// available yet it says so and waits for the next tick rather than emitting a
// fragment.

// A clause boundary (comma, semicolon, dash) or a trimmed word boundary are the only two places
// this may shorten a long sentence -- see fitToWordLimit for how it picks between them. Either way
// no ellipsis is ever added -- an earlier version truncated at 72 characters with a "..." and it
// looked like the line had been mangled rather than shortened.
const CLAUSE_BREAK = /[,;:—-]\s+/g;

// Only true non-words are dropped from the front of a sentence. An earlier version also stripped
// "so", "and", "but", "well", "like" -- which turned "So good to see so many familiar faces" into
// "good to see so many familiar faces" on the wall, mid-sentence-looking and wrong. Ordinary
// sentence-opening words are part of what the speaker said; a hesitation sound is not.
const FILLER_OPENERS = /^(um+|uh+|er+|ah+)\b[,\s]*/i;

function splitSentences(text) {
  return String(text)
    // Quote- and bracket-terminated sentences count as ended too (`... gutters."`), matching
    // TERMINAL_END rather than a narrower spelling of the same idea.
    .split(/(?<=[.!?…]["')\]]*)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function stripFillerOpener(sentence) {
  let result = sentence.trim();
  let stripped = result.replace(FILLER_OPENERS, '').trim();
  while (stripped !== result) {
    result = stripped;
    stripped = result.replace(FILLER_OPENERS, '').trim();
  }
  // Removing a hesitation can leave a lowercase word at the start of what is now the sentence, which
  // reads like a fragment on a wall the congregation is reading from a distance.
  return result ? result[0].toUpperCase() + result.slice(1) : result;
}

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

// Function words that must never be the last word on a card: a reader who lands on "...in your
// thoughts and prayers over the" is left holding an unresolved fragment, which is exactly the
// working-memory cost the topic-first contract exists to avoid. Trimmed only off the END of a cut
// this function makes -- never off the front (stripFillerOpener owns that) and never mid-sentence,
// since the words are only ever dangling because a card boundary landed after them, not because the
// speaker actually ended on one.
const DANGLING_TAIL_WORD = /^(a|an|the|and|but|or|nor|so|yet|for|because|if|that|which|who|whom|whose|when|while|since|although|though|unless|until|in|on|at|to|of|with|over|under|about|from|into|onto|upon|than|by|during|through|before|after|between|among|without|within|throughout|against|along|across|around|near)$/i;

function trimDanglingTail(words) {
  const trimmed = [...words];
  // Keep at least two words: a dangling function word is a worse ending than an early cut, but an
  // empty card is worse than either, so trimming never runs the line all the way to nothing.
  while (trimmed.length > 2 && DANGLING_TAIL_WORD.test(trimmed[trimmed.length - 1].replace(/[,;:—-]+$/, ''))) {
    trimmed.pop();
  }
  return trimmed;
}

function stripTrailingClausePunctuation(text) {
  return text.replace(/[,;:—-]+$/, '').trim();
}

// Brings a sentence inside SUMMARY_MAX_WORDS, which is the same limit the real summarizers are
// instructed to hold. Two candidates are built and the one that keeps more of what was actually
// said wins:
//  - the longest run of whole clauses that fits (reads as a phrase someone said, at the cost of
//    sometimes being far shorter than the budget -- an early short clause used to win outright,
//    which is how "So this week we want to remember our friends..." collapsed to a whole card
//    reading just "So this week");
//  - a word-boundary cut at the limit, with any trailing function word (a preposition, article,
//    conjunction, or relative pronoun) trimmed off the end -- the earlier version kept it, which is
//    how a card ended on "...in your thoughts and prayers over the".
// Ties go to the clause boundary, since it is the cleaner cut when both keep the same amount of the
// sentence. This is where the demo differs honestly from a real summarizer: a model would rewrite
// the sentence shorter, and this cannot, so it keeps the opening of what was actually said rather
// than inventing a shorter version of it.
function fitToWordLimit(sentence, maxWords = SUMMARY_MAX_WORDS) {
  if (wordCount(sentence) <= maxWords) return sentence;

  const trailingPunctuation = sentence.match(TERMINAL_END)?.[0] || '';
  const body = trailingPunctuation ? sentence.slice(0, -trailingPunctuation.length) : sentence;

  // Always slice from the start of the sentence rather than stitching clause pieces together, so
  // the kept text is byte-for-byte what was said -- an earlier stitch dropped the comma out of
  // "Before we begin, a warm welcome..." while reassembling it.
  let bestClause = '';
  for (const match of body.matchAll(CLAUSE_BREAK)) {
    const run = body.slice(0, match.index).trim();
    if (!run || wordCount(run) > maxWords) break;
    bestClause = run;
  }

  const bodyWords = body.trim().split(/\s+/).filter(Boolean);
  const wordSliceCandidate = stripTrailingClausePunctuation(
    trimDanglingTail(bodyWords.slice(0, maxWords)).join(' ')
  );

  if (wordCount(wordSliceCandidate) > wordCount(bestClause)) return wordSliceCandidate;
  return bestClause || wordSliceCandidate;
}

// Returns the earliest unshown complete sentence, brought inside the word limit. ONE sentence, not
// several joined: a joined line was being re-split by the display's own 120-character wrap
// (transcript-display.js#segmentTranscriptText), so two sentences landed on the wall as two cards in
// the same instant, which read as the first summary having been skipped and then catching up.
function pickCandidateSentence(recentTranscript, visibleLines, maxWords) {
  const sentences = splitSentences(recentTranscript).filter((sentence) => TERMINAL_END.test(sentence));
  const visibleSet = new Set(visibleLines.map((line) => cleanModelLine(line).toLowerCase()));

  for (const sentence of sentences) {
    const stripped = stripFillerOpener(sentence);
    if (!stripped) continue;
    const fitted = fitToWordLimit(stripped, maxWords);
    if (!fitted) continue;
    if (visibleSet.has(fitted.toLowerCase())) continue;
    return fitted;
  }

  return '';
}

export function createDemoSummarizer(deps = {}) {
  return {
    id: 'demo',
    label: 'Demo',
    async summarize({ recentTranscript = '', visibleLines = [], maxWords = SUMMARY_MAX_WORDS } = {}) {
      const text = String(recentTranscript).trim();
      if (!text) return { line: '' };

      const picked = pickCandidateSentence(text, visibleLines, maxWords);
      if (!picked) return { line: '' };

      const line = cleanModelLine(picked);
      if (!shouldAcceptModelLine(line, visibleLines)) return { line: '' };

      return { line };
    }
  };
}
