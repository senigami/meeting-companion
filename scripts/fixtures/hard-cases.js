// A library of real, previously-hard-to-summarize items, captured verbatim from actual sessions
// (mainly recordings/2026-08-09T15-54-05-907Z.ndjson, a real church meeting) rather than invented.
// Steve's request, 2026-08-09: keep these as a permanent battering test, so any future change to
// the prompt or the gating logic (summary-prompt.js) gets checked against the specific real cases
// that already broke once, not just against ordinary happy-path input.
//
// recordings/ is gitignored (session-recorder.js), so the actual source files will not survive a
// fresh clone or a rotation -- the text is copied here, permanently, for exactly that reason.
//
// Each case names what made it hard, what a correct run should do, and any shortcoming that is
// KNOWN and ACCEPTED (a deliberate trade-off, not a bug to keep chasing) -- see each case's own
// comment for the incident/decision that shaped the expectation. This file holds data only; run it
// with scripts/battering-test.js.

// Real, consecutive chunks from a complete opening prayer (2026-08-09T15-54-05-907Z.ndjson,
// 16:06:25-16:07:03). The night this was captured, the prayer's own closing ("...we say these
// things in the name of Jesus Christ, amen.") was mislabeled 'information' at CAPTURE time --
// Steve pressed the next mode button after the prayer had finished, but the bucket had not drained
// yet (the 20s interval hadn't ticked), so it drained under the new mode instead. Fixed 2026-08-10:
// setMode now awaits a full flush of the outgoing mode's bucket BEFORE the mode/driver/buttons
// change at all ("clean dump and switch, just like hitting Stop"). This case is the four chunks
// that were correctly tagged 'prayer' that night, to check the CONTENT side end to end.
export const PRAYER_OPENING_REAL = {
  name: 'PRAYER_OPENING_REAL',
  mode: 'prayer',
  level: 'condense',
  maxWords: 10,
  description: 'A complete real opening prayer, correctly-tagged chunks only.',
  expectation: 'Each card reads as a prayer being offered (first person, "we"/"thy"), not a report about one. Exactly one card per chunk, everything real joined onto it -- prayer is one-card-per-call now too (2026-08-10), the same as every other mode.',
  knownShortcoming: 'The actual closing "amen" of this prayer is not included here -- it was captured under the wrong mode that night, before the mode-switch ordering fix existed. Not re-included as a chunk here since the fix is in setMode\'s ordering (runtime.js), not anything this content-level battering test can exercise.',
  chunks: [
    "Dear Heavenly Father, we're grateful for this day. We're grateful for the opportunity to meet together.",
    'we are grateful for the chance we have to fellowship each other grateful for beautiful weather that we have all the things that thou has blessed us with',
    'Be filled with thy spirit the lessons and messages that Thou hast for each of us. The speakers that they will be able to be guided by the Spirit. and hear the things that that wants us to know'
  ]
};

// The specific regression Steve caught 2026-08-10: a bare "Amen." (or similarly short, complete,
// real closing) must reach the model and be printed, never held back by the content gate. This is
// the direct case the fix targets, in both modes he named as needing it.
export const AMEN_GATE_REGRESSION = {
  name: 'AMEN_GATE_REGRESSION',
  mode: 'prayer',
  level: 'condense',
  maxWords: 10,
  description: 'A bare "Amen." on its own, with nothing else in the chunk -- the exact case a word-count-based content gate cannot tell apart from filler like "Okay."',
  expectation: 'Must print "Amen." (or an equivalent acknowledgement of it) -- never gated out, never silently dropped, never held back waiting for more words that are not coming.',
  knownShortcoming: null,
  chunks: [
    'Amen.'
  ]
};

// Real, consecutive chunks from one speaker's testimony. Historically produced fifteen straight
// cards all opening "Sandy White said/says...", burning 3 of a 10-word budget on the same phrase
// every time (traced to prior cards being fed back as conversation turns a chat model imitates the
// style of -- fixed 2026-08-09 by folding history into the system message as plain data instead).
export const REPETITION_PRONE_SPEAKER = {
  name: 'REPETITION_PRONE_SPEAKER',
  mode: 'speaker',
  level: 'condense',
  maxWords: 10,
  description: 'One speaker, many consecutive chunks -- the "Name said..." repetition case.',
  expectation: 'No card should open with "Sandy White said/says" more than once or twice across the whole run. Word counts should stay within a few words of the 10-word target (historically drifted to 14-24 before the 2026-08-09 fix).',
  knownShortcoming: 'The model does not reliably keep using "Sandy White" by name after the first few cards -- it often falls back to a bare pronoun or drops the subject once her name is not restated in the raw chunk. Accepted (Steve, 2026-08-09): the speaker\'s name is a persistent UI label on the card now, not something the summary text needs to carry.',
  chunks: [
    "I am Sandy White. I am a child of God. I am a child of the covenant. And I am a disciple of Jesus Christ.",
    "I grew up in Ogden, Utah. with a childhood that was pretty much idyllic. I was raised in the gospel of Jesus Christ.",
    "and married in the temple to the love of my life, But my life have had a lot of challenges just like yours has. sí And we shared, my husband and I shared those together And we made him work.",
    "We got through them together. And I told my son, who's in this ward, What the subject was, he said, Oh no, this is going to be about our family. So I have to be a little careful.",
    "in this ward, but I see so many wonderful people here. So you are my friends, too. I was guided to talk about faith. in Jesus Christ. That's what the Lord wanted me to say today, to talk about.",
    "It is normal to sometimes feel inadequate. Overwhelmed and even lost, and turning Jesus Christ is a solution.",
    "When we exercise In Jesus Christ we rely on him.",
    "in His infinite power, intelligence, and love. We believe that even though We don't understand everything, He understands our pains and sorrows.",
    "He knows how to help us face our challenges. My favorite scripture, one of my favorite scriptures. Proverbs 3:5-7.",
    "and lean not unto thine own understanding. In all thy ways acknowledge him. And he shall direct thy paths."
  ]
};

// Real chunk: three distinct announcements arrived in one summarize call. Historically split into
// up to 3 separate cards from a single call (fixed 2026-08-09, Steve's reversal of a 2026-08-04
// per-announcement-line ruling: one call must produce exactly one card).
export const MULTI_ANNOUNCEMENT_INFO = {
  name: 'MULTI_ANNOUNCEMENT_INFO',
  mode: 'information',
  level: 'condense',
  maxWords: 10,
  description: 'One chunk holding three separate announcements -- the multi-card-per-call case.',
  expectation: 'Exactly one card, even though the model may still try to describe more than one announcement in its raw reply -- finishReply enforces maxLines: 1 in code for mode === "information", independent of what the prompt asks for.',
  knownShortcoming: 'Whichever announcement does not fit the one card is dropped from THIS call, not merged or queued -- by design, left for the model to pick up on its own next call against the fresh transcript (same as speaker mode leaves the rest of an over-long sentence for next time). If that second announcement is never repeated, it never appears.',
  chunks: [
    "In the new year, Young Men, Young Women leaders and their parents will participate. this Sunday special lessons. Our opening hymn Number one, the morning breaks,"
  ]
};

// Real chunk, info mode: a prayer's closing and an unrelated announcement landed in the same call.
export const MIXED_PRAYER_AND_INFO = {
  name: 'MIXED_PRAYER_AND_INFO',
  mode: 'information',
  level: 'condense',
  maxWords: 10,
  description: 'A prayer\'s closing and a separate announcement in one chunk.',
  expectation: 'One card. Likely compresses to whichever half reads as the main point; either is acceptable, two cards from one call is not.',
  knownShortcoming: 'Same as MULTI_ANNOUNCEMENT_INFO -- whichever half does not survive compression is not queued for later.',
  chunks: [
    "We pray for our instructor this day We say this in the name of Jesus Christ, amen. Thank you. So we only have two more one hour elders quorum meetings maybe for the rest of our lives."
  ]
};

// Constructed (not from a real recording, no real case has surfaced this yet), directly reproducing
// the 2026-08-08 misattribution bug: a speaker recounting a THIRD PARTY's own quoted story in first
// person. If the model reports this as the SPEAKER's own retirement, that is the bug back.
export const MISATTRIBUTION_THIRD_PARTY_STORY = {
  name: 'MISATTRIBUTION_THIRD_PARTY_STORY',
  mode: 'speaker',
  level: 'condense',
  maxWords: 10,
  description: 'Speaker retells someone else\'s story in first person ("He said, I was...").',
  expectation: 'The retirement/career details must be attributed to Harold, never to the narrating speaker. This is the exact 2026-08-08 bug: "I was retired then, after thirty-one years driving a delivery truck" is Harold\'s story, not the speaker\'s.',
  knownShortcoming: null,
  chunks: [
    "My good friend Harold came up to me last week and told me about his life. He said, I was retired then, after thirty-one years driving a delivery truck."
  ]
};

// Real-shaped (constructed from the actual incident description, 2026-08-09): missionaries and
// members sometimes bear testimony in another language. Historically the model refused outright
// ("I'm sorry, but I can only respond in English...") -- observed directly in a real session -- and
// separately, hasSubstantiveContent's original ASCII-only word count would have held this back from
// ever reaching the model at all, forever, no matter how much accumulated.
export const NON_ENGLISH_TESTIMONY = {
  name: 'NON_ENGLISH_TESTIMONY',
  mode: 'speaker',
  level: 'condense',
  maxWords: 10,
  description: 'Testimony borne in Chinese, Korean, and Arabic -- must be translated, never refused or silently dropped.',
  expectation: 'Each line must come back as an English summary of the actual meaning (thanking God for blessings / feeling thankful, believing the church is true / this church is true), never a refusal, never untranslated foreign text, never empty.',
  knownShortcoming: 'Translation quality/idiom is whatever the underlying model produces -- not independently verified against a certified translation, only checked for "translated, on-topic, not refused."',
  chunks: [
    '我今天想要感謝上帝賜給我們這麼多的祝福。我知道教會是真實的，耶穌基督愛我們每一個人。',
    '오늘 정말 감사한 마음으로 이 자리에 섰습니다. 저는 이 교회가 참되다는 것을 압니다.',
    'شكرا لكم جميعا على حضوركم اليوم. أنا أعلم أن هذه الكنيسة صحيحة.'
  ]
};

// Real chunks: information-mode announcements that, before the 2026-08-09 fix, overshot the
// word target substantially (14-24 words against a 10-word target).
export const WORD_BUDGET_OVERSHOOT = {
  name: 'WORD_BUDGET_OVERSHOOT',
  mode: 'information',
  level: 'condense',
  maxWords: 10,
  description: 'Real announcements that historically ran 14-24 words against a 10-word target.',
  expectation: 'Cards should land close to the 10-word target -- a few words over is fine (Steve is fine with 11-12 when content needs it), but not double the target the way the old, more heavily-worded prompt produced.',
  knownShortcoming: 'The target is a soft compression goal the model does not always hit exactly; occasional overshoot is expected, not a hard failure.',
  chunks: [
    'This afternoon, everyone hopefully got the message. The event is on August 19 at Chris Green Lake. It starts right after the second hour.',
    'Melissa Grobo is the stake single adult representative. All can support Sister Droubal in this job. Anyone against? Thank you.',
    'Miesha and Adam Partridge have moved in. The Gordon family, Anna, George, and Lachlan, have also moved in. Sister is here too.'
  ]
};

// The normal flow -- Steve's explicit request: the hard cases are worthless as a signal if a
// change that helps them quietly breaks ordinary, easy input. These are unremarkable, single-topic
// real-shaped chunks with nothing tricky about them.
export const NORMAL_FLOW = {
  name: 'NORMAL_FLOW',
  mode: 'speaker',
  level: 'condense',
  maxWords: 10,
  description: 'Ordinary, single-topic chunks with nothing tricky -- the sanity baseline.',
  expectation: 'A clean, accurate, on-topic third-person summary near the word target. If these regress while a hard case improves, the change made a trade, not a fix.',
  knownShortcoming: null,
  chunks: [
    'The bishop announced that the ward temple trip will be held next Saturday morning.',
    'She shared how reading the Book of Mormon every night has strengthened her family.',
    'The choir will be singing a special musical number during sacrament meeting this week.'
  ]
};

// Order matches Steve's requested test sequence: prayer, then information, then speaker.
export const ALL_CASES = [
  // Prayer
  PRAYER_OPENING_REAL,
  AMEN_GATE_REGRESSION,
  // Information
  MULTI_ANNOUNCEMENT_INFO,
  MIXED_PRAYER_AND_INFO,
  WORD_BUDGET_OVERSHOOT,
  // Speaker
  REPETITION_PRONE_SPEAKER,
  MISATTRIBUTION_THIRD_PARTY_STORY,
  NON_ENGLISH_TESTIMONY,
  NORMAL_FLOW
];
