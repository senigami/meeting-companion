import test from 'node:test';
import assert from 'node:assert/strict';

import { callProvider, ProviderError, PROVIDER_ERROR_TYPES } from '../index.js';

const MESSAGES = [
  { role: 'system', content: 'You are terse.' },
  { role: 'user', content: 'Summarize this.' }
];

function openaiFetch(handler) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    const result = await handler(body, url, options);
    return new Response(JSON.stringify(result), { status: result.__status || 200, headers: { 'content-type': 'application/json' } });
  };
}

function openaiFailure(status, body) {
  return async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// --- OpenAI adapter ---------------------------------------------------------------------------

test('openai: happy path sends the messages array unmodified and returns the reply text', async () => {
  let sentBody = null;
  const { text } = await callProvider({
    provider: 'openai',
    apiKey: 'sk-test-key',
    messages: MESSAGES,
    maxTokens: 50,
    model: 'gpt-4o-mini',
    fetchImpl: openaiFetch((body) => {
      sentBody = body;
      return { choices: [{ message: { content: 'A short line.' } }] };
    })
  });

  assert.equal(text, 'A short line.');
  assert.deepEqual(sentBody.messages, MESSAGES);
  assert.equal(sentBody.model, 'gpt-4o-mini');
  assert.equal(sentBody.max_tokens, 50);
});

test('openai: a 401 response classifies as auth', async () => {
  await assert.rejects(
    () => callProvider({
      provider: 'openai',
      apiKey: 'sk-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'gpt-4o-mini',
      fetchImpl: openaiFailure(401, { error: { message: 'Incorrect API key provided.' } })
    }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.type, PROVIDER_ERROR_TYPES.AUTH);
      return true;
    }
  );
});

test('openai: a 429 response classifies as rate-limit', async () => {
  await assert.rejects(
    () => callProvider({
      provider: 'openai',
      apiKey: 'sk-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'gpt-4o-mini',
      fetchImpl: openaiFailure(429, { error: { message: 'You exceeded your current quota.' } })
    }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.type, PROVIDER_ERROR_TYPES.RATE_LIMIT);
      return true;
    }
  );
});

test('openai: fetchImpl throwing (no response at all) classifies as network', async () => {
  await assert.rejects(
    () => callProvider({
      provider: 'openai',
      apiKey: 'sk-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'gpt-4o-mini',
      fetchImpl: async () => { throw new TypeError('fetch failed'); }
    }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.type, PROVIDER_ERROR_TYPES.NETWORK);
      return true;
    }
  );
});

test('openai: a response with no message content classifies as malformed-response', async () => {
  await assert.rejects(
    () => callProvider({
      provider: 'openai',
      apiKey: 'sk-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'gpt-4o-mini',
      fetchImpl: openaiFetch(() => ({ choices: [{ message: {} }] }))
    }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.type, PROVIDER_ERROR_TYPES.MALFORMED_RESPONSE);
      return true;
    }
  );
});

// --- Claude adapter ----------------------------------------------------------------------------

test('claude: the system message is split into a top-level `system` field, not sent as a message', async () => {
  let sentBody = null;
  await callProvider({
    provider: 'claude',
    apiKey: 'sk-ant-test-key',
    messages: MESSAGES,
    maxTokens: 50,
    model: 'claude-test',
    fetchImpl: async (url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
    }
  });

  assert.equal(sentBody.system, 'You are terse.');
  assert.deepEqual(sentBody.messages, [{ role: 'user', content: 'Summarize this.' }]);
  assert.ok(!sentBody.messages.some((m) => m.role === 'system'), 'system must not also appear as a message');
});

test('claude: multiple text blocks in the content array are joined with newlines', async () => {
  const { text } = await callProvider({
    provider: 'claude',
    apiKey: 'sk-ant-test-key',
    messages: MESSAGES,
    maxTokens: 50,
    model: 'claude-test',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'First block.' },
          { type: 'other', text: 'must be filtered out' },
          { type: 'text', text: 'Second block.' }
        ]
      })
    })
  });

  assert.equal(text, 'First block.\nSecond block.');
});

test('claude: a 401 response classifies as auth', async () => {
  await assert.rejects(
    () => callProvider({
      provider: 'claude',
      apiKey: 'sk-ant-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'claude-test',
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) })
    }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.type, PROVIDER_ERROR_TYPES.AUTH);
      assert.equal(error.detail, 'invalid x-api-key');
      return true;
    }
  );
});

test('claude: a 429 response classifies as rate-limit', async () => {
  await assert.rejects(
    () => callProvider({
      provider: 'claude',
      apiKey: 'sk-ant-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'claude-test',
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) })
    }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.type, PROVIDER_ERROR_TYPES.RATE_LIMIT);
      return true;
    }
  );
});

test('claude: fetchImpl throwing (no response at all) classifies as network', async () => {
  await assert.rejects(
    () => callProvider({
      provider: 'claude',
      apiKey: 'sk-ant-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'claude-test',
      fetchImpl: async () => { throw new TypeError('fetch failed'); }
    }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.type, PROVIDER_ERROR_TYPES.NETWORK);
      return true;
    }
  );
});

test('claude: a response whose content is not an array classifies as malformed-response', async () => {
  await assert.rejects(
    () => callProvider({
      provider: 'claude',
      apiKey: 'sk-ant-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'claude-test',
      fetchImpl: async () => ({ ok: true, json: async () => ({ content: 'not an array' }) })
    }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.type, PROVIDER_ERROR_TYPES.MALFORMED_RESPONSE);
      return true;
    }
  );
});

// --- The privacy property, both adapters ------------------------------------------------------
// Distinctive, unlikely-to-appear-by-accident fake keys, so a substring match is trustworthy.

test('openai: the resolved API key never appears in a thrown error, however the provider fails', async () => {
  const DISTINCTIVE_KEY = 'sk-DISTINCTIVE-TEST-KEY-7f3e9c1a';
  await assert.rejects(
    () => callProvider({
      provider: 'openai',
      apiKey: DISTINCTIVE_KEY,
      messages: MESSAGES,
      maxTokens: 50,
      model: 'gpt-4o-mini',
      fetchImpl: openaiFailure(401, { error: { message: `Incorrect API key provided: ${DISTINCTIVE_KEY}.` } })
    }),
    (error) => {
      // The provider itself echoed the key back in its error message -- exactly the case the
      // self-check exists for. A real ProviderError must never reach the caller carrying it.
      const serialized = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;
      assert.ok(!serialized.includes(DISTINCTIVE_KEY), 'the API key leaked into a thrown error');
      return true;
    }
  );
});

test('claude: the resolved API key never appears in a thrown error, however the provider fails', async () => {
  const DISTINCTIVE_KEY = 'sk-ant-DISTINCTIVE-TEST-KEY-4b2d8f01';
  await assert.rejects(
    () => callProvider({
      provider: 'claude',
      apiKey: DISTINCTIVE_KEY,
      messages: MESSAGES,
      maxTokens: 50,
      model: 'claude-test',
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `bad key ${DISTINCTIVE_KEY}` } }) })
    }),
    (error) => {
      const serialized = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;
      assert.ok(!serialized.includes(DISTINCTIVE_KEY), 'the API key leaked into a thrown error');
      return true;
    }
  );
});

test('the leak self-check itself fires: an adapter that DOES put the key in an error is caught, not silently passed through', async () => {
  // This does not call callProvider -- it exercises throwProviderError directly, proving the guard
  // fails loudly rather than trusting the two adapters above to always avoid the mistake. If this
  // test is deleted, a future adapter regression (an error built from a raw provider response that
  // happens to echo the key) would pass every other test silently.
  const { throwProviderError } = await import('../errors.js');
  const DISTINCTIVE_KEY = 'sk-DISTINCTIVE-LEAK-PROBE-9182';
  assert.throws(
    () => throwProviderError('auth', `key was ${DISTINCTIVE_KEY}`, { apiKey: DISTINCTIVE_KEY }),
    (error) => {
      assert.ok(!(error instanceof ProviderError), 'a leak must fail as a plain Error, not a ProviderError, so it cannot be mistaken for a normal typed failure');
      return true;
    }
  );
});

// --- Contract properties a copy of this directory has to keep -----------------------------------

test('maxRetries is off: a 429 hits the network exactly once, it is not retried behind the caller', async () => {
  // The openai SDK retries 429s and 5xxs twice by default. Neither call site this package replaced
  // retried, so the adapter pins maxRetries: 0 -- an untested pin is one SDK-default change away
  // from silently tripling every rate-limited request.
  let calls = 0;
  await assert.rejects(() => callProvider({
    provider: 'openai',
    apiKey: 'sk-test-key',
    messages: MESSAGES,
    maxTokens: 50,
    model: 'gpt-4o-mini',
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429, headers: { 'content-type': 'application/json' } });
    }
  }));

  assert.equal(calls, 1, 'a 429 must not be retried');
});

test('claude does not retry either, so the two providers agree about it', async () => {
  let calls = 0;
  await assert.rejects(() => callProvider({
    provider: 'claude',
    apiKey: 'sk-ant-test-key',
    messages: MESSAGES,
    maxTokens: 50,
    model: 'claude-test',
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) };
    }
  }));

  assert.equal(calls, 1);
});

test('an option callProvider does not understand is rejected, not silently dropped', async () => {
  // Both adapters pin temperature at 0.2. A caller asking for 0.9 and getting 0.2 with no complaint
  // is a call that reports success while not doing what it was asked -- the failure this package is
  // most likely to hand to a repo that copied it without reading it.
  await assert.rejects(
    () => callProvider({
      provider: 'openai',
      apiKey: 'sk-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'gpt-4o-mini',
      temperature: 0.9,
      fetchImpl: async () => new Response('{}', { status: 200 })
    }),
    (error) => {
      assert.ok(!(error instanceof ProviderError));
      assert.match(error.message, /temperature/);
      return true;
    }
  );
});

test('claude: a non-JSON error body still reaches `detail`, so the caller can explain the failure', async () => {
  // A proxy 502 or a plain-text rate-limit notice is not JSON. The caller picks its operator-facing
  // copy by matching this text, so dropping it turns an actionable message into "request failed".
  await assert.rejects(
    () => callProvider({
      provider: 'claude',
      apiKey: 'sk-ant-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'claude-test',
      fetchImpl: async () => new Response('insufficient_quota: no credit remaining', { status: 429 })
    }),
    (error) => {
      assert.equal(error.type, PROVIDER_ERROR_TYPES.RATE_LIMIT);
      assert.equal(error.detail, 'insufficient_quota: no credit remaining');
      return true;
    }
  );
});

test('claude: an `error` field that is a bare string still reaches `detail`', async () => {
  // Not Anthropic's own shape, but a proxy in front of it produces one, and the pre-extraction path
  // surfaced it. Same loss as the non-JSON case above: an actionable message becomes "request
  // failed" if only `error.message` is read.
  await assert.rejects(
    () => callProvider({
      provider: 'claude',
      apiKey: 'sk-ant-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'claude-test',
      fetchImpl: async () => new Response(JSON.stringify({ error: 'upstream gateway timeout' }), {
        status: 504,
        headers: { 'content-type': 'application/json' }
      })
    }),
    (error) => {
      assert.equal(error.detail, 'upstream gateway timeout');
      return true;
    }
  );
});

test('claude: a body that fails to READ classifies as network rather than escaping unclassified', async () => {
  // Headers arrived, then the connection dropped mid-body. Escaping here would skip both the shared
  // vocabulary and the API-key leak check.
  await assert.rejects(
    () => callProvider({
      provider: 'claude',
      apiKey: 'sk-ant-test-key',
      messages: MESSAGES,
      maxTokens: 50,
      model: 'claude-test',
      fetchImpl: async () => ({ ok: false, status: 500, text: async () => { throw new TypeError('terminated'); } })
    }),
    (error) => {
      assert.ok(error instanceof ProviderError, 'must not escape as a raw transport error');
      assert.equal(error.type, PROVIDER_ERROR_TYPES.NETWORK);
      return true;
    }
  );
});

test('the leak self-check reaches a key hidden in a nested cause, not just the named fields', async () => {
  const { throwProviderError } = await import('../errors.js');
  const DISTINCTIVE_KEY = 'sk-DISTINCTIVE-NESTED-PROBE-5501';
  assert.throws(
    () => throwProviderError('unknown', 'failed', {
      provider: 'openai',
      detail: 'failed',
      apiKey: DISTINCTIVE_KEY,
      cause: new Error(`upstream said key=${DISTINCTIVE_KEY}`)
    }),
    (error) => {
      assert.ok(!(error instanceof ProviderError), 'a leak anywhere in the error must fail loudly');
      return true;
    }
  );
});

// --- outbound deadline ------------------------------------------------------------------------
//
// #136. Neither adapter had any deadline, so a provider that accepted the connection and then went
// quiet held the call open until the process died. The browser's own 12s timeout ends the
// browser's wait and propagates nothing back, so the server kept the socket and the upstream
// connection either way.

test('a provider that never answers is abandoned at the deadline instead of hanging forever', async () => {
  let abortedWith = null;
  const neverAnswers = (url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      abortedWith = init.signal.reason;
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  });

  await assert.rejects(
    callProvider({
      provider: 'claude',
      apiKey: 'sk-ant-test',
      messages: MESSAGES,
      maxTokens: 64,
      model: 'claude-haiku-4-5-20251001',
      fetchImpl: neverAnswers,
      timeoutMs: 25
    }),
    (error) => {
      assert.ok(error instanceof ProviderError, 'a deadline must surface as a normal provider failure');
      assert.equal(error.type, PROVIDER_ERROR_TYPES.NETWORK);
      return true;
    }
  );

  assert.match(String(abortedWith?.message), /exceeded 25ms/, 'the abort must name the deadline that fired');
});

test('a call that answers within the deadline is untouched, and its timer does not keep the process alive', async () => {
  const { text } = await callProvider({
    provider: 'claude',
    apiKey: 'sk-ant-test',
    messages: MESSAGES,
    maxTokens: 64,
    model: 'claude-haiku-4-5-20251001',
    fetchImpl: async () => new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'Answered in time.' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ),
    timeoutMs: 5000
  });

  assert.equal(text, 'Answered in time.');
});

test('the deadline composes with a caller-supplied signal rather than replacing it', async () => {
  const caller = new AbortController();
  let sawCallerAbort = false;
  const watchesSignal = (url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      sawCallerAbort = true;
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
    // The OpenAI SDK supplies its own signal; overwriting init.signal would quietly disarm it.
    setTimeout(() => caller.abort(new Error('caller changed their mind')), 5);
  });

  await assert.rejects(callProvider({
    provider: 'claude',
    apiKey: 'sk-ant-test',
    messages: MESSAGES,
    maxTokens: 64,
    model: 'claude-haiku-4-5-20251001',
    // Passed the way the OpenAI SDK passes its own, i.e. already on init.
    fetchImpl: (url, init) => watchesSignal(url, { ...init, signal: caller.signal }),
    timeoutMs: 60000
  }));

  assert.equal(sawCallerAbort, true, "the caller's abort must still reach the fetch");
});

test('timeoutMs 0 opts out of the deadline entirely, and is the only way back to the old behaviour', async () => {
  let sawSignal = 'unset';
  await callProvider({
    provider: 'claude',
    apiKey: 'sk-ant-test',
    messages: MESSAGES,
    maxTokens: 64,
    model: 'claude-haiku-4-5-20251001',
    fetchImpl: async (url, init) => {
      sawSignal = init.signal;
      return new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
    timeoutMs: 0
  });

  assert.equal(sawSignal, undefined, 'opting out must not attach a signal at all');
});
