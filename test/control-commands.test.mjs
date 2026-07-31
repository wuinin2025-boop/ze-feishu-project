import test from 'node:test';
import assert from 'node:assert/strict';

import { commandForAction } from '../src/control/commands.mjs';

test('control actions map to safe sync commands', () => {
  assert.deepEqual(commandForAction('dry-run'), ['sync:all', '--', '--dry-run']);
  assert.deepEqual(commandForAction('sync-all'), ['sync:all']);
  assert.deepEqual(commandForAction('invoice'), ['sync:all', '--', '--only=invoice,verify-invoice']);
  assert.deepEqual(commandForAction('views'), ['sync:all', '--', '--only=views']);
  assert.deepEqual(commandForAction('list'), ['sync:all', '--', '--list']);
});

test('unknown control action is rejected', () => {
  assert.throws(() => commandForAction('delete-everything'), /Unknown control action/);
});
