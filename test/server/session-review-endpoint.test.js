import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Duplex } from 'node:stream';

import { createApp } from '../../server.js';
import { formatDisplayTime } from '../../server/session-review.js';

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
  // Compact display time (America/New_York, this repo's own meeting timezone -- see
  // formatDisplayTime), no AM/PM, not the raw UTC "at" -- but the exact instant still appears, in
  // the cell's title attribute, so nothing is actually lost.
  assert.match(response.body, />6:00:05</);
  assert.doesNotMatch(response.body, /6:00:05\s*[AP]M/);
  assert.match(response.body, /title="2026-07-29T10:00:05\.000Z"/);
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

test('formatDisplayTime renders the room\'s wall clock (America/New_York), no AM/PM, not raw UTC', () => {
  // Summer: EDT (UTC-4).
  assert.equal(formatDisplayTime('2026-07-29T10:00:05.000Z'), '6:00:05');
  // Winter: EST (UTC-5) -- the offset itself must be date-aware, not a fixed hour subtraction.
  assert.equal(formatDisplayTime('2026-01-15T10:00:05.000Z'), '5:00:05');
  // Noon must read "12", never "0" or "24" -- the one hour a 12-hour clock can get wrong.
  assert.equal(formatDisplayTime('2026-01-15T17:00:05.000Z'), '12:00:05');
  // Malformed input falls back to returning it unchanged rather than rendering "Invalid Date".
  assert.equal(formatDisplayTime('not a date'), 'not a date');
});

test('a corrected summary is hidden from the default review, renumbering around the gap', async () => {
  const ndjson = [
    JSON.stringify({ t: 'header', at: '2026-08-23T16:00:00.000Z', appCommit: 'abc', promptHash: 'ph', maxWords: 10, provider: 'openai', intervalSeconds: 20 }),
    JSON.stringify({ t: 'summary', at: '2026-08-23T16:01:00.000Z', mode: 'information', consumedIds: [], sent: 'real one', returned: 'Real one.', ok: true }),
    JSON.stringify({ t: 'summary', at: '2026-08-23T16:02:00.000Z', mode: 'information', consumedIds: [], sent: 'Godzina.', returned: 'Godzina.', ok: true }),
    JSON.stringify({ t: 'summary', at: '2026-08-23T16:03:00.000Z', mode: 'information', consumedIds: [], sent: 'real two', returned: 'Real two.', ok: true }),
    JSON.stringify({ t: 'correction', at: '2026-08-24T02:00:00.000Z', targetAt: '2026-08-23T16:02:00.000Z', reason: 'setup noise' })
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
  assert.match(response.body, /Real one\./);
  assert.match(response.body, /Real two\./);
  assert.doesNotMatch(response.body, /Godzina/);
  // Renumbered around the hidden row: two visible summaries, rows 1 and 2, not 1 and 3.
  assert.match(response.body, /row-num">1<\/span>[\s\S]*Real one\./);
  assert.match(response.body, /row-num">2<\/span>[\s\S]*Real two\./);
  assert.match(response.body, /1 correction\(s\) applied/);
  assert.match(response.body, /corrections=1/);
});

test('?corrections=1 reveals a corrected row, struck through, with the other two unaffected', async () => {
  const ndjson = [
    JSON.stringify({ t: 'header', at: '2026-08-23T16:00:00.000Z', appCommit: 'abc', promptHash: 'ph', maxWords: 10, provider: 'openai', intervalSeconds: 20 }),
    JSON.stringify({ t: 'summary', at: '2026-08-23T16:01:00.000Z', mode: 'information', consumedIds: [], sent: 'real one', returned: 'Real one.', ok: true }),
    JSON.stringify({ t: 'summary', at: '2026-08-23T16:02:00.000Z', mode: 'information', consumedIds: [], sent: 'Godzina.', returned: 'Godzina.', ok: true }),
    JSON.stringify({ t: 'correction', at: '2026-08-24T02:00:00.000Z', targetAt: '2026-08-23T16:02:00.000Z', reason: 'setup noise' })
  ].join('\n') + '\n';

  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording(id) { return id === 'session-a' ? ndjson : null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/sessions/session-a/review?corrections=1' });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Godzina/);
  assert.match(response.body, /class="corrected"/);
  assert.match(response.body, /hide them again/);
});

test('a speaker-break record forces a divider inside one long same-mode block, where mode alone would not', async () => {
  const ndjson = [
    JSON.stringify({ t: 'header', at: '2026-08-23T16:00:00.000Z', appCommit: 'abc', promptHash: 'ph', maxWords: 10, provider: 'openai', intervalSeconds: 20 }),
    JSON.stringify({ t: 'summary', at: '2026-08-23T16:01:00.000Z', mode: 'speaker', consumedIds: [], sent: 'first speaker line', returned: 'First speaker line.', ok: true }),
    JSON.stringify({ t: 'summary', at: '2026-08-23T16:02:00.000Z', mode: 'speaker', consumedIds: [], sent: 'second speaker line', returned: 'Second speaker line.', ok: true }),
    JSON.stringify({ t: 'speaker-break', at: '2026-08-24T02:00:00.000Z', targetAt: '2026-08-23T16:02:00.000Z' })
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
  // Row 1 (no mode change, index 0) always gets the class as the top of the table; the real check
  // is that row 2 -- same mode as row 1, which alone would NOT trigger a break -- gets it too,
  // because the speaker-break record forces it.
  const rows = response.body.split('<tr');
  const row2 = rows.find((r) => r.includes('Second speaker line'));
  assert.match(row2, /class="mode-change"/);
});

// #135: a manual line used to be invisible here, so a report of a real meeting silently omitted
// every card the operator typed -- including the ones typed precisely because the AI got it wrong.
test('a manually typed line appears in the review table, in time order among the summaries', async () => {
  const ndjson = [
    JSON.stringify({ t: 'header', at: '2026-08-23T16:00:00.000Z', appCommit: 'abc', promptHash: 'ph', maxWords: 10, provider: 'openai', intervalSeconds: 20 }),
    JSON.stringify({ t: 'summary', at: '2026-08-23T16:03:00.000Z', mode: 'speaker', consumedIds: [], sent: 'later raw', returned: 'The later summary.', ok: true }),
    JSON.stringify({ t: 'manual', at: '2026-08-23T16:01:00.000Z', mode: 'information', text: 'Ward council moved to 5pm.', speaker: null, isHeader: false })
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
  assert.match(response.body, /Ward council moved to 5pm\./);
  // Ordered by the record's own `at`, not by file order: the manual record sits AFTER the summary
  // in the file (a summary is written when the provider answers, a manual line the instant it
  // lands), but the reader saw it two minutes earlier.
  assert.ok(
    response.body.indexOf('Ward council moved to 5pm.') < response.body.indexOf('The later summary.'),
    'the earlier manual line must render above the later summary'
  );
});

test('a manual row says nothing was sent, rather than leaving the raw-text cell ambiguously blank', async () => {
  const ndjson = [
    JSON.stringify({ t: 'manual', at: '2026-08-23T16:01:00.000Z', mode: 'song', text: 'Music is playing.', speaker: null, isHeader: false })
  ].join('\n') + '\n';

  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording(id) { return id === 'session-a' ? ndjson : null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/sessions/session-a/review' });

  const row = response.body.split('<tr').find((r) => r.includes('Music is playing.'));
  assert.match(row, /typed by the operator, never sent to a provider/);
  assert.match(row, /typed<\/span>/);
});

// A manual record has no `ok` field at all, because no provider call stands behind it. Reading a
// missing `ok` as falsy would paint the one kind of card that cannot fail in the failure colour.
test('a manual row is never marked failed, even though it carries no ok field', async () => {
  const ndjson = [
    JSON.stringify({ t: 'manual', at: '2026-08-23T16:01:00.000Z', mode: 'song', text: 'Music is playing.', speaker: null, isHeader: false })
  ].join('\n') + '\n';

  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording(id) { return id === 'session-a' ? ndjson : null; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/sessions/session-a/review' });

  const row = response.body.split('<tr').find((r) => r.includes('Music is playing.'));
  assert.doesNotMatch(row, /failed/);
});

// Found live while verifying #135: every colour on this page is picked for a light ground, but the
// body never declared one, so a dark-themed browser painted near-black behind #1a1a1a text and the
// table was unreadable. Pinned because it is a one-line regression to reintroduce and nothing about
// the page LOOKS wrong to anyone whose browser happens to be in light mode.
test('the review page states its own background, so a dark-themed browser cannot black out the text', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording() { return '\n'; }
    }
  });

  const css = await invoke(app, { method: 'GET', url: '/sessions/style.css' });

  assert.match(css.body, /body \{[^}]*background:\s*#fff/);
});

// The strict CSP (server.js) sets default-src 'self' with no style-src / 'unsafe-inline', so an
// inline <style> block would be silently blocked -- found live while gating #155/#158 (Cato retro
// review, .memory/cato-retro-gate-155-158.md): the CSP shipped in the same commit as this page and
// broke it. Pinned so the page can't regress back to an inline style tag without this failing.
test('the review page links a real stylesheet rather than an inline <style> block, so the CSP does not block it', async () => {
  const app = createApp({
    sessionRecorder: {
      async appendRecords() { return { ok: true, written: 0 }; },
      async listRecordings() { return []; },
      async readRecording() { return '\n'; }
    }
  });

  const response = await invoke(app, { method: 'GET', url: '/sessions/session-a/review' });

  assert.doesNotMatch(response.body, /<style>/);
  assert.match(response.body, /<link rel="stylesheet" href="\/sessions\/style\.css">/);
});
