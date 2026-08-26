import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Duplex } from 'node:stream';

import { createApp } from '../../server.js';

// A loopback SOCKET is not a loopback ORIGIN. In a DNS-rebinding attack the peer address genuinely
// is 127.0.0.1, so refuseUnlessLoopback passes by design and every transcript, the reader's personal
// measurement, and POST /api/provider/key are reachable from a hostile page the operator merely has
// open. The Host header is the only thing left that says which NAME the browser thinks it reached,
// and a rebound page cannot forge it -- the browser sends the attacker's hostname because that is
// what it navigated to.
//
// Mirrors the req/res fakes in the sibling server tests (kept local, since none of them export).
function createRequest({ method = 'GET', url = '/', body = '', headers = {}, remoteAddress = '127.0.0.1', host = '127.0.0.1' } = {}) {
  const bodyString = String(body);
  const req = new Readable({ read() {} });
  req.method = method;
  req.url = url;
  req.headers = {
    connection: 'close',
    'content-length': String(Buffer.byteLength(bodyString)),
    // Spelled this way so `host: null` can express "no Host header at all", which `...headers`
    // spreading a default could not.
    ...(host === null ? {} : { host }),
    ...headers
  };
  // Has to be a real Duplex: Node's IncomingMessage teardown calls stream internals on req.socket.
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
    for (const candidate of [reasonOrHeaders, maybeHeaders]) {
      if (candidate && typeof candidate === 'object') {
        for (const [key, value] of Object.entries(candidate)) headers.set(String(key).toLowerCase(), value);
      }
    }
    return res;
  };
  res.write = (chunk) => { if (chunk) chunks.push(Buffer.from(chunk)); return true; };
  res.end = (chunk) => {
    if (chunk) chunks.push(Buffer.from(chunk));
    if (!finished) { finished = true; resolveFinished(); }
    return res;
  };

  return {
    res,
    async finished() {
      await finishedPromise;
      return { statusCode: res.statusCode, headers: Object.fromEntries(headers.entries()), body: Buffer.concat(chunks).toString('utf8') };
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

function keylessApp(overrides = {}) {
  return createApp({
    openaiApiKey: '',
    anthropicApiKey: '',
    createOpenAIClientFn: () => ({ models: { list: async () => ({ data: [] }) } }),
    ...overrides
  });
}

test('a request whose Host header names somewhere else is refused, even though the socket is loopback', async () => {
  const app = keylessApp();

  const rebound = await invoke(app, { url: '/api/config', host: 'evil.example.com', remoteAddress: '127.0.0.1' });

  assert.equal(rebound.statusCode, 403, 'a rebound origin must not reach the API at all');
  assert.doesNotMatch(rebound.body, /providerKeys/, 'and must not be handed the config payload anyway');
});

test('the rebinding guard also covers the static files, not only the API', async () => {
  const app = keylessApp();

  // Serving the page itself to a hostile origin is how everything else gets read, so the guard is
  // mounted above express.static rather than beside the API routes.
  const page = await invoke(app, { url: '/index.html', host: 'evil.example.com' });

  assert.equal(page.statusCode, 403);
});

test('every loopback name the operator can actually type still works, port and all', async () => {
  const app = keylessApp();

  for (const host of ['127.0.0.1', '127.0.0.1:3000', 'localhost', 'localhost:3000', '[::1]:3000']) {
    const response = await invoke(app, { url: '/api/config', host });
    assert.equal(response.statusCode, 200, `${host} must be allowed`);
  }
});

test('a request with no Host header at all is refused rather than waved through', async () => {
  const app = keylessApp();

  const response = await invoke(app, { url: '/api/config', host: null });

  assert.equal(response.statusCode, 403, 'an absent Host is unrecognized, not exempt');
});

test('the host configured for a deliberate remote bind is allowed, so ALLOW_REMOTE_HOST still works', async () => {
  const app = keylessApp({ allowedHosts: new Set(['127.0.0.1', 'localhost', 'meeting-laptop.local']) });

  const remote = await invoke(app, { url: '/api/config', host: 'meeting-laptop.local:3000', remoteAddress: '10.0.0.5' });
  assert.equal(remote.statusCode, 200, 'the configured name must still reach the app');

  const other = await invoke(app, { url: '/api/config', host: 'evil.example.com', remoteAddress: '10.0.0.5' });
  assert.equal(other.statusCode, 403, 'and nothing else should');
});

test('every response carries a CSP that would stop injected markup from loading anything', async () => {
  const app = keylessApp();

  const response = await invoke(app, { url: '/api/config' });

  assert.match(response.headers['content-security-policy'], /default-src 'self'/);
  assert.doesNotMatch(
    response.headers['content-security-policy'],
    /unsafe-inline|unsafe-eval/,
    'both HTML files are free of inline script, so nothing legitimate needs these'
  );
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('the masked key tail goes to this machine and nowhere else, and the key itself goes nowhere at all', async () => {
  const app = keylessApp({ allowedHosts: new Set(['127.0.0.1', 'localhost', 'meeting-laptop.local']) });

  await invoke(app, {
    method: 'POST',
    url: '/api/provider/key',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', apiKey: 'sk-proj-realistic-looking-key-cXYZ' })
  });

  const local = await invoke(app, { url: '/api/config', remoteAddress: '127.0.0.1' });
  const localBody = JSON.parse(local.body);
  assert.equal(localBody.providerKeys.openai.masked, 'sk-••••••••••••cXYZ', 'the operator still sees which key is loaded');

  // ALLOW_REMOTE_HOST exists so a second screen on the venue wifi can load the display. It has no
  // business knowing four characters of the key.
  const remote = await invoke(app, { url: '/api/config', host: 'meeting-laptop.local', remoteAddress: '10.0.0.5' });
  const remoteBody = JSON.parse(remote.body);
  assert.equal(remote.statusCode, 200, 'a remote display must still be able to read its config');
  assert.equal(remoteBody.providerKeys.openai.configured, true, 'and must still learn a key IS configured');
  assert.equal(remoteBody.providerKeys.openai.masked, '', 'but not any part of it');

  // The consequence, asserted directly rather than inferred from the mask's shape. Nothing else in
  // the suite pinned this, so maskProviderKey could have returned the raw key and stayed green.
  for (const response of [local, remote]) {
    assert.equal(
      response.body.includes('sk-proj-realistic-looking-key-cXYZ'),
      false,
      '/api/config must never carry the key itself'
    );
  }
});
