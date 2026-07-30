#!/usr/bin/env node

import { APP_TOKEN, TARGET_TABLE_NAMES } from '../config.mjs';
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
} from '../rules/permission-rules.mjs';
import {
  callFeishuOpenApi,
  callJson,
  connectFeishu,
  searchAll,
  textValue,
} from './client.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const NOW = Date.now();
const TABLES = {
  overview: 'tblTuTJJDEQK6XcZ',
  leads: 'tblpvwmE3OHO0nmC',
  tasks: 'tblMqbOebPtzjEdH',
  invoiceProgress: 'tblA4obaIS0jeylo',
  invoiceCollection: 'tblVnpNCeYhtKCD0',
  oldPlan: 'tblOJRhUniTa1yRU',
  supplierPayments: 'tblrD4ItYQpdlcxd',
  people: 'tbl3QvEG2GuGjgPY',
  managerChanges: 'tblqjuBHdOjt3yWi',
};
const ROLE_NAMES = ['管理员', '项目负责人', '普通员工'];
const SOURCE_PREFIX = '源_';
const PERMISSION_HELPER_FIELD = '权限_可管理人员';
const PROJECT_MEMBERS_FIELD = '项目成员';
const ADMIN_DASHBOARD_BLOCK = 'blkYK9yjNcf3AU1r';
const COLLABORATOR_ACCOUNT_ACTION = '请在飞书高级权限的角色成员选择器中搜索该用户。若搜索不到，请先恢复或邀请该用户的当前组织账号，再重新选择“系统_人员权限表.飞书用户”和项目成员中的当前账号。';
const TASK_EDITABLE_FIELDS = [
  '任务名称',
  '关联项目',
  '任务执行人员',
  '开始时间',
  '结束时间',
  '优先级',
  '预计工时（小时）',
  '实际工时（小时）',
  '实际完成时间',
  '任务状态',
  '风险等级',
  '风险或阻碍',
];
const FIELD_SETTINGS = [
  {
    tableId: TABLES.overview,
    fieldName: '当前项目负责人',
    description: '由系统_负责人变更记录表同步更新。项目可设置多个负责人；需要变更时，请在系统_负责人变更记录表选择关联项目和新当前负责人。',
    multiple: true,
  },
  {
    tableId: TABLES.managerChanges,
    fieldName: '原当前负责人',
    description: '可选多人。记录变更前负责人，通常由管理员按实际情况填写。',
    multiple: true,
  },
  {
    tableId: TABLES.managerChanges,
    fieldName: '新当前负责人',
    description: '可选多人。项目要设置 2 个负责人时，在这里同时选择 2 个人。',
    multiple: true,
  },
  {
    tableId: TABLES.managerChanges,
    fieldName: '项目编号',
    description: '脚本字段。选择关联项目后同步时自动带出，日常录入不用手填。',
  },
  {
    tableId: TABLES.managerChanges,
    fieldName: '关联项目',
    description: '负责人变更的录入入口。请选择要变更负责人的项目。',
  },
];

function peopleValue(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.value) ? value.value : value;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.flatMap((person) => {
    const id = person?.id;
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id }];
  });
}

function peopleIds(value) {
  return peopleValue(value).map((person) => person.id).filter(Boolean).sort();
}

function samePeople(left, right) {
  return JSON.stringify(peopleIds(left)) === JSON.stringify(peopleIds(right));
}

function linkIds(value) {
  if (Array.isArray(value?.link_record_ids)) return value.link_record_ids;
  if (Array.isArray(value)) return value.map((item) => item?.record_id || item).filter(Boolean);
  return [];
}

function fieldMap(fields) {
  return new Map(fields.map((field) => [field.field_name, field]));
}

function existingNames(fields, names) {
  const known = new Set(fields.map((field) => field.field_name));
  return names.filter((name) => known.has(name));
}

function noPermission(table) {
  return { table_id: table.table_id, table_perm: 0 };
}

function optionRules(fields, hidden = []) {
  const hiddenSet = new Set(hidden);
  return Object.fromEntries(fields
    .filter((field) => (field.type === 3 || field.type === 4) && !hiddenSet.has(field.field_name))
    .map((field) => [field.field_name, 0]));
}

function editableRole(tableId, fields, { personRuleFields, editable = [], hidden = [], allowAdd = false, otherPermission = 0 }) {
  return {
    table_id: tableId,
    table_perm: 2,
    allow_add_record: allowAdd,
    allow_delete_record: false,
    field_perm: buildFieldPermissions(fields, {
      editable: existingNames(fields, editable),
      hidden: existingNames(fields, hidden),
    }),
    field_action_rules: { select_option_edit: optionRules(fields, hidden) },
    rec_rule: buildPersonRecordRule(recordRuleFields(fields, personRuleFields), { otherPermission }),
  };
}

function readableRole(tableId, fields, { personRuleFields, hidden = [], fieldPermissions = true }) {
  const role = {
    table_id: tableId,
    table_perm: 1,
    allow_add_record: false,
    allow_delete_record: false,
    rec_rule: buildPersonRecordRule(recordRuleFields(fields, personRuleFields)),
  };
  if (fieldPermissions) role.field_perm = buildFieldPermissions(fields, { hidden: existingNames(fields, hidden) });
  return role;
}

function editableAllRecordsRole(tableId, fields, { editable = [], hidden = [], allowAdd = false }) {
  return {
    table_id: tableId,
    table_perm: 4,
    allow_add_record: allowAdd,
    allow_delete_record: false,
    view_perm: 2,
    field_perm: buildFieldPermissions(fields, {
      editable: existingNames(fields, editable),
      hidden: existingNames(fields, hidden),
    }),
    field_action_rules: { select_option_edit: optionRules(fields, hidden) },
  };
}

async function listTables(client) {
  const items = [];
  let pageToken;
  do {
    const data = await callJson(client, 'bitable_v1_appTable_list', {
      path: { app_token: APP_TOKEN },
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    items.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return items;
}

async function listFields(client, tableId) {
  const data = await callJson(client, 'bitable_v1_appTableField_list', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { page_size: 200 },
  });
  return data.items || [];
}

async function ensureUserField(client, tableId, fieldName) {
  const fields = await listFields(client, tableId);
  if (fields.some((field) => field.field_name === fieldName)) return fields;
  if (DRY_RUN) return fields;
  await callJson(client, 'bitable_v1_appTableField_create', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    data: { field_name: fieldName, type: 11, ui_type: 'User', property: { multiple: true } },
  });
  return listFields(client, tableId);
}

async function ensureCreatedUserField(client, tableId, fieldName) {
  let fields = await listFields(client, tableId);
  if (fields.some((field) => field.field_name === fieldName && field.type === 1003)) return fields;
  if (DRY_RUN) return [...fields, { field_name: fieldName, type: 1003, ui_type: 'CreatedUser' }];
  await callJson(client, 'bitable_v1_appTableField_create', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    data: { field_name: fieldName, type: 1003 },
  });
  fields = await listFields(client, tableId);
  return fields;
}

async function applyFieldSettings(client, fieldsByTable) {
  const planned = [];
  const updated = [];
  const descriptions = [];
  for (const spec of FIELD_SETTINGS) {
    const field = fieldsByTable.get(spec.tableId)?.find((item) => item.field_name === spec.fieldName);
    if (!field) continue;
    const nextProperty = spec.multiple === undefined ? field.property : { ...(field.property || {}), multiple: spec.multiple };
    const propertyChanged = JSON.stringify(field.property || null) !== JSON.stringify(nextProperty || null);
    if (spec.description && (field.description || '') !== spec.description) {
      descriptions.push({ table_id: spec.tableId, field: spec.fieldName, desired: spec.description, current: field.description || '' });
    }
    if (!propertyChanged) continue;
    planned.push({ table_id: spec.tableId, field: spec.fieldName, multiple: spec.multiple });
    if (DRY_RUN) continue;
    await callJson(client, 'bitable_v1_appTableField_update', {
      path: { app_token: APP_TOKEN, table_id: spec.tableId, field_id: field.field_id },
      data: {
        field_name: field.field_name,
        type: field.type,
        ui_type: field.ui_type,
        ...(nextProperty ? { property: nextProperty } : {}),
      },
    });
    field.property = nextProperty;
    updated.push({ table_id: spec.tableId, field: spec.fieldName, multiple: spec.multiple });
  }
  return { planned, updated, descriptions };
}

async function batchUpdate(client, tableId, records) {
  if (DRY_RUN || !records.length) return 0;
  let count = 0;
  for (let index = 0; index < records.length; index += 500) {
    const chunk = records.slice(index, index + 500);
    await callJson(client, 'bitable_v1_appTableRecord_batchUpdate', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      params: { user_id_type: 'open_id' },
      data: { records: chunk },
    });
    count += chunk.length;
  }
  return count;
}

async function createRecords(client, tableId, records) {
  if (DRY_RUN || !records.length) return 0;
  await callJson(client, 'bitable_v1_appTableRecord_batchCreate', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { user_id_type: 'open_id' },
    data: { records: records.map((fields) => ({ fields })) },
  });
  return records.length;
}

async function listRoles(client) {
  const data = await callJson(client, 'base_v2_appRole_list', {
    path: { app_token: APP_TOKEN },
    params: { page_size: 100 },
  });
  const roles = new Map((data.items || []).map((role) => [role.role_name, role]));
  for (const name of ROLE_NAMES) if (!roles.has(name)) throw new Error(`Missing role: ${name}`);
  return roles;
}

async function listCollaborators(client) {
  const data = await callJson(client, 'drive_v1_permissionMember_list', {
    path: { token: APP_TOKEN },
    params: { type: 'bitable', fields: '*' },
  });
  return data.items || [];
}

async function ensureCollaborators(client, people, existingUserIds) {
  const missing = people.filter((person) => (
    person.userId
    && person.employmentStatus === '在职'
    && ['管理员', '项目负责人', '普通员工'].includes(person.identity)
    && !existingUserIds.has(person.userId)
  ));
  const errors = [];
  if (!DRY_RUN) {
    for (const person of missing) {
      try {
        await callJson(client, 'drive_v1_permissionMember_create', {
          path: { token: APP_TOKEN },
          params: { type: 'bitable', need_notification: false },
          data: {
            member_type: 'openid',
            member_id: person.userId,
            perm: 'edit',
            perm_type: 'single_page',
            type: 'user',
          },
        });
        existingUserIds.add(person.userId);
      } catch (error) {
        errors.push({
          userId: person.userId,
          name: person.name,
          message: error.message,
          action_required: COLLABORATOR_ACCOUNT_ACTION,
        });
      }
    }
  }
  return { planned: missing, errors };
}

async function listRoleMembers(client, roleId) {
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
  return items;
}

async function syncRoleMembers(client, roleId, desiredIds) {
  const current = new Set((await listRoleMembers(client, roleId)).map((member) => member.open_id).filter(Boolean));
  const desired = new Set(desiredIds);
  const add = [...desired].filter((id) => !current.has(id));
  const remove = [...current].filter((id) => !desired.has(id));
  const errors = [];
  if (!DRY_RUN) {
    for (const id of add) {
      try {
        await callJson(client, 'bitable_v1_appRoleMember_batchCreate', {
          path: { app_token: APP_TOKEN, role_id: roleId },
          data: { member_list: [{ type: 'open_id', id }] },
        });
      } catch (error) {
        errors.push({ action: 'add', id, message: error.message });
      }
    }
    if (remove.length) {
      for (const id of remove) {
        try {
          await callJson(client, 'bitable_v1_appRoleMember_batchDelete', {
            path: { app_token: APP_TOKEN, role_id: roleId },
            data: { member_list: [{ type: 'open_id', id }] },
          });
        } catch (error) {
          errors.push({ action: 'remove', id, message: error.message });
        }
      }
    }
  }
  return { desired: [...desired], add, remove, errors };
}

function normalizedPeople(rows) {
  return rows.map((row) => {
    const userId = peopleValue(row.fields?.['飞书用户'])[0]?.id || '';
    return {
      recordId: row.record_id,
      userId,
      name: textValue(row.fields?.['员工姓名']),
      identity: textValue(row.fields?.['系统身份']),
      employmentStatus: textValue(row.fields?.['是否在职']),
    };
  });
}

function accessUpdates(rows, projectByRecordId, projectByNo, { includeMembers = false, linkField = '关联项目' } = {}) {
  return rows.flatMap((row) => {
    const project = linkIds(row.fields?.[linkField]).map((id) => projectByRecordId.get(id)).find(Boolean)
      || projectByNo.get(textValue(row.fields?.['项目编号']));
    if (!project) return [];
    const managers = projectManagerPeople({
      managers: peopleValue(project.fields?.['当前项目负责人']),
      handoffs: peopleValue(project.fields?.['交接协同人']),
    });
    const fields = {};
    if (!samePeople(row.fields?.[PERMISSION_HELPER_FIELD], managers)) fields[PERMISSION_HELPER_FIELD] = managers;
    if (includeMembers) {
      const members = projectManagerPeople({
        managers: peopleValue(project.fields?.['当前项目负责人']),
        handoffs: peopleValue(project.fields?.['项目参与人员']),
      });
      if (!samePeople(row.fields?.[PROJECT_MEMBERS_FIELD], members)) fields[PROJECT_MEMBERS_FIELD] = members;
    }
    return Object.keys(fields).length ? [{ record_id: row.record_id, fields }] : [];
  });
}

function normalizeManagerChange(row) {
  const fields = row.fields || {};
  return {
    recordId: row.record_id,
    changeNo: textValue(fields['变更记录编号']),
    projectNo: textValue(fields['项目编号']),
    oldManagers: peopleValue(fields['原当前负责人']),
    newManagers: peopleValue(fields['新当前负责人']),
    effectiveAt: Number(fields['生效日期']) || 0,
    createdAt: Number(fields['创建时间']) || 0,
    changeReason: textValue(fields['变更原因']),
    linkedProjectIds: linkIds(fields['关联项目']),
  };
}

function managerChangeUpdates(changeRows, projectRows) {
  const projectSummaries = projectRows.map((project) => ({
    recordId: project.record_id,
    projectNo: textValue(project.fields?.['项目编号']),
    currentManagers: peopleValue(project.fields?.['当前项目负责人']),
    row: project,
  }));
  const projectByRecordId = new Map(projectSummaries.map((project) => [project.recordId, project]));
  const projectByNo = new Map(projectSummaries
    .map((project) => [project.projectNo, project])
    .filter(([projectNo]) => projectNo));
  const projectUpdates = [];
  const changeRecordUpdates = [];
  const skipped = [];
  const changes = changeRows.map((row) => {
    const change = normalizeManagerChange(row);
    const fields = resolveManagerChangeRecordFields(change, projectByRecordId, { projectByNo, now: NOW });
    if (Object.keys(fields).length) {
      changeRecordUpdates.push({ record_id: change.recordId, fields });
      if (fields['项目编号']) change.projectNo = fields['项目编号'];
      if (fields['变更记录编号']) change.changeNo = fields['变更记录编号'];
      if (fields['关联项目']) change.linkedProjectIds = fields['关联项目'];
    }
    return change;
  });
  const latestByProject = latestApplicableManagerChangeByProject(changes, { now: NOW });

  for (const change of changes.filter((item) => item.projectNo)) {
    const project = projectByNo.get(change.projectNo)?.row;
    if (!project) {
      skipped.push({ record_id: change.recordId, 项目编号: change.projectNo, reason: '项目总览表未找到项目编号' });
      continue;
    }
    if (!change.linkedProjectIds.includes(project.record_id)) {
      changeRecordUpdates.push({ record_id: change.recordId, fields: { 关联项目: [project.record_id] } });
    }
  }

  for (const change of latestByProject.values()) {
    const project = projectByNo.get(change.projectNo)?.row;
    if (!project) continue;

    const fields = {};
    if (!samePeople(project.fields?.['当前项目负责人'], change.newManagers)) {
      fields['当前项目负责人'] = change.newManagers;
      fields['负责人交接状态'] = '正常';
    }
    if (Object.keys(fields).length) projectUpdates.push({ record_id: project.record_id, fields });

  }

  return { projectUpdates, changeRecordUpdates, skipped };
}

function rolePayloads(tables, fieldsByTable) {
  const tableById = new Map(tables.map((table) => [table.table_id, table]));
  const financialHidden = ['记录标题', '源记录键', '数据来源', '源记录ID', '最后同步时间'];
  const managerRoles = new Map([
    [TABLES.overview, editableRole(TABLES.overview, fieldsByTable.get(TABLES.overview), {
      personRuleFields: ['当前项目负责人', '交接协同人'],
      editable: ['项目描述', '项目参与人员'],
      hidden: ['上次当前负责人', '人工确认有效源记录ID', '源记录ID'],
    })],
    [TABLES.leads, buildEditableTableRole(TABLES.leads, fieldsByTable.get(TABLES.leads), {
      personRuleFields: ['线索负责人', '参与人员', '创建人'],
      allowAdd: true,
      allowDelete: true,
      viewPerm: 2,
    })],
    [TABLES.tasks, buildEditableTableRole(TABLES.tasks, fieldsByTable.get(TABLES.tasks), {
      personRuleFields: [PERMISSION_HELPER_FIELD, PROJECT_MEMBERS_FIELD, '任务执行人员', '任务创建人'],
      addable: [PROJECT_MEMBERS_FIELD],
      editable: TASK_EDITABLE_FIELDS,
      allowAdd: true,
      allowDelete: true,
      viewPerm: 2,
    })],
    [TABLES.invoiceProgress, buildEditableTableRole(TABLES.invoiceProgress, fieldsByTable.get(TABLES.invoiceProgress), {
      personRuleFields: [PERMISSION_HELPER_FIELD, '当前权限负责人', '创建人'],
      allowAdd: true,
      allowDelete: true,
      viewPerm: 2,
    })],
    [TABLES.oldPlan, buildEditableTableRole(TABLES.oldPlan, fieldsByTable.get(TABLES.oldPlan), {
      personRuleFields: [PERMISSION_HELPER_FIELD, '补录人'],
      allowAdd: true,
      allowDelete: true,
      viewPerm: 2,
    })],
    [TABLES.supplierPayments, editableRole(TABLES.supplierPayments, fieldsByTable.get(TABLES.supplierPayments), {
      personRuleFields: [PERMISSION_HELPER_FIELD],
      editable: ['预计付款日期', '付款状态', '实际付款日期', '实际付款金额', '付款备注'],
      hidden: ['源付款申请记录ID', '关联付款申请', '关联PO', '数据匹配状态'],
    })],
  ]);
  const employeeRoles = new Map([
    [TABLES.leads, readableRole(TABLES.leads, fieldsByTable.get(TABLES.leads), { personRuleFields: ['参与人员'] })],
    [TABLES.tasks, buildEditableTableRole(TABLES.tasks, fieldsByTable.get(TABLES.tasks), {
      personRuleFields: [PROJECT_MEMBERS_FIELD, '任务执行人员', '任务创建人'],
      addable: [PROJECT_MEMBERS_FIELD],
      editable: TASK_EDITABLE_FIELDS,
      allowAdd: true,
      allowDelete: true,
      viewPerm: 2,
    })],
  ]);
  return {
    admin: {
      role_name: '管理员',
      table_roles: tables.map((table) => ({
        table_id: table.table_id,
        table_perm: 4,
        allow_add_record: true,
        allow_delete_record: true,
        view_perm: 2,
      })),
      block_roles: [{ block_id: ADMIN_DASHBOARD_BLOCK, block_perm: 1 }],
      base_rule: { base_complex_edit: 1, copy: 1 },
    },
    manager: {
      role_name: '项目负责人',
      table_roles: tables.map((table) => (
        table.name.startsWith(SOURCE_PREFIX) || table.table_id === TABLES.people || table.table_id === TABLES.invoiceCollection
          ? noPermission(table)
          : managerRoles.get(table.table_id) || noPermission(table)
      )),
      block_roles: [
        { block_id: ADMIN_DASHBOARD_BLOCK, block_perm: 0 },
      ],
      base_rule: { base_complex_edit: 0, copy: 0 },
    },
    employee: {
      role_name: '普通员工',
      table_roles: tables.map((table) => employeeRoles.get(table.table_id) || noPermission(table)),
      block_roles: [
        { block_id: ADMIN_DASHBOARD_BLOCK, block_perm: 0 },
      ],
      base_rule: { base_complex_edit: 0, copy: 0 },
    },
    tableById,
    financialHidden,
  };
}

async function updateRole(client, role, data) {
  if (DRY_RUN) return role;
  if (roleNeedsRebuild(role)) {
    const currentRoles = await callJson(client, 'base_v2_appRole_list', {
      path: { app_token: APP_TOKEN },
      params: { page_size: 100 },
    });
    const reusableReplacement = (currentRoles.items || []).find((candidate) => (
      candidate.role_name.startsWith(`${data.role_name}-权限修复-`)
      && !roleNeedsRebuild(candidate)
    ));
    let replacementRoleId = reusableReplacement?.role_id;
    if (!replacementRoleId) {
      const temporaryName = `${data.role_name}-权限修复-${Date.now()}`;
      const created = await callFeishuOpenApi(`/base/v2/apps/${APP_TOKEN}/roles`, {
        method: 'POST',
        data: { ...data, role_name: temporaryName },
      });
      replacementRoleId = created.data?.role?.role_id || created.data?.role_id;
    }
    if (!replacementRoleId) throw new Error(`Replacement role for ${data.role_name} was created without role_id`);

    await callFeishuOpenApi(`/bitable/v1/apps/${APP_TOKEN}/roles/${role.role_id}`, { method: 'DELETE' });
    await callJson(client, 'base_v2_appRole_update', {
      path: { app_token: APP_TOKEN, role_id: replacementRoleId },
      data,
    });
    return {
      ...role,
      ...data,
      role_id: replacementRoleId,
      role_name: data.role_name,
    };
  }

  await callJson(client, 'base_v2_appRole_update', {
    path: { app_token: APP_TOKEN, role_id: role.role_id },
    data,
  });
  return { ...role, ...data };
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableField.create',
  'bitable.v1.appTableField.update',
  'bitable.v1.appTableRecord.search',
  'bitable.v1.appTableRecord.batchCreate',
  'bitable.v1.appTableRecord.batchUpdate',
  'base.v2.appRole.list',
  'base.v2.appRole.update',
  'bitable.v1.appRoleMember.list',
  'bitable.v1.appRoleMember.batchCreate',
  'bitable.v1.appRoleMember.batchDelete',
  'drive.v1.permissionMember.list',
  'drive.v1.permissionMember.create',
]);

try {
  const tables = await listTables(client);
  const fieldsByTable = new Map();
  for (const table of tables) fieldsByTable.set(table.table_id, await listFields(client, table.table_id));
  fieldsByTable.set(TABLES.leads, await ensureUserField(client, TABLES.leads, PERMISSION_HELPER_FIELD));
  fieldsByTable.set(TABLES.tasks, await ensureUserField(client, TABLES.tasks, PERMISSION_HELPER_FIELD));
  fieldsByTable.set(TABLES.tasks, await ensureUserField(client, TABLES.tasks, PROJECT_MEMBERS_FIELD));
  fieldsByTable.set(TABLES.invoiceProgress, await ensureUserField(client, TABLES.invoiceProgress, PERMISSION_HELPER_FIELD));
  fieldsByTable.set(TABLES.invoiceProgress, await ensureCreatedUserField(client, TABLES.invoiceProgress, '创建人'));
  fieldsByTable.set(TABLES.oldPlan, await ensureUserField(client, TABLES.oldPlan, PERMISSION_HELPER_FIELD));
  fieldsByTable.set(TABLES.supplierPayments, await ensureUserField(client, TABLES.supplierPayments, PERMISSION_HELPER_FIELD));
  const fieldSettings = await applyFieldSettings(client, fieldsByTable);

  const [peopleRows, projectRows, managerChangeRows, leadRows, taskRows, oldPlanRows, supplierRows] = await Promise.all([
    searchAll(client, APP_TOKEN, TABLES.people, ['员工姓名', '飞书用户', '系统身份', '是否在职', '权限角色状态']),
    searchAll(client, APP_TOKEN, TABLES.overview, ['项目编号', '当前项目负责人', '交接协同人', '项目参与人员', '负责人交接状态']),
    searchAll(client, APP_TOKEN, TABLES.managerChanges, ['变更记录编号', '项目编号', '原当前负责人', '新当前负责人', '生效日期', '创建时间', '变更原因', '关联项目']),
    searchAll(client, APP_TOKEN, TABLES.leads, existingNames(fieldsByTable.get(TABLES.leads), ['关联正式项目', PERMISSION_HELPER_FIELD])),
    searchAll(client, APP_TOKEN, TABLES.tasks, ['关联项目', '项目编号', PERMISSION_HELPER_FIELD, PROJECT_MEMBERS_FIELD]),
    searchAll(client, APP_TOKEN, TABLES.oldPlan, ['关联项目', '项目编号', PERMISSION_HELPER_FIELD]),
    searchAll(client, APP_TOKEN, TABLES.supplierPayments, ['关联项目', '项目编号', PERMISSION_HELPER_FIELD]),
  ]);
  const people = normalizedPeople(peopleRows);
  const peopleById = new Map(people.map((person) => [person.userId, person]).filter(([id]) => id));
  const collaborators = await listCollaborators(client);
  const collaboratorUserIds = new Set(collaborators
    .filter((member) => member.member_type === 'openid')
    .map((member) => member.member_id)
    .filter(Boolean));
  const fullAccessUserIds = new Set(collaborators
    .filter((member) => member.member_type === 'openid' && member.perm === 'full_access')
    .map((member) => member.member_id)
    .filter(Boolean));
  const collaboratorSync = await ensureCollaborators(client, people, collaboratorUserIds);

  const explicitManagerChanges = managerChangeUpdates(managerChangeRows, projectRows);
  const managerChangeProjectUpdated = await batchUpdate(client, TABLES.overview, explicitManagerChanges.projectUpdates);
  const managerChangeRecordUpdated = await batchUpdate(client, TABLES.managerChanges, explicitManagerChanges.changeRecordUpdates);
  const projectRowsAfterExplicitChanges = explicitManagerChanges.projectUpdates.length && !DRY_RUN
    ? await searchAll(client, APP_TOKEN, TABLES.overview, ['项目编号', '当前项目负责人', '交接协同人', '项目参与人员', '负责人交接状态'])
    : projectRows.map((project) => {
      const update = explicitManagerChanges.projectUpdates.find((item) => item.record_id === project.record_id);
      return update ? { ...project, fields: { ...project.fields, ...update.fields } } : project;
    });

  const handoffUpdates = [];
  const handoffLogs = [];
  for (const project of projectRowsAfterExplicitChanges) {
    const handoff = departedManagerHandoff({
      managers: peopleValue(project.fields?.['当前项目负责人']),
      handoffs: peopleValue(project.fields?.['交接协同人']),
      peopleById,
    });
    if (handoff.action === 'none') continue;
    const fields = { '负责人交接状态': handoff.action === 'replace_with_handoff' ? '正常' : '待交接' };
    if (handoff.action === 'replace_with_handoff') fields['当前项目负责人'] = handoff.newManagers;
    handoffUpdates.push({ record_id: project.record_id, fields });
    if (handoff.action === 'replace_with_handoff') {
      handoffLogs.push({
        变更记录编号: `permission-sync-${Date.now()}-${project.record_id}`,
        项目编号: textValue(project.fields?.['项目编号']),
        原当前负责人: peopleValue(project.fields?.['当前项目负责人']),
        新当前负责人: handoff.newManagers,
        生效日期: Date.now(),
        变更原因: handoff.reason,
        关联项目: [project.record_id],
      });
    }
  }
  const handoffUpdated = await batchUpdate(client, TABLES.overview, handoffUpdates);
  const handoffLogCreated = await createRecords(client, TABLES.managerChanges, handoffLogs);

  const refreshedProjects = handoffUpdates.length && !DRY_RUN
    ? await searchAll(client, APP_TOKEN, TABLES.overview, ['项目编号', '当前项目负责人', '交接协同人', '项目参与人员'])
    : projectRowsAfterExplicitChanges.map((project) => {
      const update = handoffUpdates.find((item) => item.record_id === project.record_id);
      return update ? { ...project, fields: { ...project.fields, ...update.fields } } : project;
    });
  const projectByRecordId = new Map(refreshedProjects.map((project) => [project.record_id, project]));
  const projectByNo = new Map(refreshedProjects.map((project) => [textValue(project.fields?.['项目编号']), project]).filter(([key]) => key));
  const helperUpdates = {
    leads: accessUpdates(leadRows, projectByRecordId, projectByNo, { linkField: '关联正式项目' }),
    tasks: accessUpdates(taskRows, projectByRecordId, projectByNo, { includeMembers: true }),
    oldPlan: accessUpdates(oldPlanRows, projectByRecordId, projectByNo),
    supplierPayments: accessUpdates(supplierRows, projectByRecordId, projectByNo),
  };
  const helperUpdated = {
    leads: await batchUpdate(client, TABLES.leads, helperUpdates.leads),
    tasks: await batchUpdate(client, TABLES.tasks, helperUpdates.tasks),
    oldPlan: await batchUpdate(client, TABLES.oldPlan, helperUpdates.oldPlan),
    supplierPayments: await batchUpdate(client, TABLES.supplierPayments, helperUpdates.supplierPayments),
  };

  const roles = await listRoles(client);
  const payloads = rolePayloads(tables, fieldsByTable);
  roles.set('管理员', await updateRole(client, roles.get('管理员'), payloads.admin));
  roles.set('项目负责人', await updateRole(client, roles.get('项目负责人'), payloads.manager));
  roles.set('普通员工', await updateRole(client, roles.get('普通员工'), payloads.employee));

  const memberships = desiredRoleMemberships(people, { fullAccessUserIds });
  const memberSync = {
    admin: await syncRoleMembers(client, roles.get('管理员').role_id, memberships.admin),
    manager: await syncRoleMembers(client, roles.get('项目负责人').role_id, memberships.manager),
    employee: await syncRoleMembers(client, roles.get('普通员工').role_id, memberships.employee),
  };
  const failedMemberIds = new Set([
    ...Object.values(memberSync).flatMap((sync) => sync.errors.map((error) => error.id)),
    ...collaboratorSync.errors.map((error) => error.userId),
  ]);
  const finalMemberships = DRY_RUN
    ? {
      管理员: memberships.admin,
      项目负责人: memberships.manager,
      普通员工: memberships.employee,
    }
    : {
      管理员: new Set([
        ...(await listRoleMembers(client, roles.get('管理员').role_id)).map((member) => member.open_id).filter(Boolean),
        ...fullAccessUserIds,
      ]),
      项目负责人: new Set((await listRoleMembers(client, roles.get('项目负责人').role_id)).map((member) => member.open_id).filter(Boolean)),
      普通员工: new Set((await listRoleMembers(client, roles.get('普通员工').role_id)).map((member) => member.open_id).filter(Boolean)),
    };
  if (DRY_RUN) {
    for (const userId of fullAccessUserIds) finalMemberships.管理员.add(userId);
  }
  const peopleStatusUpdates = peopleRows.map((row) => {
    const userId = peopleValue(row.fields?.['飞书用户'])[0]?.id || '';
    return {
      record_id: row.record_id,
      fields: {
        权限角色状态: derivePermissionRoleStatus({
          employmentStatus: textValue(row.fields?.['是否在职']),
          identity: textValue(row.fields?.['系统身份']),
          userId,
          roleMemberships: finalMemberships,
          syncFailed: failedMemberIds.has(userId),
        }),
      },
    };
  });
  const peopleStatusUpdated = await batchUpdate(client, TABLES.people, peopleStatusUpdates);
  const roleMemberErrorCount = Object.values(memberSync).reduce((sum, sync) => sum + sync.errors.length, 0);
  const syncErrorCount = roleMemberErrorCount + collaboratorSync.errors.length;

  console.log(JSON.stringify({
    dry_run: DRY_RUN,
    ok: syncErrorCount === 0,
    tables: tables.length,
    field_settings: {
      planned: fieldSettings.planned,
      updated: fieldSettings.updated,
      descriptions_need_manual_update: fieldSettings.descriptions,
    },
    manager_changes: {
      records: managerChangeRows.length,
      project_updates_planned: explicitManagerChanges.projectUpdates.length,
      project_updates_written: managerChangeProjectUpdated,
      link_updates_planned: explicitManagerChanges.changeRecordUpdates.length,
      link_updates_written: managerChangeRecordUpdated,
      skipped: explicitManagerChanges.skipped,
      samples: explicitManagerChanges.projectUpdates.slice(0, 10).map((update) => {
        const project = projectRows.find((row) => row.record_id === update.record_id);
        return {
          项目编号: textValue(project?.fields?.['项目编号']),
          新负责人: peopleValue(update.fields['当前项目负责人']).map((person) => person.id),
          负责人交接状态: update.fields['负责人交接状态'],
        };
      }),
    },
    handoff: {
      planned: handoffUpdates.length,
      updated: handoffUpdated,
      logs_created: handoffLogCreated,
      samples: handoffUpdates.slice(0, 10).map((update) => {
        const project = projectRows.find((row) => row.record_id === update.record_id);
        return {
          项目编号: textValue(project?.fields?.['项目编号']),
          原负责人: peopleValue(project?.fields?.['当前项目负责人']).map((person) => person.id),
          交接协同人: peopleValue(project?.fields?.['交接协同人']).map((person) => person.id),
          新负责人: peopleValue(update.fields['当前项目负责人']).map((person) => person.id),
          负责人交接状态: update.fields['负责人交接状态'],
        };
      }),
    },
    helper_updates: {
      planned: Object.fromEntries(Object.entries(helperUpdates).map(([key, rows]) => [key, rows.length])),
      updated: helperUpdated,
    },
    role_members: {
      desired_counts: {
        admin: memberships.admin.size,
        manager: memberships.manager.size,
        employee: memberships.employee.size,
      },
      changes: Object.fromEntries(Object.entries(memberSync).map(([key, value]) => [key, {
        add: value.add.length,
        remove: value.remove.length,
        errors: value.errors.length,
      }])),
      errors: Object.fromEntries(Object.entries(memberSync).map(([key, value]) => [key, value.errors.map((error) => ({
        action: error.action,
        user_id: error.id,
        message: error.message,
      }))])),
    },
    collaborators: {
      existing: collaborators.length,
      add_planned: collaboratorSync.planned.length,
      add_failed: collaboratorSync.errors,
    },
    people_role_status_updated: peopleStatusUpdated,
    protected: {
      source_tables: tables.filter((table) => table.name.startsWith(SOURCE_PREFIX)).length,
      invoice_collection_hidden_from_manager: true,
      manager_cannot_edit_project_owner: true,
      data_sync_document_manager_perm: 0,
    },
  }, null, 2));
  if (!DRY_RUN && syncErrorCount) process.exitCode = 1;
} finally {
  await client.close();
}
