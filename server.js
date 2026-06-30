import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import OpenAI from 'openai';
import { toFile } from 'openai';
import { buildTranscriptionPrompt } from './public/services/transcription/prompt.js';
import { listAvailableSources } from './public/services/registry.js';
import { normalizeText } from './public/services/text.js';
import { summarizeWithSource } from './server/summarization.js';

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';
const MAIN_FILE = fileURLToPath(import.meta.url);

export function createApp({
  openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null,
  openaiModel = DEFAULT_OPENAI_MODEL,
  anthropicApiKey = process.env.ANTHROPIC_API_KEY || '',
  anthropicModel = DEFAULT_ANTHROPIC_MODEL,
  fetchImpl = fetch,
  listAvailableSourcesFn = listAvailableSources
} = {}) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static('public'));

  app.get('/api/config', (req, res) => {
    res.json({
      hasOpenAIKey: Boolean(openaiClient),
      hasAnthropicKey: Boolean(anthropicApiKey),
      model: openaiClient ? openaiModel : null,
      sources: listAvailableSourcesFn()
    });
  });

  app.post('/api/transcribe', async (req, res) => {
    try {
      if (!openaiClient) {
        return res.status(400).json({ error: 'OPENAI_API_KEY is not set.' });
      }

      const { audioBase64 = '', mimeType = 'audio/webm', filename = 'meeting-companion.webm', mode = 'speaker' } = req.body || {};
      if (!audioBase64) {
        return res.json({ text: '' });
      }

      const audioBuffer = Buffer.from(String(audioBase64), 'base64');
      const file = await toFile(audioBuffer, filename, { type: mimeType });
      const transcription = await openaiClient.audio.transcriptions.create({
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
        openaiClient,
        anthropicApiKey,
        anthropicModel,
        fetchImpl
      });
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Summarization failed.' });
    }
  });

  app.use((error, req, res, next) => {
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON payload.' });
    }

    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body too large.' });
    }

    next(error);
  });

  return app;
}

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function resolveHost(host = '127.0.0.1') {
  if (['1', 'true', 'yes'].includes(String(process.env.ALLOW_REMOTE_HOST || '').toLowerCase())) {
    return host;
  }

  if (isLoopbackHost(host)) {
    return host;
  }

  console.warn(`Refusing to bind to non-loopback host ${host} without ALLOW_REMOTE_HOST=true. Falling back to 127.0.0.1.`);
  return '127.0.0.1';
}

function startServer() {
  const app = createApp();
  const port = process.env.PORT || 3000;
  const host = resolveHost(process.env.HOST || '127.0.0.1');

  app.listen(port, host, () => {
    console.log(`Meeting Companion Display running at http://${host}:${port}`);
  });
}

if (process.argv[1] === MAIN_FILE) {
  startServer();
}
