import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProjectParticipants,
  mergeUsers,
  resolveProjectPeople,
  writableUsers,
} from '../src/rules/project-personnel-rules.mjs';

test('project participants merge planning design and execution without manager', () => {
  assert.deepEqual(
    buildProjectParticipants({
      manager: [{ id: 'u1', name: '负责人' }],
      planners: [{ id: 'u1', name: '负责人' }, { id: 'u2', name: '策划' }],
      designers: [{ id: 'u2', name: '策划' }, { id: 'u3', name: '设计' }],
      executors: [{ id: 'u4', name: '执行' }],
    }),
    [
      { id: 'u2', name: '策划' },
      { id: 'u3', name: '设计' },
      { id: 'u4', name: '执行' },
    ],
  );
});

test('mergeUsers ignores blanks and keeps the first user representation', () => {
  assert.deepEqual(
    mergeUsers(undefined, [], [{ id: 'u1', name: '姓名A' }], [{ id: 'u1', name: '姓名B' }]),
    [{ id: 'u1', name: '姓名A' }],
  );
});

test('writableUsers keeps only ids accepted by Feishu writes', () => {
  assert.deepEqual(writableUsers([{ id: 'u1', name: '姓名A' }]), [{ id: 'u1' }]);
});

test('establishment manager wins and ledger manager is fallback only', () => {
  assert.deepEqual(
    resolveProjectPeople({
      establishmentRows: [{ manager: [{ id: 'u1', name: '立项负责人' }], participants: [] }],
      ledgerRows: [{ manager: [{ id: 'u2', name: '台账负责人' }], participants: [] }],
    }),
    {
      manager: [{ id: 'u1', name: '立项负责人' }],
      participants: [],
      conflict: null,
    },
  );

  assert.deepEqual(
    resolveProjectPeople({
      establishmentRows: [{ manager: [], participants: [] }],
      ledgerRows: [{ manager: [{ id: 'u2', name: '台账负责人' }], participants: [] }],
    }).manager,
    [{ id: 'u2', name: '台账负责人' }],
  );
});

test('conflicting establishment managers are reported and not selected', () => {
  const result = resolveProjectPeople({
    establishmentRows: [
      { manager: [{ id: 'u1', name: '负责人A' }], participants: [] },
      { manager: [{ id: 'u2', name: '负责人B' }], participants: [] },
    ],
    ledgerRows: [{ manager: [{ id: 'u3', name: '台账负责人' }], participants: [] }],
  });

  assert.deepEqual(result.manager, []);
  assert.deepEqual(result.conflict, {
    source: '源_立项申请',
    people: ['负责人A', '负责人B'],
  });
});
