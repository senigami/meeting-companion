import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import OpenAI from 'openai';
import { toFile } from 'openai';
import { getProviderKeyState } from './public/services/provider-credentials.js';
import { listAvailableSources } from './public/services/registry.js';
import { normalizeText } from './public/services/text.js';
import { summarizeWithSource } from './server/summarization.js';
import { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from './server/model-config.js';
import { createSessionRecorder } from './server/session-recorder.js';
import { createReadingPaceStore } from './server/reading-pace-store.js';

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
  sessionRecorder = createSessionRecorder(),
  readingPaceStore = createReadingPaceStore()
} = {}) {
  const app = express();

  // 16 kHz mono int16 PCM, base64-encoded, is 42,667 bytes per second of audio -- so a 1mb limit
  // was a ~24.6s ceiling on any single speech segment. Silero VAD (see openai.js's onFrameProcessed
  // accumulator) only forces a split every 60s, so the limit has to cover that: 60s * 42,667 B/s ~=
  // 2.5mb, and 25mb leaves comfortable headroom (~10 minutes of speech) without inviting abuse.
  app.use(express.json({ limit: '25mb' }));
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
      // No `mode`: transcription returns the words that were said, and everything about what kind
      // of meeting this is belongs to summarization. See issues #27 and #29.
      const { apiKey = '', audioBase64 = '', mimeType = 'audio/webm', filename = 'meeting-companion.webm' } = req.body || {};
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
      // No `prompt` here, deliberately, and do not add one back. It is not an instruction field:
      // OpenAI documents it as priming for names and vocabulary, and gpt-4o-transcribe recites
      // instruction-shaped prose as if it were speech. We used to send "Church meeting audio
      // transcription. Capture the specific story, event, teaching, feeling, invitation, or
      // example." and got back "Church meeting audio", "Capture the specific story," and
      // "Invitation." on chunks where nothing was said (issue #27). Vocabulary hints are no safer;
      // a glossary prompt has been reported coming back verbatim the same way.
      const transcription = await client.audio.transcriptions.create({
        file,
        model: 'gpt-4o-transcribe',
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
      const { source = 'openai', apiKey = '', mode = 'speaker', recentTranscript = '', previousBlock = '', visibleLines = [], maxWords, history = [] } = req.body || {};
      const result = await summarizeWithSource({
        source,
        mode,
        recentTranscript,
        previousBlock,
        visibleLines,
        maxWords,
        history: sanitizeSummaryHistory(history),
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
      const keySource = req.body?.provider === 'openai'
        ? describeOpenAIKeySource({ apiKey: req.body?.apiKey, providerKeyStore, openaiClient })
        : '';
      res.status(500).json({
        error: keySource ? `Provider test failed using ${keySource}.` : 'Provider test failed.'
      });
    }
  });

  // Debugging/tuning instrument (ADR-0004): appends a batch of chunk/summary records to a local,
  // gitignored ndjson file so a real meeting can be replayed against prompt changes. Localhost-only
  // (this app never binds off loopback without ALLOW_REMOTE_HOST=true -- see resolveHost), so this
  // is not a new external network surface. A write failure degrades to { ok: false } and is never
  // thrown -- the client is expected to treat that as "recording stopped," never as a reason to
  // interrupt transcription or summarization.
  // ORDERING MATTERS: this route must stay registered ABOVE refuseUnlessLoopback. That middleware is
  // mounted on the `/api/recording/:id` prefix, which also matches this path, so moving this handler
  // below it would silently start refusing appends from any non-local client. Appends are deliberately
  // not loopback-gated (see the guard's own comment); only readback is.
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

  // Reading-pace measurement save (issue #44, first slice of named reader profiles). The result is a
  // one-time, in-person reading-speed measurement of a real person, calibrated to at that font size --
  // losing it to a cleared browser or an unmovable localStorage entry loses the only copy. Same
  // discipline as /api/recording/append: a write failure degrades to { ok: false } and is never
  // thrown, and the measured cards/timings never appear in the response.
  // ORDERING MATTERS, same reason as /api/recording/append above: this route must stay registered
  // ABOVE refuseUnlessLoopback (defined below), which is mounted on the `/api/reading-pace/:name`
  // prefix that also matches this path.
  app.post('/api/reading-pace', async (req, res) => {
    try {
      const { name = '', payload = null } = req.body || {};
      const result = await readingPaceStore.save(name, payload);
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: safeErrorDetail(result.error || 'write failed') });
      }
      res.json({ ok: true });
    } catch (error) {
      console.error(safeErrorDetail(error));
      res.status(500).json({ ok: false, error: safeErrorDetail(error) });
    }
  });

  // Read-side companions to /api/recording/append. Unlike the append route, these serve raw
  // recorded transcript text back over the network with no auth of their own. ADR-0004 decided
  // that writing recordings to local disk was safe; it never decided that reading them back over
  // the network was, so the safe default is closed until something explicitly reopens it. Gating
  // both routes through one middleware (rather than repeating the check per handler) means a third
  // read route added later inherits the guard instead of quietly bypassing it.
  //
  // The question that matters is "did this request originate from this machine?", not "is the
  // server bound to loopback?" -- a server that is (mis)configured to bind off loopback should
  // still refuse a LAN client while still serving the developer's own local browser. This reads
  // `req.socket.remoteAddress` -- the raw connection peer address -- rather than `req.ip`, because
  // `req.ip` can become header-derived if `trust proxy` is ever enabled; a header-spoofable privacy
  // guard is worse than no guard at all, since it reads as protection while offering none.
  const refuseUnlessLoopback = (req, res, next) => {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      return res.status(403).json({ error: 'Recording readback is disabled for requests not originating from this machine.' });
    }
    next();
  };
  app.use('/api/recording/list', refuseUnlessLoopback);
  app.use('/api/recording/:id', refuseUnlessLoopback);

  app.get('/api/recording/list', async (req, res) => {
    try {
      const recordings = await sessionRecorder.listRecordings();
      res.json({ recordings });
    } catch (error) {
      console.error(safeErrorDetail(error));
      res.status(500).json({ error: 'Listing recordings failed.', detail: safeErrorDetail(error) });
    }
  });

  app.get('/api/recording/:id', async (req, res) => {
    try {
      const contents = await sessionRecorder.readRecording(req.params.id);
      if (contents === null) {
        return res.status(404).json({ error: 'Recording not found.' });
      }
      res.type('application/x-ndjson').send(contents);
    } catch (error) {
      console.error(safeErrorDetail(error));
      res.status(500).json({ error: 'Reading recording failed.', detail: safeErrorDetail(error) });
    }
  });

  // Read-side companions to /api/reading-pace (POST, above). Same reasoning as the recording
  // readback guard just above: this is personal data -- a real person's measured reading speed --
  // and must never leave the machine.
  app.use('/api/reading-pace/list', refuseUnlessLoopback);
  app.use('/api/reading-pace/:name', refuseUnlessLoopback);

  app.get('/api/reading-pace/list', async (req, res) => {
    try {
      const profiles = await readingPaceStore.list();
      res.json({ profiles });
    } catch (error) {
      console.error(safeErrorDetail(error));
      res.status(500).json({ error: 'Listing reading-pace profiles failed.', detail: safeErrorDetail(error) });
    }
  });

  app.get('/api/reading-pace/:name', async (req, res) => {
    try {
      const payload = await readingPaceStore.read(req.params.name);
      if (payload === null) {
        return res.status(404).json({ error: 'Reading-pace profile not found.' });
      }
      res.json(payload);
    } catch (error) {
      console.error(safeErrorDetail(error));
      res.status(500).json({ error: 'Reading reading-pace profile failed.', detail: safeErrorDetail(error) });
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

// Which key a request actually used, for error messages only. A failing provider test that just says
// "failed" sends the operator hunting through a key they may not even be sending: a key typed into the
// panel silently outranks a working server key, so the same message covers two opposite situations.
// Naming the SOURCE is safe -- it is one of three fixed words and never touches key material (INV-12).
function describeOpenAIKeySource({ apiKey = '', providerKeyStore, openaiClient }) {
  if (normalizeText(apiKey)) return 'the key entered in the browser';
  if (normalizeText(providerKeyStore?.get?.('openai') || '')) return 'the key saved earlier this session';
  if (openaiClient) return "the server's own key";
  return 'no key at all';
}

function resolveAnthropicKey({ apiKey = '', anthropicApiKey = '', providerKeyStore }) {
  return normalizeText(apiKey || providerKeyStore?.get?.('claude') || anthropicApiKey);
}

// Untrusted client input: history must be an array of { spoken, shown } string pairs, dropping
// anything else rather than throwing, and capped at the most recent 8 regardless of what the
// client sent so a malformed or hostile client cannot grow the prompt without bound.
const MAX_SUMMARY_HISTORY_ENTRIES = 8;
function sanitizeSummaryHistory(history) {
  if (!Array.isArray(history)) return [];
  const clean = history.filter(
    (turn) => turn && typeof turn === 'object' && typeof turn.spoken === 'string' && typeof turn.shown === 'string'
  ).map((turn) => ({ spoken: turn.spoken, shown: turn.shown }));
  return clean.slice(-MAX_SUMMARY_HISTORY_ENTRIES);
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

// Matches the request's remote address against loopback, exactly (not a prefix match) --
// `127.0.0.1.evil.example` or similar must never pass. Node/Express normalize an IPv4 loopback
// connection arriving on a dual-stack socket to the IPv4-mapped form `::ffff:127.0.0.1`, so that
// form is stripped before comparing.
function isLoopbackAddress(address) {
  if (!address) return false;
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return normalized === '127.0.0.1' || normalized === '::1';
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
