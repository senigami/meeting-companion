import test from 'node:test';
import assert from 'node:assert/strict';

import { createSummarizationDriver } from '../../../public/services/registry.js';

test('registry exposes claude summarization driver', () => {
  const driver = createSummarizationDriver('claude', { fetchImpl: async () => ({}) });

  assert.equal(driver.id, 'claude');
  assert.equal(driver.label, 'Claude');
});
