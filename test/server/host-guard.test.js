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
  // Bounded, because the static-file test below would otherwise HANG rather than fail if the guard
  // were removed: express.static would take over and try to stream a real file through a response
  // fake that cannot receive one, and nothing would ever resolve. A hanging test in a suite is worse
  // than a failing one -- it reads as an infrastructure problem instead of a regression.
  return Promise.race([
    finished(),
    new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no response for ${requestOptions.method || 'GET'} ${requestOptions.url}`)), 2000);
      timer.unref?.();
    })
  ]);
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

test('a hostname that merely CONTAINS a loopback name is refused, since registering one is free', async () => {
  const app = keylessApp();

  // The whole attack is choosing the hostname, so a check that asks "does this look loopback-ish"
  // hands it straight back. Every one of these is a name an attacker can actually register or
  // resolve, and every one would pass a substring, prefix, or suffix comparison.
  const lookalikes = [
    '127.0.0.1.evil.com',
    'localhost.evil.com',
    'evil.com.localhost',
    'notlocalhost',
    'localhost-evil.com',
    'a127.0.0.1'
  ];

  for (const host of lookalikes) {
    const response = await invoke(app, { url: '/api/config', host });
    assert.equal(response.statusCode, 403, `${host} is not localhost and must be refused`);
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
  const csp = response.headers['content-security-policy'];

  assert.match(csp, /default-src 'self'/);
  // 'wasm-unsafe-eval' has to stay OUT of this exclusion, or this test blocks its own fix: the app
  // genuinely needs it (see the next test), and a plain /unsafe-eval/ substring match would flag it
  // as if it were bare 'unsafe-eval'. Matched as a token, not a substring, for exactly that reason.
  const directives = csp.split(';').map((d) => d.trim());
  const tokens = directives.flatMap((d) => d.split(/\s+/).slice(1));
  assert.equal(tokens.includes("'unsafe-inline'"), false, 'nothing legitimate needs inline script or style');
  assert.equal(tokens.includes("'unsafe-eval'"), false, 'bare eval/new Function must stay blocked');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('the CSP permits WebAssembly, or live transcription silently breaks', async () => {
  // Silero VAD (public/services/transcription/vad-loader.js) loads ONNX Runtime's WASM build and
  // calls WebAssembly.instantiate. CSP gates that independently of 'self' -- fetching the .wasm
  // file is covered by 'self', running it is not -- and there is no console hint that a CSP is the
  // reason it failed. A CSP that closes the origin hole while quietly breaking the app's own core
  // feature is a worse outcome than the hole.
  const app = keylessApp();

  const response = await invoke(app, { url: '/api/config' });
  const csp = response.headers['content-security-policy'];
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));

  assert.ok(scriptSrc, 'script-src must be stated explicitly, not left to default-src to decide');
  const tokens = scriptSrc.split(/\s+/).slice(1);
  assert.ok(tokens.includes("'wasm-unsafe-eval'"), 'WebAssembly.instantiate must be permitted');
  // Exact token comparison, not a substring test: "'unsafe-eval'" is not a substring of
  // "'wasm-unsafe-eval'" (the quote sits before "wasm", not before "unsafe"), but a careless
  // /unsafe-eval/ regex would still flag the wasm token as if it reopened bare eval.
  assert.equal(tokens.includes("'unsafe-eval'"), false, "wasm-unsafe-eval must not reopen bare eval/new Function");
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
