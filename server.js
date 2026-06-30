import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import { toFile } from 'openai';
import { buildSummarizePrompt, cleanModelLine, shouldAcceptModelLine } from './public/services/summary-prompt.js';
import { buildTranscriptionPrompt } from './public/services/transcription/prompt.js';
import { listAvailableSources } from './public/services/registry.js';
import { normalizeText } from './public/services/text.js';

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const MODEL = 'gpt-4o-mini';

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

app.get('/api/config', (req, res) => {
  res.json({
    hasOpenAIKey: Boolean(client),
    model: client ? MODEL : null,
    sources: listAvailableSources()
  });
});

app.post('/api/transcribe', async (req, res) => {
  try {
    if (!client) {
      return res.status(400).json({ error: 'OPENAI_API_KEY is not set.' });
    }

    const { audioBase64 = '', mimeType = 'audio/webm', filename = 'meeting-companion.webm', mode = 'speaker' } = req.body || {};
    if (!audioBase64) {
      return res.json({ text: '' });
    }

    const audioBuffer = Buffer.from(String(audioBase64), 'base64');
    const file = await toFile(audioBuffer, filename, { type: mimeType });
    const transcription = await client.audio.transcriptions.create({
      file,
      model: 'gpt-4o-transcribe',
      prompt: buildTranscriptionPrompt(mode),
      language: 'en',
      stream: true
    });

    let text = '';
    for await (const event of transcription) {
      if (event.type === 'transcript.text.delta') {
        text += event.delta || '';
      } else if (event.type === 'transcript.text.done') {
        text = event.text || text;
      }
    }

    res.json({ text: normalizeText(text) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Transcription failed.' });
  }
});

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

    const prompt = buildSummarizePrompt({ mode, recentTranscript: text, visibleLines });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Return only the line text or an empty string. No quotes. No markdown.' },
        { role: 'user', content: prompt }
      ]
    });

    let line = cleanModelLine(completion.choices?.[0]?.message?.content || '');
    if (!shouldAcceptModelLine(line, visibleLines)) line = '';
    if (line.length > 140) line = line.slice(0, 137).trimEnd() + '...';
    res.json({ line });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Summarization failed.' });
  }
});

app.listen(port, host, () => {
  console.log(`Meeting Companion Display running at http://${host}:${port}`);
});
