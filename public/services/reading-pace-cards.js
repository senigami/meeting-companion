// Card content for the reading-pace measurement page (issue #14). Realistic church-meeting
// summary lines in the same voice as scripts/fixtures/sample-talk.js and
// public/services/transcription/demo.js -- not lorem ipsum, not literary prose. Two practice
// cards (discarded) plus 8 real cards, deliberately varied in length: two short (~6 words),
// three medium (~11 words), three long (~16 words). At least one card carries a number
// (attendance/time/years) and at least one carries a name, since those may read differently.
export const PRACTICE_CARDS = [
  'Good morning. Welcome everyone.',
  'The hymn book is on your seat.'
];

export const READING_PACE_CARDS = [
  // ~6 words
  'The working bee starts Saturday morning.',
  'Please stand for the closing hymn.',
  // ~11 words
  'Brother Whitfield will lead the opening hymn for us this morning.',
  'The funeral service is this Thursday at eleven in the chapel.',
  'A short reading from John, chapter three, verses sixteen to eighteen.',
  // ~16 words
  'Margaret Ellis and her family are in our thoughts after the passing of her husband Tom.',
  'Tom had been part of this community for forty-two years, right up until the end.',
  'Next week, platform one and microphone two need the same volunteers as last month.'
];
