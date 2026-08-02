// An ORIGINAL fast-and-testimony-meeting fixture, written for this harness only -- not a
// transcription of any real person's testimony. Fast and testimony meeting is materially
// different in shape from the prepared talk in sample-talk.js: instead of one long narrative arc,
// it is a short conducting introduction followed by nine to eleven separate, unrelated
// testimonies borne spontaneously by different people, then a short close and closing prayer.
//
// The properties that matter here, deliberately planted to stress the summarizer the way a real
// testimony meeting will tomorrow:
//   - Many short unrelated blocks in 'speaker' mode rather than one block, so the summarizer must
//     not carry a thread from one testimony into the next just because both are still 'speaker'.
//   - Heavy repetition of the same handful of phrases ("I'm grateful for", "I know that", "I want
//     to thank", "I just") across different, unrelated speakers -- test pressure against merging
//     two different people's testimonies because they used the same words.
//   - Wildly varying length: several are 25-40 words, one rambles past 200.
//   - Some testimonies are concrete (a name, an event, a date); some are entirely abstract with no
//     facts at all, to see whether the summarizer still produces something rather than nothing.
//   - One speaker gets emotional and pauses -- represented as a short trailing fragment followed
//     by a restart, not a stage direction like "(pauses)".
//   - No speaker is ever introduced by name before they speak. In a real testimony meeting nobody
//     announces who is walking up, so the harness must not lean on a labeling crutch the real
//     display will not have either.
//
// Roughly 1200-1500 words total, spoken the way people actually talk when they have not prepared
// anything: restarts, "anyway", "I don't know", trailing off.
export const SAMPLE_TESTIMONY_MEETING = [
  { text: "Good morning, everyone, and welcome to our fast and testimony meeting.", mode: 'information' },
  { text: "As is our custom on the first Sunday, we'll set aside the rest of our program so that any of you who would like to come up and share your testimony may do so.", mode: 'information' },
  { text: "There's no sign-up list, just come on up to the microphone whenever you feel prompted, and we'll try to leave enough space between each of you.", mode: 'information' },

  { text: "Um, I wasn't planning on coming up here today, but I just feel like I need to.", mode: 'speaker' },
  { text: "I'm grateful for this church, and for the people in it, and, I don't know, I just feel like every time I'm struggling with something, somebody shows up.", mode: 'speaker' },
  { text: "This week it was a phone call from a friend at exactly the moment I needed it, and I don't think that was an accident.", mode: 'speaker' },
  { text: "Anyway, I know that we're watched over, even in the small stuff, and I'm thankful for that. I say this in the name of Jesus Christ, amen.", mode: 'speaker' },

  { text: "Good morning. My name isn't important, I just wanted to say a few words about my mother, who passed in January.", mode: 'speaker' },
  { text: "She lived eighty-six years, and for the last twelve of those she came to every single meeting, even when she needed a wheelchair to do it, even in the snow.", mode: 'speaker' },
  { text: "I used to think that was just stubbornness, but sitting with her these last few months I came to understand it was something else, it was just how much this all meant to her.", mode: 'speaker' },
  { text: "I want to thank everyone who visited her at the care center, you have no idea what that meant to our family, and to her.", mode: 'speaker' },
  { text: "I know she's still with us in some way, I really do believe that, and I'm grateful for the extra time we got with her, more than we probably deserved.", mode: 'speaker' },

  { text: "I'll keep this short. I just want to say I'm grateful for my job, even on the days I complain about it, because a lot of people don't have one right now.", mode: 'speaker' },
  { text: "I know that's a small thing to be grateful for but it's where I'm at today. Thank you.", mode: 'speaker' },

  { text: "Hi. So, this is going to sound strange, but I want to bear my testimony about laundry.", mode: 'speaker' },
  { text: "I have four kids and for years I hated doing laundry, it felt like it never ended, it felt like proof that I was behind on everything.", mode: 'speaker' },
  { text: "And then a few months ago I just, I don't know, I started praying while I folded it, and it stopped being a chore and started being kind of sacred, honestly.", mode: 'speaker' },
  { text: "I know that sounds silly. But I've come to believe that any task can be turned into something meaningful if you're willing to change how you're thinking about it while you do it.", mode: 'speaker' },
  { text: "I'm grateful for small ordinary tasks, and for what they've taught me this year. That's really all I wanted to say.", mode: 'speaker' },

  { text: "I know that the gospel is true.", mode: 'speaker' },

  { text: "Brothers and sisters, I've been a member of this church for forty-one years and I have to tell you, this year has tested me more than any of the other forty.", mode: 'speaker' },
  { text: "My son moved away in the spring, my health hasn't been great, and, and there were nights I genuinely wondered whether any of it made a difference, whether any of this was real.", mode: 'speaker' },
  { text: "I'm not going to pretend I have a tidy answer for you. I don't. I still have hard days.", mode: 'speaker' },
  { text: "But I keep coming back, week after week, because something keeps bringing me back, and I've decided that has to count for something, even on the days when I can't feel much of anything at all.", mode: 'speaker' },
  { text: "I want to thank this ward for not giving up on me even when I probably gave you every reason to. I know that counts for something too. In the name of Jesus Christ, amen.", mode: 'speaker' },

  { text: "I just want to say thank you to the primary teachers. I don't think you get thanked enough.", mode: 'speaker' },
  { text: "My daughter comes home every week talking about something new she learned, and I know that's because someone is putting in real effort on a Sunday morning for very little kids who mostly just want a snack.", mode: 'speaker' },
  { text: "I'm grateful for you. That's it, that's my testimony today.", mode: 'speaker' },

  { text: "Good morning. I want to talk for a minute about my brother Daniel, who I haven't spoken to in almost three years now.", mode: 'speaker' },
  { text: "We had a falling out over, honestly, it doesn't even matter what it was over anymore, it feels small now.", mode: 'speaker' },
  { text: "This week I finally called him. I don't know what made me do it. I just picked up the phone.", mode: 'speaker' },
  { text: "We talked for two hours. We didn't solve everything, but we talked, and I cried afterward, just sitting in my car in the driveway.", mode: 'speaker' },
  { text: "I know that reconciliation is possible even when you've convinced yourself it isn't, even after years, and I'm grateful I finally listened to that prompting instead of putting it off again.", mode: 'speaker' },

  { text: "I don't have anything prepared, I just felt like I should stand up.", mode: 'speaker' },
  { text: "I've been thinking a lot lately about gratitude, and how easy it is to say the word without actually feeling it.", mode: 'speaker' },
  { text: "I want to try to actually feel it more this year, not just say it. I know that's vague but that's where I'm at. Thank you.", mode: 'speaker' },

  { text: "I want to bear testimony of my faith and of the peace it's brought into my life, especially this past year, which has been", mode: 'speaker' },
  { text: "Sorry. I'm sorry, give me just a second.", mode: 'speaker' },
  { text: "This past year has been the hardest of my life, and I wasn't sure I was going to be able to get up here today.", mode: 'speaker' },
  { text: "My husband and I lost a baby in the spring, and I'm not, I'm still not really able to talk about the details of it.", mode: 'speaker' },
  { text: "But I want you all to know that I have felt carried, actually carried, through the worst of it, by people in this room and by something bigger than that too.", mode: 'speaker' },
  { text: "I don't know why some things happen the way they do. I really don't. But I know that we were not left to go through it alone, and I'm grateful, more than I can say, for that. Amen.", mode: 'speaker' },

  { text: "Hi everyone. I just moved into the ward a few months ago and I wanted to introduce myself a little, and also share something.", mode: 'speaker' },
  { text: "Moving to a new city alone in your twenties is harder than anyone tells you it's going to be, and I spent my first few weeks here feeling pretty invisible, honestly.", mode: 'speaker' },
  { text: "But three different families have had me over for dinner since I got here, without me asking, and it's made this whole transition so much easier than it could have been.", mode: 'speaker' },
  { text: "I know that this community actually looks out for people, I've seen it happen to me directly, and I just wanted to say thank you before I got too comfortable to bother saying it out loud.", mode: 'speaker' },

  { text: "I'm grateful for prayer. I know that's probably been said a few times already today but I mean it in a very specific way.", mode: 'speaker' },
  { text: "There was a moment this week, driving home actually, where I just said out loud in the car, I don't know what to do here, and, and within about a day the answer just sort of arrived, through a conversation I wasn't expecting.", mode: 'speaker' },
  { text: "I know that's how it works sometimes, not always, but sometimes, and I wanted to share that because I think we don't say it enough when it actually happens.", mode: 'speaker' },

  { text: "Thank you to everyone who's shared today, that took real courage, and I think we've all been fed by it.", mode: 'information' },
  { text: "We're right at time, so let's go ahead and close for today. Please remember the ward cleanup is still happening this coming Saturday if you're able to help.", mode: 'information' },
  { text: "Brother Alvarez has agreed to offer our closing prayer.", mode: 'information' },

  { text: "Dear Father, we thank thee for this meeting, and for the honesty and courage of those who stood up today to share what's really on their hearts.", mode: 'prayer' },
  { text: "We ask that thou wouldst continue to carry those among us who are struggling, especially the families mentioned here this morning.", mode: 'prayer' },
  { text: "We say these things humbly, in the name of Jesus Christ, amen.", mode: 'prayer' }
];
