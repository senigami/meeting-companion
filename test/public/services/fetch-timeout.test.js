import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchWithTimeout } from '../../../public/services/fetch-timeout.js';

test('fetchWithTimeout aborts and rejects when the timer fires before the request resolves', async () => {
  let capturedSignal = null;
  let clearedHandle = null;
  const fetchImpl = (url, options) => {
    capturedSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  let scheduled = null;
  const setTimeoutFn = (callback) => {
    scheduled = callback;
    return 'timer-handle';
  };
  const clearTimeoutFn = (handle) => {
    clearedHandle = handle;
  };

  const pending = fetchWithTimeout(fetchImpl, '/api/example', {}, {
    timeoutMs: 12000,
    setTimeoutFn,
    clearTimeoutFn
  });

  await assert.rejects(async () => {
    scheduled();
    await pending;
  }, /Request timed out/);

  assert.equal(capturedSignal?.aborted, true);
  assert.equal(clearedHandle, 'timer-handle');
});

test('fetchWithTimeout clears the timer on success and resolves normally', async () => {
  let clearedHandle = null;
  const fetchImpl = async () => ({ ok: true, json: async () => ({ line: 'hello' }) });

  const setTimeoutFn = () => 'timer-handle';
  const clearTimeoutFn = (handle) => {
    clearedHandle = handle;
  };

  const response = await fetchWithTimeout(fetchImpl, '/api/example', {}, {
    timeoutMs: 12000,
    setTimeoutFn,
    clearTimeoutFn
  });

  assert.equal(response.ok, true);
  assert.equal(clearedHandle, 'timer-handle');
});

test('fetchWithTimeout clears the timer when the request rejects for a non-timeout reason', async () => {
  let clearedHandle = null;
  const fetchImpl = async () => {
    throw new Error('network down');
  };

  const setTimeoutFn = () => 'timer-handle';
  const clearTimeoutFn = (handle) => {
    clearedHandle = handle;
  };

  await assert.rejects(
    () => fetchWithTimeout(fetchImpl, '/api/example', {}, {
      timeoutMs: 12000,
      setTimeoutFn,
      clearTimeoutFn
    }),
    /network down/
  );

  assert.equal(clearedHandle, 'timer-handle');
});

test('fetchWithTimeout defaults to global setTimeout/clearTimeout and passes the abort signal through', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, '/api/example');
    assert.equal(Boolean(options.signal), true);
    return { ok: true, json: async () => ({}) };
  };

  const response = await fetchWithTimeout(fetchImpl, '/api/example', {});
  assert.equal(response.ok, true);
});
