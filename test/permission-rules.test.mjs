import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEditableTableRole,
  buildFieldPermissions,
  buildPersonRecordRule,
  departedManagerHandoff,
  derivePermissionRoleStatus,
  desiredRoleMemberships,
  latestApplicableManagerChangeByProject,
  projectManagerPeople,
  recordRuleFields,
  resolveManagerChangeRecordFields,
  roleNeedsRebuild,
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
  assert.deepEqual([...result.manager], ['ou_manager']);
  assert.deepEqual([...result.employee].sort(), ['ou_employee', 'ou_manager'].sort());
});

test('project managers keep employee permissions for projects where they are members', () => {
  const result = desiredRoleMemberships([
    { userId: 'ou_manager', identity: '项目负责人', employmentStatus: '在职' },
  ]);

  assert.equal(result.manager.has('ou_manager'), true);
  assert.equal(result.employee.has('ou_manager'), true);
});

test('full-access owners are not duplicated into custom roles', () => {
  const result = desiredRoleMemberships([
    { userId: 'ou_owner', identity: '管理员', employmentStatus: '在职' },
    { userId: 'ou_admin', identity: '管理员', employmentStatus: '在职' },
  ], { fullAccessUserIds: new Set(['ou_owner']) });

  assert.deepEqual([...result.admin], ['ou_admin']);
  assert.equal(result.manager.size, 0);
  assert.equal(result.employee.size, 0);
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
      { field_name: '当前项目负责人', operator: 'contains', value: [] },
      { field_name: '交接协同人', operator: 'contains', value: [] },
    ],
    conjunction: 'or',
    other_perm: 0,
  });
  assert.deepEqual(buildFieldPermissions([
    { field_name: '当前项目负责人' },
    { field_name: '项目成员' },
    { field_name: '项目描述' },
  ], { addable: ['项目成员'], editable: ['项目描述'] }), {
    当前项目负责人: 1,
    项目成员: 2,
    项目描述: 3,
  });
});

test('editable table roles can grant row-scoped actions and explicit field edits', () => {
  assert.deepEqual(buildEditableTableRole('tbl_tasks', [
    { field_name: '任务名称', type: 1 },
    { field_name: '关联项目', type: 18 },
    { field_name: '项目成员', type: 11 },
    { field_name: '任务创建人', type: 1003 },
  ], {
    personRuleFields: ['项目成员', '任务创建人'],
    addable: ['项目成员'],
    editable: ['任务名称', '关联项目'],
    allowAdd: true,
    allowDelete: true,
    viewPerm: 2,
  }), {
    table_id: 'tbl_tasks',
    table_perm: 2,
    allow_add_record: true,
    allow_delete_record: true,
    field_perm: {
      任务名称: 3,
      关联项目: 3,
      项目成员: 2,
      任务创建人: 1,
    },
    rec_rule: {
      conditions: [
        { field_name: '项目成员', operator: 'contains', value: [] },
        { field_name: '', operator: 'contains', value: [] },
      ],
      conjunction: 'or',
      other_perm: 0,
    },
    view_perm: 2,
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

test('manager change records use the latest effective change per project', () => {
  const result = latestApplicableManagerChangeByProject([
    { recordId: 'old', projectNo: 'P1', newManagers: [{ id: 'old_manager' }], effectiveAt: 10, createdAt: 10 },
    { recordId: 'future', projectNo: 'P1', newManagers: [{ id: 'future_manager' }], effectiveAt: 30, createdAt: 30 },
    { recordId: 'latest', projectNo: 'P1', newManagers: [{ id: 'latest_manager' }], effectiveAt: 10, createdAt: 20 },
    { recordId: 'missing_manager', projectNo: 'P2', newManagers: [], effectiveAt: 10, createdAt: 20 },
  ], { now: 20 });
  assert.equal(result.get('P1').recordId, 'latest');
  assert.equal(result.has('P2'), false);
});

test('manager change records apply effective changes even when the reason is test text', () => {
  const result = latestApplicableManagerChangeByProject([
    { recordId: 'real', projectNo: 'P1', newManagers: [{ id: 'real_manager' }], effectiveAt: 10, createdAt: 10, changeReason: '管理员正式交接' },
    { recordId: 'test', projectNo: 'P1', newManagers: [{ id: 'test_manager' }], effectiveAt: 20, createdAt: 20, changeReason: '测试' },
  ], { now: 30 });

  assert.equal(result.get('P1').recordId, 'test');
});

test('record rules encode created-user access with the Feishu empty field name', () => {
  const fields = [
    { field_name: '线索负责人', type: 11 },
    { field_name: '创建人', type: 1003 },
    { field_name: '线索状态', type: 3 },
  ];

  const ruleFields = recordRuleFields(fields, ['线索负责人', '创建人', '线索状态']);
  assert.deepEqual(ruleFields, [
    { field_name: '线索负责人', type: 11 },
    { field_name: '', type: 1003 },
  ]);
  assert.deepEqual(buildPersonRecordRule(ruleFields).conditions, [
    { field_name: '线索负责人', operator: 'contains', value: [] },
    { field_name: '', operator: 'contains', value: [] },
  ]);
});

test('roles containing non-dashboard block ids must be rebuilt', () => {
  assert.equal(roleNeedsRebuild({
    block_roles: [{ block_id: 'blk_dashboard' }],
  }), false);
  assert.equal(roleNeedsRebuild({
    block_roles: [
      { block_id: 'blk_dashboard' },
      { block_id: 'ldx_docx_block' },
    ],
  }), true);
});

test('manager change record fills project number and change number from linked project', () => {
  const result = resolveManagerChangeRecordFields({
    recordId: 'rec_change',
    changeNo: '',
    projectNo: '',
    oldManagers: [],
    linkedProjectIds: ['rec_project'],
  }, new Map([
    ['rec_project', { recordId: 'rec_project', projectNo: 'E250101bonnie', currentManagers: [{ id: 'ou_old' }] }],
  ]), { now: Date.UTC(2026, 6, 30) });

  assert.deepEqual(result, {
    项目编号: 'E250101bonnie',
    变更记录编号: '20260730-E250101bonnie-负责人变更',
    原当前负责人: [{ id: 'ou_old' }],
  });
});

test('manager change record links project from project number when no linked project is selected', () => {
  const result = resolveManagerChangeRecordFields({
    recordId: 'rec_change',
    changeNo: '',
    projectNo: 'E250101bonnie',
    linkedProjectIds: [],
  }, new Map(), {
    now: Date.UTC(2026, 6, 30),
    projectByNo: new Map([
      ['E250101bonnie', { recordId: 'rec_project', projectNo: 'E250101bonnie' }],
    ]),
  });

  assert.deepEqual(result, {
    变更记录编号: '20260730-E250101bonnie-负责人变更',
    关联项目: ['rec_project'],
  });
});
