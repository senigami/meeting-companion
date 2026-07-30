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
import { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from './server/model-config.js';
import { createSessionRecorder } from './server/session-recorder.js';

const MAIN_FILE = fileURLToPath(import.meta.url);

export function createApp({
  openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null,
  createOpenAIClientFn = (apiKey) => new OpenAI({ apiKey }),
  openaiModel = DEFAULT_OPENAI_MODEL,
  anthropicApiKey = process.env.ANTHROPIC_API_KEY || '',
  anthropicModel = DEFAULT_ANTHROPIC_MODEL,
  fetchImpl = fetch,
  listAvailableSourcesFn = listAvailableSources,
  providerKeyStore = createProviderKeyStore(),
  sessionRecorder = createSessionRecorder()
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
      // Non-streaming call: this route only ever sends ONE response back to the
      // client, so no partial/delta result from streaming was ever surfaced.
      // `stream: true` bought us nothing but a long-lived SSE connection to
      // OpenAI — precisely the shape that produces ECONNRESET on a flaky path,
      // and the leading suspect for a real ECONNRESET incident. Do not restore
      // it as an "optimization" without a client that actually consumes deltas.
      const transcription = await client.audio.transcriptions.create({
        file,
        model: 'gpt-4o-transcribe',
        prompt: buildTranscriptionPrompt(mode),
        language: 'en'
      });

      res.json({ text: normalizeText(transcription.text || '') });
    } catch (error) {
      // Redacted before logging too: stderr is usually captured into a log file, which is the one
      // place an in-memory-only provider key (INV-12) was never supposed to come to rest.
      console.error(safeErrorDetail(error));
      res.status(500).json({ error: 'Transcription failed.', detail: safeErrorDetail(error) });
    }
  });

  app.post('/api/summarize', async (req, res) => {
    try {
      const { source = 'openai', apiKey = '', mode = 'speaker', recentTranscript = '', previousBlock = '', visibleLines = [], maxWords } = req.body || {};
      const result = await summarizeWithSource({
        source,
        mode,
        recentTranscript,
        previousBlock,
        visibleLines,
        maxWords,
        openaiClient: resolveOpenAIClient({ apiKey, openaiClient, createOpenAIClientFn, providerKeyStore }),
        anthropicApiKey: source === 'claude'
          ? resolveAnthropicKey({ apiKey, anthropicApiKey, providerKeyStore })
          : anthropicApiKey,
        anthropicModel,
        fetchImpl
      });
      res.json(result);
    } catch (error) {
      // Redacted before logging too: stderr is usually captured into a log file, which is the one
      // place an in-memory-only provider key (INV-12) was never supposed to come to rest.
      console.error(safeErrorDetail(error));
      res.status(500).json({ error: 'Summarization failed.', detail: safeErrorDetail(error) });
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
      // Redacted before logging too: stderr is usually captured into a log file, which is the one
      // place an in-memory-only provider key (INV-12) was never supposed to come to rest.
      console.error(safeErrorDetail(error));
      res.status(500).json({ error: 'Provider test failed.' });
    }
  });

  // Debugging/tuning instrument (ADR-0004): appends a batch of chunk/summary records to a local,
  // gitignored ndjson file so a real meeting can be replayed against prompt changes. Localhost-only
  // (this app never binds off loopback without ALLOW_REMOTE_HOST=true -- see resolveHost), so this
  // is not a new external network surface. A write failure degrades to { ok: false } and is never
  // thrown -- the client is expected to treat that as "recording stopped," never as a reason to
  // interrupt transcription or summarization.
  app.post('/api/recording/append', async (req, res) => {
    try {
      const { sessionId = '', records = [] } = req.body || {};
      const result = await sessionRecorder.appendRecords(sessionId, records);
      if (!result.ok) {
        // No `records` content or raw error object in the response -- recorded text is at least as
        // sensitive as a provider key (INV-12's discipline extended to this surface).
        return res.status(400).json({ ok: false, error: safeErrorDetail(result.error || 'write failed') });
      }
      res.json({ ok: true, written: result.written });
    } catch (error) {
      // sessionRecorder.appendRecords is documented to never throw, but this route must survive
      // even if that contract is ever violated (a bad injected recorder in a test, a future
      // regression) -- an uncaught rejection here would hang the request rather than degrading to
      // "recording stopped," which is the one thing this whole instrument must never do.
      console.error(safeErrorDetail(error));
      res.status(500).json({ ok: false, error: safeErrorDetail(error) });
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

const MAX_ERROR_DETAIL_LENGTH = 200;
// Matches OpenAI/Anthropic-shaped secret keys (sk-..., sk-ant-...) so a key
// accidentally embedded in an error message (e.g. from a thrown request URL)
// can never reach the client. Never relax this without an explicit owner ask.
const API_KEY_PATTERN = /\b(sk-[A-Za-z0-9_-]{10,}|sk-ant-[A-Za-z0-9_-]{10,})\b/gi;
const AUTH_HEADER_PATTERN = /authorization\s*:\s*\S+/gi;

// Extracts a short, safe-to-display detail from a caught error: enough for an
// operator to know *why* a call failed (e.g. "ECONNRESET" or a network cause)
// without ever leaking a provider key, an Authorization header, request body
// audio, or transcript text. INV-12 (provider keys never leave the server
// process) applies to this string just as much as to the key store itself.
function safeErrorDetail(error) {
  const raw = String(error?.code || error?.cause?.code || error?.message || error || 'Unknown error');
  const redacted = raw.replace(API_KEY_PATTERN, '[redacted]').replace(AUTH_HEADER_PATTERN, '[redacted]');
  return redacted.length > MAX_ERROR_DETAIL_LENGTH ? `${redacted.slice(0, MAX_ERROR_DETAIL_LENGTH)}…` : redacted;
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
