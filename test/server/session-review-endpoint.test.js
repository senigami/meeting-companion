import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Duplex } from 'node:stream';

import { createApp } from '../../server.js';

// Same req/res fakes as test/server/recording-endpoint.test.js -- see that file for the reasoning
// behind each piece (kept local rather than shared, since that file does not export them either).
function createRequest({ method = 'GET', url = '/', body = '', headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  const bodyString = String(body);
  const req = new Readable({ read() {} });
  req.method = method;
  req.url = url;
  req.headers = {
    host: '127.0.0.1',
    connection: 'close',
    'content-length': String(Buffer.byteLength(bodyString)),
    ...headers
  };
  const socket = new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } });
  socket.remoteAddress = remoteAddress;
  req.socket = socket;
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
  const finishedPromise = new Promise((resolve) => { resolveFinished = resolve; });

  res.app = app;
  res.req = null;
  res.statusCode = 200;
  res.locals = {};
  res.setHeader = (name, value) => { headers.set(String(name).toLowerCase(), value); return res; };
  res.getHeader = (name) => headers.get(String(name).toLowerCase());
  res.getHeaders = () => Object.fromEntries(headers.entries());
  res.removeHeader = (name) => { headers.delete(String(name).toLowerCase()); };
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
  res.write = (chunk) => { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true; };
  res.end = (chunk) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    if (!finished) { finished = true; resolveFinished(); }
    return res;
  };

  return {
    res,
    async finished() {
      await finishedPromise;
      return { statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') };
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

test('GET /sessions lists recordings as links, for a loopback request', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() {
        return [{ id: 'session-a', bytes: 42, modifiedAt: '2026-07-29T10:00:05.000Z' }];
      },
      async readRecording() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/sessions' });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<a href="\/sessions\/session-a\/review">session-a<\/a>/);
});

test('GET /sessions is refused for a non-loopback remote address', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/sessions', remoteAddress: '192.168.1.50' });

  assert.equal(response.statusCode, 403);
});

test('GET /sessions/:id/review lines up raw text sent and the summary returned, with timestamps', async () => {
  const ndjson = [
    JSON.stringify({ t: 'header', at: '2026-07-29T10:00:00.000Z', appCommit: 'abc123', promptHash: 'ph', maxWords: 40, provider: 'openai', intervalSeconds: 20 }),
    JSON.stringify({ t: 'chunk', at: '2026-07-29T10:00:01.000Z', id: '1', text: 'A neighbor was forgiven.' }),
    JSON.stringify({
      t: 'summary',
      at: '2026-07-29T10:00:05.000Z',
      mode: 'speaker',
      consumedIds: ['1'],
      sent: 'A neighbor was forgiven.',
      returned: 'A neighbor is forgiven.',
      ok: true
    })
  ].join('\n') + '\n';

  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording(id) { return id === 'session-a' ? ndjson : null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/sessions/session-a/review' });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /2026-07-29T10:00:05\.000Z/);
  assert.match(response.body, /A neighbor was forgiven\./);
  assert.match(response.body, /A neighbor is forgiven\./);
});

test('GET /sessions/:id/review returns 404 when the session does not exist', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/sessions/does-not-exist/review' });

  assert.equal(response.statusCode, 404);
});

test('GET /sessions/:id/review is refused for a non-loopback remote address', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording(id) { return id === 'session-a' ? '{"t":"header"}\n' : null; }
    }
  });

  const response = await invoke(app, {
    method: 'GET',
    url: '/sessions/session-a/review',
    remoteAddress: '10.0.0.5'
  });

  assert.equal(response.statusCode, 403);
});
