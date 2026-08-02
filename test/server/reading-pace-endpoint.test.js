import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Duplex } from 'node:stream';

import { createApp } from '../../server.js';

// Mirrors test/server/recording-endpoint.test.js's own req/res fakes (kept local rather than
// shared, since that file does not export them) -- see that file for the reasoning behind each
// piece.
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

test('reading-pace save forwards name and payload to the injected store and reports ok', async () => {
  let received = null;
  const app = createApp({
    readingPaceStore: {
      async save(name, payload) {
        received = { name, payload };
        return { ok: true };
      }
    }
  });

  const body = JSON.stringify({
    name: 'jane-doe',
    payload: { recordedAt: '2026-07-31T10:00:00.000Z', fontSizePx: 84, cards: [{ text: 'x', words: 1, chars: 1, ms: 2000 }] }
  });

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/reading-pace',
    body,
    headers: { 'content-type': 'application/json' }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal(received.name, 'jane-doe');
  assert.equal(received.payload.fontSizePx, 84);
});

test('a store failure (invalid name) returns 400 with a redacted error, never the raw payload', async () => {
  const app = createApp({
    readingPaceStore: {
      async save() {
        return { ok: false, error: 'invalid name' };
      }
    }
  });

  const body = JSON.stringify({
    name: '../../etc/passwd',
    payload: { recordedAt: 'x', cards: [{ text: 'A prayer request naming a real family.' }] }
  });

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/reading-pace',
    body,
    headers: { 'content-type': 'application/json' }
  });

  assert.equal(response.statusCode, 400);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.ok, false);
  assert.ok(!response.body.includes('A prayer request naming a real family.'), 'measured content must never appear in an HTTP error body');
});

test('the save endpoint never throws, even if the store itself throws synchronously-shaped errors', async () => {
  const app = createApp({
    readingPaceStore: {
      async save() {
        throw new Error('unexpected');
      }
    }
  });

  const body = JSON.stringify({ name: 'jane-doe', payload: { recordedAt: 'x', cards: [] } });

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/reading-pace',
    body,
    headers: { 'content-type': 'application/json' }
  });

  assert.ok(response.statusCode >= 400);
});

test('reading-pace list is served for a loopback request', async () => {
  const app = createApp({
    readingPaceStore: {
      async save() { return { ok: true }; },
      async list() { return [{ name: 'jane-doe', recordedAt: '2026-07-31T10:00:00.000Z' }]; },
      async read() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/api/reading-pace/list', remoteAddress: '::1' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    profiles: [{ name: 'jane-doe', recordedAt: '2026-07-31T10:00:00.000Z' }]
  });
});

test('reading-pace list is refused for a non-loopback remote address', async () => {
  const app = createApp({
    readingPaceStore: {
      async save() { return { ok: true }; },
      async list() { return []; },
      async read() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/api/reading-pace/list', remoteAddress: '192.168.1.50' });

  assert.equal(response.statusCode, 403);
});

test('reading-pace by name returns the saved payload for a loopback request', async () => {
  const app = createApp({
    readingPaceStore: {
      async save() { return { ok: true }; },
      async list() { return []; },
      async read(name) {
        return name === 'jane-doe' ? { recordedAt: 'x', cards: [] } : null;
      }
    }
  });

  const response = await invoke(app, {
    method: 'GET',
    url: '/api/reading-pace/jane-doe',
    remoteAddress: '::ffff:127.0.0.1'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { recordedAt: 'x', cards: [] });
});

test('reading-pace by name is refused for a non-loopback remote address', async () => {
  const app = createApp({
    readingPaceStore: {
      async save() { return { ok: true }; },
      async list() { return []; },
      async read(name) {
        return name === 'jane-doe' ? { recordedAt: 'x', cards: [] } : null;
      }
    }
  });

  const response = await invoke(app, {
    method: 'GET',
    url: '/api/reading-pace/jane-doe',
    remoteAddress: '10.0.0.5'
  });

  assert.equal(response.statusCode, 403);
});

test('reading-pace by name returns 404 with the usual JSON error shape when not found', async () => {
  const app = createApp({
    readingPaceStore: {
      async save() { return { ok: true }; },
      async list() { return []; },
      async read() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/api/reading-pace/does-not-exist' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'Reading-pace profile not found.' });
});
