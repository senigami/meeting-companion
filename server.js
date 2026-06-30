import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';

const app = express();
const port = process.env.PORT || 3000;
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

function modeInstruction(mode) {
  switch (mode) {
    case 'information':
      return 'Focus on exact instructions, dates, times, locations, assignments, hymn numbers, and announcements.';
    case 'song':
      return 'Only state the hymn or song status. Do not summarize lyrics.';
    case 'prayer':
      return 'Do not summarize the prayer. Only show a simple respectful status if needed.';
    case 'speaker':
    default:
      return 'Focus on the specific story, experience, teaching, feeling, invitation, or example.';
  }
}

app.post('/api/summarize', async (req, res) => {
  try {
    const { mode = 'speaker', recentTranscript = '', visibleLines = [] } = req.body || {};
    const text = String(recentTranscript).trim();

    if (!client) {
      return res.json({ line: '', reason: 'OPENAI_API_KEY is not set. Manual mode still works.' });
    }

    if (!text) {
      return res.json({ line: '' });
    }

    const prompt = `You are creating large-print assistive text for one deaf and low-vision person during a church meeting.\n\nReturn zero or one line.\n\nThe line should summarize what is being communicated right now.\nDo not use labels such as "main point," "speaker," "summary," or "announcement."\nDo not say "still talking about."\nUse plain, specific language.\nPreserve names, dates, times, hymn numbers, scripture references, assignments, and places.\nMaximum 14 words.\nDo not add information.\nIf nothing new or useful was communicated, return an empty string.\n\nMode: ${mode}\n${modeInstruction(mode)}\n\nVisible lines already shown:\n${visibleLines.filter(Boolean).join('\n')}\n\nRecent transcript:\n${text}`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Return only the line text or an empty string. No quotes. No markdown.' },
        { role: 'user', content: prompt }
      ]
    });

    let line = completion.choices?.[0]?.message?.content?.trim() || '';
    line = line.replace(/^[-•*]\s*/, '').replace(/^"|"$/g, '').trim();
    if (line.length > 140) line = line.slice(0, 137).trimEnd() + '...';
    res.json({ line });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Summarization failed.' });
  }
});

app.listen(port, () => {
  console.log(`Meeting Companion Display running at http://localhost:${port}`);
});
