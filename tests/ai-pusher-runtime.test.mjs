import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeAndPushToAllFarms,
  getAIPusherRuntimeStatus
} from '../greenreach-central/services/ai-recommendations-pusher.js';

test('AI pusher runtime status reports disabled diagnostics when API key is missing', async (t) => {
  if (process.env.OPENAI_API_KEY) {
    t.skip('OPENAI_API_KEY is configured in this environment; disabled-mode contract test skipped');
    return;
  }

  const before = getAIPusherRuntimeStatus();
  assert.equal(before.configured, false);

  const result = await analyzeAndPushToAllFarms();
  assert.equal(result.disabled, true);
  assert.equal(result.reason, 'OPENAI_API_KEY missing');

  const after = getAIPusherRuntimeStatus();
  assert.equal(after.last_run_status, 'disabled');
  assert.equal(after.last_result?.disabled, true);
  assert.ok(String(after.last_error || '').includes('OPENAI_API_KEY'));
});
