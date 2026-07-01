import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getProviderKeyState,
  maskProviderKey
} from '../../../public/services/provider-credentials.js';

test('provider key helpers mask values and report origin correctly', () => {
  assert.equal(maskProviderKey(''), '');
  assert.equal(maskProviderKey('abcd'), '••••••••');
  assert.equal(maskProviderKey('sk-test-1234567890abcd'), 'sk-••••••••••••abcd');

  assert.deepEqual(getProviderKeyState({ serverReady: true, localKey: '' }), {
    configured: true,
    origin: 'server',
    label: 'Configured on server',
    masked: ''
  });

  assert.deepEqual(getProviderKeyState({ serverReady: false, localKey: ' local-openai-key ' }), {
    configured: true,
    origin: 'local',
    label: 'Configured locally',
    masked: 'loc••••••••••••-key'
  });

  assert.deepEqual(getProviderKeyState({ serverReady: false, localKey: '' }), {
    configured: false,
    origin: 'missing',
    label: 'Needs key',
    masked: ''
  });
});
