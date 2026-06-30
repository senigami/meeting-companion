import test from 'node:test';
import assert from 'node:assert/strict';

import { readResponseJson, responseErrorMessage } from '../../../public/services/response.js';

test('response helper reads raw non-json text safely', async () => {
  const data = await readResponseJson({
    text: async () => 'plain text error'
  });

  assert.equal(data.raw, 'plain text error');
  assert.equal(responseErrorMessage(data, 'fallback message'), 'plain text error');
});
