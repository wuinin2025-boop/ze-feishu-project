import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFieldPermissions,
  buildPersonRecordRule,
  departedManagerHandoff,
  derivePermissionRoleStatus,
  desiredRoleMemberships,
  projectManagerPeople,
  uniquePeople,
} from '../src/rules/permission-rules.mjs';

function memberships({ admin = [], manager = [], employee = [] } = {}) {
  return {
    管理员: new Set(admin),
    项目负责人: new Set(manager),
    普通员工: new Set(employee),
  };
}

test('role memberships follow identity and remove departed people', () => {
  const result = desiredRoleMemberships([
    { userId: 'ou_admin', identity: '管理员', employmentStatus: '在职' },
    { userId: 'ou_manager', identity: '项目负责人', employmentStatus: '在职' },
    { userId: 'ou_employee', identity: '普通员工', employmentStatus: '在职' },
    { userId: 'ou_left', identity: '项目负责人', employmentStatus: '离职' },
  ]);
  assert.deepEqual([...result.admin], ['ou_admin']);
  assert.deepEqual([...result.manager].sort(), ['ou_admin', 'ou_manager'].sort());
  assert.deepEqual([...result.employee].sort(), ['ou_admin', 'ou_employee', 'ou_manager'].sort());
});

test('permission role status detects stale roles', () => {
  assert.equal(derivePermissionRoleStatus({
    employmentStatus: '在职',
    identity: '项目负责人',
    userId: 'ou_manager',
    roleMemberships: memberships({ manager: ['ou_manager'], employee: ['ou_manager'] }),
  }), '已同步');
  assert.equal(derivePermissionRoleStatus({
    employmentStatus: '离职',
    identity: '项目负责人',
    userId: 'ou_left',
    roleMemberships: memberships({ manager: ['ou_left'] }),
  }), '待同步');
});

test('field and record permission helpers preserve manager owner restrictions', () => {
  assert.deepEqual(buildPersonRecordRule([
    { field_name: '当前项目负责人', type: 11 },
    { field_name: '交接协同人', type: 11 },
  ]), {
    conditions: [
      { field_name: '当前项目负责人', operator: 'contains' },
      { field_name: '交接协同人', operator: 'contains' },
    ],
    conjunction: 'or',
    other_perm: 0,
  });
  assert.deepEqual(buildFieldPermissions([
    { field_name: '当前项目负责人' },
    { field_name: '项目描述' },
  ], { editable: ['项目描述'] }), {
    当前项目负责人: 1,
    项目描述: 3,
  });
});

test('departed project manager is replaced only by valid handoff people', () => {
  const peopleById = new Map([
    ['ou_left', { userId: 'ou_left', identity: '项目负责人', employmentStatus: '离职' }],
    ['ou_handoff', { userId: 'ou_handoff', identity: '项目负责人', employmentStatus: '在职' }],
  ]);
  assert.deepEqual(departedManagerHandoff({
    managers: [{ id: 'ou_left' }],
    handoffs: [{ id: 'ou_handoff' }],
    peopleById,
  }), {
    action: 'replace_with_handoff',
    newManagers: [{ id: 'ou_handoff' }],
    reason: '负责人离职，自动交接给有效交接协同人',
  });
  assert.equal(departedManagerHandoff({
    managers: [{ id: 'ou_left' }],
    handoffs: [],
    peopleById,
  }).action, 'needs_handoff');
});

test('project manageable people merge manager and handoff users', () => {
  assert.deepEqual(uniquePeople([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]), [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(projectManagerPeople({
    managers: [{ id: 'manager' }],
    handoffs: [{ id: 'handoff' }],
  }), [{ id: 'manager' }, { id: 'handoff' }]);
});
