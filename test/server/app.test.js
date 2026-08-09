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

test('api config reports the app commit the recording header needs (issue #4), matching git independently', async () => {
  const { execFileSync } = await import('node:child_process');
  const app = createApp();

  const response = await invoke(app, { method: 'GET', url: '/api/config' });
  const data = JSON.parse(response.body);

  // Recomputed here from git itself, not from the server's own helper: a dirty working tree must be
  // reported as such (issue #4), because a bare commit recorded off uncommitted edits claims a
  // provenance the recording does not have and would replay as "matches".
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  assert.equal(data.appCommit, dirty ? `${head}-dirty` : head);
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

test('transcription call carries no prompt at all, in any mode', async () => {
  // Asserts the ABSENCE of the field, not the wording of it. The old test matched the prompt's
  // literal text, so it would have stayed green no matter what that text did to the output. The
  // model recites an instruction-shaped prompt as if it were speech (issue #27), so the only safe
  // state is no prompt on the request, and that is what this pins.
  const seen = [];
  const openaiClient = {
    audio: {
      transcriptions: {
        create: async (params) => {
          seen.push(params);
          return { text: 'hello world' };
        }
      }
    }
  };
  const app = createApp({ openaiClient });

  for (const mode of ['speaker', 'information', 'song', 'prayer']) {
    await invoke(app, {
      method: 'POST',
      url: '/api/transcribe',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audioBase64: Buffer.from('fake-audio').toString('base64'), mode })
    });
  }

  assert.equal(seen.length, 4);
  for (const params of seen) {
    assert.equal('prompt' in params, false, 'the transcription request must not carry a prompt');
  }
});

test('transcription call is not made with stream: true', async () => {
  let receivedParams = null;
  const openaiClient = {
    audio: {
      transcriptions: {
        create: async (params) => {
          receivedParams = params;
          return { text: 'hello world' };
        }
      }
    }
  };
  const app = createApp({ openaiClient });

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/transcribe',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audioBase64: Buffer.from('fake-audio').toString('base64') })
  });
  const data = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(data.text, 'hello world');
  assert.equal(receivedParams.stream, undefined);
});

test('transcription failure includes a safe, redacted error detail', async () => {
  const openaiClient = {
    audio: {
      transcriptions: {
        create: async () => {
          const error = new Error('request failed sk-abcdefghij1234567890 Authorization: Bearer sk-ant-zzzzzzzzzz1234567890');
          error.code = 'ECONNRESET';
          throw error;
        }
      }
    }
  };
  const app = createApp({ openaiClient });

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/transcribe',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audioBase64: Buffer.from('fake-audio').toString('base64') })
  });
  const data = JSON.parse(response.body);

  assert.equal(response.statusCode, 500);
  assert.equal(data.error, 'Transcription failed.');
  assert.equal(data.detail, 'ECONNRESET');
  assert.ok(!data.detail.includes('sk-abcdefghij1234567890'));
  assert.ok(!data.detail.includes('sk-ant-zzzzzzzzzz1234567890'));
});

test('/api/summarize passes well-formed history through to the provider call', async () => {
  let sentMessages = null;
  const openaiClient = {
    chat: {
      completions: {
        create: async ({ messages }) => {
          sentMessages = messages;
          return { choices: [{ message: { content: 'A short line.' } }] };
        }
      }
    }
  };
  const app = createApp({ openaiClient });

  const history = [
    { spoken: 'Earlier chunk.', shown: 'Earlier card.' }
  ];
  const response = await invoke(app, {
    method: 'POST',
    url: '/api/summarize',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'speaker', recentTranscript: 'New text.', history })
  });

  assert.equal(response.statusCode, 200);
  // system, user (history), assistant (history), user (new text)
  assert.equal(sentMessages.length, 4);
  assert.equal(sentMessages[1].content, 'Earlier chunk.');
  assert.equal(sentMessages[2].content, 'Earlier card.');
  assert.equal(sentMessages[3].content, 'New text.');
});

test('/api/summarize sanitises a malformed history to at most 8 well-formed entries rather than throwing', async () => {
  let sentMessages = null;
  const openaiClient = {
    chat: {
      completions: {
        create: async ({ messages }) => {
          sentMessages = messages;
          return { choices: [{ message: { content: 'A short line.' } }] };
        }
      }
    }
  };
  const app = createApp({ openaiClient });

  // 20 well-formed entries, plus junk entries that must be dropped rather than throwing.
  const wellFormed = Array.from({ length: 20 }, (_, i) => ({ spoken: `spoken ${i}`, shown: `shown ${i}` }));
  const malformedHistory = [
    null,
    'not an object',
    42,
    { spoken: 'missing shown' },
    { shown: 'missing spoken' },
    { spoken: 1, shown: 2 },
    ...wellFormed
  ];

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/summarize',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'speaker', recentTranscript: 'New text.', history: malformedHistory })
  });

  assert.equal(response.statusCode, 200);
  // The server sanitises to the most recent 8 well-formed entries; buildMinimalSummarizeMessages
  // further narrows to its own default historyTurns (4) when building the actual message array --
  // system + (4 turns * 2 messages) + final user turn.
  assert.equal(sentMessages.length, 1 + 4 * 2 + 1);
  assert.equal(sentMessages[1].content, 'spoken 16');
  assert.equal(sentMessages[sentMessages.length - 1].content, 'New text.');

  const notArrayResponse = await invoke(app, {
    method: 'POST',
    url: '/api/summarize',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'speaker', recentTranscript: 'New text.', history: 'not an array' })
  });
  assert.equal(notArrayResponse.statusCode, 200);
});

test('oversized payload returns a json error response', async () => {
  const app = createApp();

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/transcribe',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      // The server limit is 25mb (see server.js), sized for a 60s speech segment; this needs to
      // exceed that, not the old 1mb ceiling, to actually exercise the 413 path.
      audioBase64: 'a'.repeat(25 * 1024 * 1024 + 32)
    })
  });
  const data = JSON.parse(response.body);

  assert.equal(response.statusCode, 413);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(data.error, 'Request body too large.');
});
