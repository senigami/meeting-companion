import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import { toFile } from 'openai';
import { buildTranscriptionPrompt } from './public/services/transcription/prompt.js';
import { listAvailableSources } from './public/services/registry.js';
import { normalizeText } from './public/services/text.js';
import { summarizeWithSource } from './server/summarization.js';

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

app.get('/api/config', (req, res) => {
  res.json({
    hasOpenAIKey: Boolean(client),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
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
    const { source = 'openai', mode = 'speaker', recentTranscript = '', visibleLines = [] } = req.body || {};
    const result = await summarizeWithSource({
      source,
      mode,
      recentTranscript,
      visibleLines,
      openaiClient: client,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
      anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
      fetchImpl: fetch
    });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Summarization failed.' });
  }
});

app.listen(port, host, () => {
  console.log(`Meeting Companion Display running at http://${host}:${port}`);
});
