import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteProviderKey,
  getProviderKey,
  maskProviderKey,
  readProviderKeys,
  saveProviderKey
} from '../../../public/services/provider-credentials.js';

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

test('provider key storage is local, masked, and replaceable', () => {
  const storage = createStorage();

  saveProviderKey(storage, 'openai', '  sk-test-1234567890abcd  ');
  saveProviderKey(storage, 'claude', 'claude-secret-key');

  assert.equal(getProviderKey(storage, 'openai'), 'sk-test-1234567890abcd');
  assert.equal(getProviderKey(storage, 'claude'), 'claude-secret-key');
  assert.deepEqual(readProviderKeys(storage), {
    openai: 'sk-test-1234567890abcd',
    claude: 'claude-secret-key'
  });
  assert.equal(maskProviderKey('sk-test-1234567890abcd'), 'sk-••••••••••••abcd');

  deleteProviderKey(storage, 'openai');

  assert.equal(getProviderKey(storage, 'openai'), '');
  assert.deepEqual(readProviderKeys(storage), {
    claude: 'claude-secret-key'
  });
});
