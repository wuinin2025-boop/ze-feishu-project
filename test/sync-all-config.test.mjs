import test from 'node:test';
import assert from 'node:assert/strict';

import { selectedSteps, stepIds } from '../src/feishu/sync-all.mjs';

test('default sync all skips separate boss dashboard and manual permissions', () => {
  assert.deepEqual(stepIds(selectedSteps([])), [
    'check',
    'invoice',
    'verify-invoice',
    'project-status',
    'views',
  ]);
});

test('boss dashboard remains available only when explicitly selected', () => {
  assert.deepEqual(stepIds(selectedSteps(['--only=boss-dashboard'])), ['boss-dashboard']);
});
