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

test('api config reports provider availability and source metadata', async () => {
  const app = createApp({
    openaiClient: {},
    anthropicApiKey: 'anthropic-key',
    listAvailableSourcesFn: () => ({
      transcription: [{ id: 'browser', label: 'Browser', description: 'Browser' }],
      summarization: [{ id: 'openai', label: 'OpenAI', description: 'OpenAI' }]
    })
  });

  const response = await invoke(app, { method: 'GET', url: '/api/config' });
  const data = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(data.hasOpenAIKey, true);
  assert.equal(data.hasAnthropicKey, true);
  assert.equal(data.model, 'gpt-4o-mini');
  assert.deepEqual(data.sources.transcription, [{ id: 'browser', label: 'Browser', description: 'Browser' }]);
});

test('malformed json returns a json error response', async () => {
  const app = createApp();

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/transcribe',
    headers: { 'content-type': 'application/json' },
    body: '{"audioBase64":'
  });
  const data = JSON.parse(response.body);

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(data.error, 'Invalid JSON payload.');
});

test('oversized payload returns a json error response', async () => {
  const app = createApp();

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/transcribe',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audioBase64: 'a'.repeat(1024 * 1024 + 32)
    })
  });
  const data = JSON.parse(response.body);

  assert.equal(response.statusCode, 413);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(data.error, 'Request body too large.');
});
