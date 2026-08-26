import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Duplex } from 'node:stream';

import { createApp } from '../../server.js';

function createRequest({ method = 'GET', url = '/', body = '', headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  const bodyString = String(body);
  const contentLength = Buffer.byteLength(bodyString);
  const req = new Readable({ read() {} });
  req.method = method;
  req.url = url;
  // Real connections carry this, and /api/config now reads it to decide whether the masked key tail
  // goes out. A request with no socket at all is treated as non-loopback, which is the right way for
  // that check to fail but makes a socket-less stub silently test the wrong branch. Has to be an
  // actual Duplex, not a plain object -- Node's IncomingMessage teardown calls stream internals on
  // req.socket regardless of what the code under test touches (same note as recording-endpoint).
  const socket = new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } });
  socket.remoteAddress = remoteAddress;
  req.socket = socket;
  req.headers = {
    host: '127.0.0.1',
    connection: 'close',
    'content-length': String(contentLength),
    ...headers
  };
  if (bodyString) req.push(bodyString);
  req.push(null);
  return req;
}

function createResponse(app) {
  const res = Object.create(app.response);
  const headers = new Map();
  const chunks = [];
  let finished = false;
  let resolveFinished;

  const finishedPromise = new Promise((resolve) => {
    resolveFinished = resolve;
  });

  res.app = app;
  res.req = null;
  res.statusCode = 200;
  res.locals = {};
  res.setHeader = (name, value) => {
    headers.set(String(name).toLowerCase(), value);
    return res;
  };
  res.getHeader = (name) => headers.get(String(name).toLowerCase());
  res.getHeaders = () => Object.fromEntries(headers.entries());
  res.removeHeader = (name) => {
    headers.delete(String(name).toLowerCase());
  };
  res.writeHead = (statusCode, reasonOrHeaders, maybeHeaders) => {
    res.statusCode = statusCode;
    if (reasonOrHeaders && typeof reasonOrHeaders === 'object') {
      for (const [key, value] of Object.entries(reasonOrHeaders)) headers.set(String(key).toLowerCase(), value);
    }
    if (maybeHeaders && typeof maybeHeaders === 'object') {
      for (const [key, value] of Object.entries(maybeHeaders)) headers.set(String(key).toLowerCase(), value);
    }
    return res;
  };
  res.write = (chunk) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  };
  res.end = (chunk) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    if (!finished) {
      finished = true;
      resolveFinished();
    }
    return res;
  };

  return {
    res,
    async finished() {
      await finishedPromise;
      return {
        statusCode: res.statusCode,
        headers: Object.fromEntries(headers.entries()),
        body: Buffer.concat(chunks).toString('utf8')
      };
    }
  };
}

async function invoke(app, requestOptions) {
  const req = createRequest(requestOptions);
  const { res, finished } = createResponse(app);
  res.req = req;

  app.handle(req, res);

  return finished();
}

test('provider keys stay on the server and surface through config/status routes', async () => {
  let openaiClientKeys = [];
  let anthropicKeys = [];

  const app = createApp({
    // Explicitly key-less: createApp defaults openaiApiKey/anthropicApiKey from process.env, so
    // without these two the test asserts different things depending on whether the developer
    // running it happens to have a real key in .env -- which is exactly what broke it the morning
    // a key was first added. The whole point here is the LOCAL, in-memory key store.
    openaiApiKey: '',
    anthropicApiKey: '',
    createOpenAIClientFn: (apiKey) => {
      openaiClientKeys.push(apiKey);
      return {
        models: {
          list: async () => ({ data: [] })
        }
      };
    },
    fetchImpl: async (url, options = {}) => {
      anthropicKeys.push(options.headers?.['x-api-key'] || '');
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] })
      };
    }
  });

  const saveOpenAI = await invoke(app, {
    method: 'POST',
    url: '/api/provider/key',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', apiKey: 'local-openai-key' })
  });
  assert.equal(saveOpenAI.statusCode, 200);

  const openaiConfig = JSON.parse((await invoke(app, { method: 'GET', url: '/api/config' })).body);
  assert.equal(openaiConfig.providerKeys.openai.configured, true);
  assert.equal(openaiConfig.providerKeys.openai.origin, 'local');
  // This used to read /^sk?|^loc/, which alternates as (^sk?)|(^loc) and therefore matches the bare
  // letter "s". It asserted nothing: maskProviderKey could have returned the raw key and stayed
  // green. Assert the actual shape, and assert the consequence separately below.
  assert.equal(openaiConfig.providerKeys.openai.masked, 'loc••••••••••••-key');
  assert.doesNotMatch(JSON.stringify(openaiConfig), /local-openai-key/);

  const openaiTest = JSON.parse((await invoke(app, {
    method: 'POST',
    url: '/api/provider/test',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai' })
  })).body);
  assert.equal(openaiTest.ok, true);
  assert.equal(openaiClientKeys.at(-1), 'local-openai-key');

  const saveClaude = await invoke(app, {
    method: 'POST',
    url: '/api/provider/key',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'claude', apiKey: 'local-claude-key' })
  });
  assert.equal(saveClaude.statusCode, 200);

  const claudeTest = JSON.parse((await invoke(app, {
    method: 'POST',
    url: '/api/provider/test',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'claude' })
  })).body);
  assert.equal(claudeTest.ok, true);
  assert.equal(anthropicKeys.at(-1), 'local-claude-key');

  await invoke(app, {
    method: 'DELETE',
    url: '/api/provider/key',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai' })
  });
  await invoke(app, {
    method: 'DELETE',
    url: '/api/provider/key',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'claude' })
  });

  const clearedConfig = JSON.parse((await invoke(app, { method: 'GET', url: '/api/config' })).body);
  assert.equal(clearedConfig.providerKeys.openai.configured, false);
  assert.equal(clearedConfig.providerKeys.claude.configured, false);
});
