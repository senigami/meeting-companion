import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Duplex } from 'node:stream';

import { createApp } from '../../server.js';

// Mirrors test/server/app.test.js's own req/res fakes (kept local rather than shared, since that
// file does not export them) -- see that file for the reasoning behind each piece.
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
  // Real connections carry this on req.socket; the guard under test reads it directly (never
  // req.ip or a header) so the fake request has to provide it too. It has to be an actual Duplex
  // (not a plain object) -- Node's IncomingMessage teardown calls stream internals on req.socket
  // regardless of whether the guard under test ever touches it.
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

test('recording append forwards the batch to the injected recorder and reports what was written', async () => {
  let received = null;
  const app = createApp({
    sessionRecorder: {
      async appendRecords(sessionId, records) {
        received = { sessionId, records };
        return { ok: true, written: records.length };
      }
    }
  });

  const body = JSON.stringify({
    sessionId: '2026-07-29T10-00-00Z',
    records: [{ t: 'chunk', at: 'x', id: '1', mode: 'speaker', text: 'A neighbor was forgiven.' }]
  });

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/recording/append',
    body,
    headers: { 'content-type': 'application/json' }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, written: 1 });
  assert.equal(received.sessionId, '2026-07-29T10-00-00Z');
  assert.equal(received.records[0].text, 'A neighbor was forgiven.');
});

test('a recorder failure returns ok:false with a redacted error, never the raw transcript content', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() {
        return { ok: false, error: 'ENOSPC' };
      }
    }
  });

  const body = JSON.stringify({
    sessionId: 'bad',
    records: [{ t: 'chunk', text: 'A prayer request naming a real family.' }]
  });

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/recording/append',
    body,
    headers: { 'content-type': 'application/json' }
  });

  assert.equal(response.statusCode, 400);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.ok, false);
  assert.ok(!response.body.includes('A prayer request naming a real family.'), 'recorded content must never appear in an HTTP error body');
});

test('the endpoint never throws, even if the recorder itself throws synchronously-shaped errors', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() {
        throw new Error('unexpected');
      }
    }
  });

  const body = JSON.stringify({ sessionId: 'x', records: [{ t: 'chunk', text: 'x' }] });

  // express's own error middleware turns an uncaught rejection in a route into a 500, not a crash --
  // this pins that the route surviving a recorder throw is at minimum a clean HTTP response.
  const response = await invoke(app, {
    method: 'POST',
    url: '/api/recording/append',
    body,
    headers: { 'content-type': 'application/json' }
  });

  assert.ok(response.statusCode >= 400);
});

test('recording list returns the injected recorder\'s listing as JSON', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() {
        return [{ id: 'session-b', bytes: 42, modifiedAt: '2026-07-29T10:00:05.000Z' }];
      },
      async readRecording() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/api/recording/list' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    recordings: [{ id: 'session-b', bytes: 42, modifiedAt: '2026-07-29T10:00:05.000Z' }]
  });
});

test('recording by id returns the raw ndjson body with the ndjson content type', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording(id) {
        return id === 'session-a' ? '{"t":"chunk"}\n' : null;
      }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/api/recording/session-a' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '{"t":"chunk"}\n');
});

test('recording by id returns 404 with the usual JSON error shape when not found', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/api/recording/does-not-exist' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'Recording not found.' });
});

// The guard reads the request's actual remote address (req.socket.remoteAddress), never the
// server's bind address and never a client-supplied header, so these tests pin origin -- not
// binding -- as the thing that decides access.

test('recording list is served for a loopback request', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() {
        return [{ id: 'session-b', bytes: 42, modifiedAt: '2026-07-29T10:00:05.000Z' }];
      },
      async readRecording() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/api/recording/list', remoteAddress: '::1' });

  assert.equal(response.statusCode, 200);
});

test('recording list is refused for a non-loopback remote address', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() {
        return [{ id: 'session-b', bytes: 42, modifiedAt: '2026-07-29T10:00:05.000Z' }];
      },
      async readRecording() { return null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/api/recording/list', remoteAddress: '192.168.1.50' });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Recording readback is disabled for requests not originating from this machine.'
  });
});

test('recording by id is served for a loopback request', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording(id) {
        return id === 'session-a' ? '{"t":"chunk"}\n' : null;
      }
    }
  });

  const response = await invoke(app, {
    method: 'GET',
    url: '/api/recording/session-a',
    remoteAddress: '::ffff:127.0.0.1'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '{"t":"chunk"}\n');
});

test('recording by id is refused for a non-loopback remote address', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording(id) {
        return id === 'session-a' ? '{"t":"chunk"}\n' : null;
      }
    }
  });

  const response = await invoke(app, {
    method: 'GET',
    url: '/api/recording/session-a',
    remoteAddress: '10.0.0.5'
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Recording readback is disabled for requests not originating from this machine.'
  });
});

test('a spoofed X-Forwarded-For claiming loopback is still refused when the peer is not loopback', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() {
        return [{ id: 'session-b', bytes: 42, modifiedAt: '2026-07-29T10:00:05.000Z' }];
      },
      async readRecording() { return null; }
    }
  });

  const response = await invoke(app, {
    method: 'GET',
    url: '/api/recording/list',
    remoteAddress: '203.0.113.7',
    headers: { 'x-forwarded-for': '127.0.0.1' }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Recording readback is disabled for requests not originating from this machine.'
  });
});
