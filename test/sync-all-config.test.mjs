import test from 'node:test';
import assert from 'node:assert/strict';

import { selectedSteps, stepIds } from '../src/feishu/sync-all.mjs';

test('default sync all skips the separate boss dashboard table', () => {
  assert.deepEqual(stepIds(selectedSteps([])), [
    'check',
    'invoice',
    'verify-invoice',
    'project-status',
    'permissions',
    'verify-permissions',
    'views',
  ]);
});

test('boss dashboard remains available only when explicitly selected', () => {
  assert.deepEqual(stepIds(selectedSteps(['--only=boss-dashboard'])), ['boss-dashboard']);
});
