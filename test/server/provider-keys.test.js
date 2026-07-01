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

test('provider key test endpoint validates local override credentials', async () => {
  let openaiKey = null;
  let anthropicKey = null;

  const app = createApp({
    createOpenAIClientFn: (apiKey) => {
      openaiKey = apiKey;
      return {
        models: {
          list: async () => ({ data: [] })
        }
      };
    },
    fetchImpl: async (url, options) => {
      anthropicKey = options.headers['x-api-key'];
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] })
      };
    }
  });

  const openaiResponse = await invoke(app, {
    method: 'POST',
    url: '/api/provider/test',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', apiKey: 'local-openai-key' })
  });
  const openaiData = JSON.parse(openaiResponse.body);

  const claudeResponse = await invoke(app, {
    method: 'POST',
    url: '/api/provider/test',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'claude', apiKey: 'local-claude-key' })
  });
  const claudeData = JSON.parse(claudeResponse.body);

  assert.equal(openaiResponse.statusCode, 200);
  assert.equal(openaiData.ok, true);
  assert.equal(openaiKey, 'local-openai-key');
  assert.equal(claudeResponse.statusCode, 200);
  assert.equal(claudeData.ok, true);
  assert.equal(anthropicKey, 'local-claude-key');
});
