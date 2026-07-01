import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createApp } from '../../server.js';

function createRequest({ method = 'GET', url = '/', body = '', headers = {} } = {}) {
  const bodyString = String(body);
  const contentLength = Buffer.byteLength(bodyString);
  const req = new Readable({ read() {} });
  req.method = method;
  req.url = url;
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
  assert.match(openaiConfig.providerKeys.openai.masked, /^sk?|^loc/);
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
