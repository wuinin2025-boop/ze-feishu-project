#!/usr/bin/env node

import assert from 'node:assert/strict';
import { APP_TOKEN } from '../config.mjs';
import { callJson, connectFeishu, searchAll, textValue } from './client.mjs';

const TABLES = {
  overview: 'tblTuTJJDEQK6XcZ',
  tasks: 'tblMqbOebPtzjEdH',
  invoiceProgress: 'tblA4obaIS0jeylo',
  invoiceCollection: 'tblVnpNCeYhtKCD0',
  oldPlan: 'tblOJRhUniTa1yRU',
  people: 'tbl3QvEG2GuGjgPY',
};
const SOURCE_PREFIX = '源_';
const ADMIN_DASHBOARD_BLOCK = 'blkYK9yjNcf3AU1r';
const DATA_SYNC_DOCUMENT_BLOCK = 'ldxYc8pI4kqnBqk2';

function byTable(role) {
  return new Map((role.table_roles || []).map((table) => [table.table_id, table]));
}

function dashboardPermission(role, blockId) {
  return (role.block_roles || []).find((block) => block.block_id === blockId)?.block_perm ?? 0;
}

function rulePersonFields(rule) {
  return (rule?.conditions || []).map((condition) => condition.field_name);
}

async function memberIds(client, roleId) {
  const items = [];
  let pageToken;
  do {
    const data = await callJson(client, 'bitable_v1_appRoleMember_list', {
      path: { app_token: APP_TOKEN, role_id: roleId },
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    items.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return new Set(items.map((item) => item.open_id).filter(Boolean));
}

function peopleValue(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.value) ? value.value : value;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((person) => person?.id ? [person.id] : []);
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'base.v2.appRole.list',
  'bitable.v1.appRoleMember.list',
  'bitable.v1.appTableRecord.search',
]);

try {
  const [tableData, roleData] = await Promise.all([
    callJson(client, 'bitable_v1_appTable_list', {
      path: { app_token: APP_TOKEN },
      params: { page_size: 100 },
    }),
    callJson(client, 'base_v2_appRole_list', {
      path: { app_token: APP_TOKEN },
      params: { page_size: 100 },
    }),
  ]);
  const tables = tableData.items || [];
  const roles = new Map((roleData.items || []).map((role) => [role.role_name, role]));
  const admin = roles.get('管理员');
  const manager = roles.get('项目负责人');
  const employee = roles.get('普通员工');
  assert.ok(admin && manager && employee, '三类权限角色必须存在');

  const adminTables = byTable(admin);
  const managerTables = byTable(manager);
  const employeeTables = byTable(employee);
  for (const table of tables) {
    assert.equal(adminTables.get(table.table_id)?.table_perm, 4, `管理员应可管理 ${table.name}`);
    if (table.name.startsWith(SOURCE_PREFIX)) {
      assert.equal(managerTables.get(table.table_id)?.table_perm ?? 0, 0, `项目负责人不应访问 ${table.name}`);
      assert.equal(employeeTables.get(table.table_id)?.table_perm ?? 0, 0, `普通员工不应访问 ${table.name}`);
    }
  }

  const managerOverview = managerTables.get(TABLES.overview);
  assert.equal(managerOverview.table_perm, 2);
  assert.equal(managerOverview.field_perm?.['当前项目负责人'], 1);
  assert.equal(managerOverview.field_perm?.['项目参与人员'], 3);
  assert.deepEqual(rulePersonFields(managerOverview.rec_rule).sort(), ['交接协同人', '当前项目负责人'].sort());
  const managerInvoiceProgress = managerTables.get(TABLES.invoiceProgress);
  assert.equal(managerInvoiceProgress.table_perm, 1);
  assert.deepEqual(rulePersonFields(managerInvoiceProgress.rec_rule).sort(), ['当前权限负责人', '权限_可管理人员'].sort());
  const managerOldPlan = managerTables.get(TABLES.oldPlan);
  assert.equal(managerOldPlan.field_perm?.['权限_可管理人员'], 1);
  const employeeTasks = employeeTables.get(TABLES.tasks);
  assert.equal(employeeTasks.table_perm, 1);
  assert.deepEqual(rulePersonFields(employeeTasks.rec_rule).sort(), ['任务执行人员', '项目成员'].sort());
  assert.equal(managerTables.get(TABLES.invoiceCollection)?.table_perm ?? 0, 0);
  assert.equal(employeeTables.get(TABLES.invoiceProgress)?.table_perm ?? 0, 0);
  assert.equal(employeeTables.get(TABLES.oldPlan)?.table_perm ?? 0, 0);
  assert.equal(managerTables.get(TABLES.people)?.table_perm ?? 0, 0);
  assert.equal(employeeTables.get(TABLES.people)?.table_perm ?? 0, 0);
  assert.equal(dashboardPermission(admin, ADMIN_DASHBOARD_BLOCK), 1);
  assert.equal(dashboardPermission(manager, ADMIN_DASHBOARD_BLOCK), 0);
  assert.equal(dashboardPermission(employee, ADMIN_DASHBOARD_BLOCK), 0);
  assert.equal(dashboardPermission(manager, DATA_SYNC_DOCUMENT_BLOCK), 0);
  assert.equal(dashboardPermission(employee, DATA_SYNC_DOCUMENT_BLOCK), 0);

  const [people, adminMembers, managerMembers, employeeMembers] = await Promise.all([
    searchAll(client, APP_TOKEN, TABLES.people, ['员工姓名', '飞书用户', '系统身份', '是否在职', '权限角色状态']),
    memberIds(client, admin.role_id),
    memberIds(client, manager.role_id),
    memberIds(client, employee.role_id),
  ]);
  const activeUnsynced = people.filter((row) => (
    textValue(row.fields?.['是否在职']) === '在职'
    && !['已同步', '同步失败'].includes(textValue(row.fields?.['权限角色状态']))
  ));
  const activeSyncFailed = people.filter((row) => (
    textValue(row.fields?.['是否在职']) === '在职'
    && textValue(row.fields?.['权限角色状态']) === '同步失败'
  ));
  const departedWithRoles = people.filter((row) => {
    if (textValue(row.fields?.['是否在职']) !== '离职') return false;
    return peopleValue(row.fields?.['飞书用户']).some((id) => (
      adminMembers.has(id) || managerMembers.has(id) || employeeMembers.has(id)
    ));
  });
  assert.equal(activeUnsynced.length, 0);
  assert.equal(departedWithRoles.length, 0);
  const adminLowerRoleOverlap = [...adminMembers].filter((id) => managerMembers.has(id) || employeeMembers.has(id));
  assert.equal(adminLowerRoleOverlap.length, 0);

  console.log(JSON.stringify({
    pass: true,
    table_count: tables.length,
    manager_can_read_own_invoice_progress: true,
    manager_cannot_edit_project_owner: true,
    employee_finance_perm: 0,
    employee_project_progress_read_only: true,
    admin_lower_role_overlap: adminLowerRoleOverlap.length,
    active_unsynced_people: activeUnsynced.length,
    active_sync_failed_people: activeSyncFailed.length,
    departed_people_with_roles: departedWithRoles.length,
  }, null, 2));
} finally {
  await client.close();
}
