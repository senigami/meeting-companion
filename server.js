import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import OpenAI from 'openai';
import { toFile } from 'openai';
import { getProviderKeyState } from './public/services/provider-credentials.js';
import { buildTranscriptionPrompt } from './public/services/transcription/prompt.js';
import { listAvailableSources } from './public/services/registry.js';
import { normalizeText } from './public/services/text.js';
import { summarizeWithSource } from './server/summarization.js';

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';
const MAIN_FILE = fileURLToPath(import.meta.url);

export function createApp({
  openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null,
  createOpenAIClientFn = (apiKey) => new OpenAI({ apiKey }),
  openaiModel = DEFAULT_OPENAI_MODEL,
  anthropicApiKey = process.env.ANTHROPIC_API_KEY || '',
  anthropicModel = DEFAULT_ANTHROPIC_MODEL,
  fetchImpl = fetch,
  listAvailableSourcesFn = listAvailableSources,
  providerKeyStore = createProviderKeyStore()
} = {}) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static('public'));

  app.get('/api/config', (req, res) => {
    res.json({
      hasOpenAIKey: Boolean(resolveOpenAIClient({ openaiClient, createOpenAIClientFn, providerKeyStore })),
      hasAnthropicKey: Boolean(resolveAnthropicKey({ anthropicApiKey, providerKeyStore })),
      model: resolveOpenAIClient({ openaiClient, createOpenAIClientFn, providerKeyStore }) ? openaiModel : null,
      sources: listAvailableSourcesFn(),
      providerKeys: describeProviderKeys({ openaiClient, anthropicApiKey, providerKeyStore })
    });
  });

  app.post('/api/provider/key', (req, res) => {
    const { provider = '', apiKey = '' } = req.body || {};
    if (!isSupportedProvider(provider)) {
      return res.status(400).json({ error: 'Unsupported provider.' });
    }

    const clean = normalizeText(apiKey);
    if (!clean) {
      return res.status(400).json({ error: 'API key is required.' });
    }

    providerKeyStore.set(provider, clean);
    res.json({
      ok: true,
      provider,
      providerKeys: describeProviderKeys({ openaiClient, anthropicApiKey, providerKeyStore })
    });
  });

  app.delete('/api/provider/key', (req, res) => {
    const { provider = '' } = req.body || {};
    if (!isSupportedProvider(provider)) {
      return res.status(400).json({ error: 'Unsupported provider.' });
    }

    providerKeyStore.delete(provider);
    res.json({
      ok: true,
      provider,
      providerKeys: describeProviderKeys({ openaiClient, anthropicApiKey, providerKeyStore })
    });
  });

  app.post('/api/transcribe', async (req, res) => {
    try {
      const { apiKey = '', audioBase64 = '', mimeType = 'audio/webm', filename = 'meeting-companion.webm', mode = 'speaker' } = req.body || {};
      const client = resolveOpenAIClient({ apiKey, openaiClient, createOpenAIClientFn, providerKeyStore });
      if (!client) {
        return res.status(400).json({ error: 'OPENAI_API_KEY is not set.' });
      }
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
      const { source = 'openai', apiKey = '', mode = 'speaker', recentTranscript = '', visibleLines = [] } = req.body || {};
      const result = await summarizeWithSource({
        source,
        mode,
        recentTranscript,
        visibleLines,
        openaiClient: resolveOpenAIClient({ apiKey, openaiClient, createOpenAIClientFn, providerKeyStore }),
        anthropicApiKey: source === 'claude'
          ? resolveAnthropicKey({ apiKey, anthropicApiKey, providerKeyStore })
          : anthropicApiKey,
        anthropicModel,
        fetchImpl
      });
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Summarization failed.' });
    }
  });

  app.post('/api/provider/test', async (req, res) => {
    try {
      const { provider = '', apiKey = '' } = req.body || {};
      if (provider === 'openai') {
        const client = resolveOpenAIClient({ apiKey, openaiClient, createOpenAIClientFn, providerKeyStore });
        if (!client) {
          return res.status(400).json({ error: 'OPENAI_API_KEY is not set.' });
        }

        await client.models.list();
        return res.json({ ok: true, provider: 'openai' });
      }

      if (provider === 'claude') {
        const anthropicKey = resolveAnthropicKey({ apiKey, anthropicApiKey, providerKeyStore });
        if (!anthropicKey) {
          return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set.' });
        }

        const result = await summarizeWithSource({
          source: 'claude',
          mode: 'speaker',
          recentTranscript: 'Provider test',
          visibleLines: [],
          anthropicApiKey: anthropicKey,
          anthropicModel,
          fetchImpl
        });
        return res.json({ ok: true, provider: 'claude', line: result.line || '' });
      }

      return res.status(400).json({ error: 'Unsupported provider.' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Provider test failed.' });
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

function createProviderKeyStore(initial = {}) {
  const store = new Map();

  for (const [provider, value] of Object.entries(initial || {})) {
    const clean = normalizeText(value);
    if (clean) {
      store.set(provider, clean);
    }
  }

  return {
    get(provider) {
      return normalizeText(store.get(provider));
    },
    set(provider, value) {
      const clean = normalizeText(value);
      if (!provider) return;
      if (clean) {
        store.set(provider, clean);
      } else {
        store.delete(provider);
      }
    },
    delete(provider) {
      if (provider) {
        store.delete(provider);
      }
    }
  };
}

function describeProviderKeys({ openaiClient, anthropicApiKey, providerKeyStore }) {
  return {
    openai: getProviderKeyState({
      serverReady: Boolean(openaiClient || normalizeText(providerKeyStore.get('openai'))),
      localKey: providerKeyStore.get('openai')
    }),
    claude: getProviderKeyState({
      serverReady: Boolean(anthropicApiKey || normalizeText(providerKeyStore.get('claude'))),
      localKey: providerKeyStore.get('claude')
    })
  };
}

function resolveOpenAIClient({ apiKey = '', openaiClient, createOpenAIClientFn, providerKeyStore }) {
  const clean = normalizeText(apiKey || providerKeyStore?.get?.('openai') || '');
  if (clean) {
    return createOpenAIClientFn(clean);
  }

  return openaiClient;
}

function resolveAnthropicKey({ apiKey = '', anthropicApiKey = '', providerKeyStore }) {
  return normalizeText(apiKey || providerKeyStore?.get?.('claude') || anthropicApiKey);
}

function isSupportedProvider(provider) {
  return provider === 'openai' || provider === 'claude';
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
