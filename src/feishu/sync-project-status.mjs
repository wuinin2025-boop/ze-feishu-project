#!/usr/bin/env node

import {
  APP_TOKEN,
  TARGET_TABLE_NAMES,
} from '../config.mjs';
import {
  deriveProjectStatus,
  listValue,
  projectHasBusinessActivity,
} from '../rules/project-status-rules.mjs';
import {
  callJson,
  connectFeishu,
  numberValue,
  searchAll,
  textValue,
} from './client.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const STATUS_OPTIONS = [
  { name: '未开始', color: 0 },
  { name: '进行中', color: 1 },
  { name: '暂停', color: 2 },
  { name: '结算中', color: 3 },
  { name: '已完成', color: 20 },
];

const OVERVIEW_FIELDS = [
  '项目编号',
  '项目名称',
  '项目阶段',
  '项目状态',
  '系统项目状态',
  '开票状态',
  '客户收款状态',
  '立项金额',
  '结算金额',
  'PO金额',
  '已开票金额',
  '已收款金额',
  '付款申请审批中金额',
  '待财务处理金额',
  '供应商待付款金额',
  '累计实际付款金额',
  '关联应收',
];

function assertTargetTableName(tableName) {
  if (tableName.startsWith('源_')) {
    throw new Error(`Refusing to write source table: ${tableName}`);
  }
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

async function tableIdByName(client, name) {
  const tables = await listTables(client);
  const table = tables.find((item) => item.name === name);
  if (!table) throw new Error(`Target table not found: ${name}`);
  return table.table_id;
}

async function listFields(client, tableId) {
  const data = await callJson(client, 'bitable_v1_appTableField_list', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { page_size: 200 },
  });
  return data.items || [];
}

async function ensureStatusOptions(client, tableId, fields, fieldName, report) {
  const field = fields.find((item) => item.field_name === fieldName);
  if (!field) throw new Error(`Field not found: ${fieldName}`);
  const existing = field.property?.options || [];
  const existingNames = new Set(existing.map((option) => option.name));
  const missing = STATUS_OPTIONS.filter((option) => !existingNames.has(option.name));
  if (!missing.length) return;
  report.options_updated.push({ field: fieldName, added: missing.map((option) => option.name) });
  if (DRY_RUN) return;
  await callJson(client, 'bitable_v1_appTableField_update', {
    path: { app_token: APP_TOKEN, table_id: tableId, field_id: field.field_id },
    data: {
      field_name: field.field_name,
      type: field.type,
      ui_type: field.ui_type,
      property: { options: [...existing, ...missing] },
    },
  });
}

function linkRecordCount(value) {
  if (Array.isArray(value?.link_record_ids)) return value.link_record_ids.length;
  if (Array.isArray(value)) return value.length;
  return 0;
}

function desiredStatus(fields) {
  const sourceStages = listValue(fields['项目阶段']);
  const invoiceStatus = textValue(fields['开票状态']);
  const collectionStatus = textValue(fields['客户收款状态']);
  const hasActivity = projectHasBusinessActivity({
    sourceStages,
    invoiceStatus,
    collectionStatus,
    linkedReceivableCount: linkRecordCount(fields['关联应收']),
    amounts: {
      establishment: numberValue(fields['立项金额']),
      settlement: numberValue(fields['结算金额']),
      po: numberValue(fields['PO金额']),
      invoiced: numberValue(fields['已开票金额']),
      received: numberValue(fields['已收款金额']),
      pendingPayment: numberValue(fields['付款申请审批中金额']),
      financePending: numberValue(fields['待财务处理金额']),
      supplierPending: numberValue(fields['供应商待付款金额']),
      actualPaid: numberValue(fields['累计实际付款金额']),
    },
  });
  return deriveProjectStatus({
    sourceStages,
    currentStatus: textValue(fields['项目状态']),
    invoiceStatus,
    collectionStatus,
    hasActivity,
  });
}

function existingFieldNames(fields) {
  const names = new Set(fields.map((field) => field.field_name));
  return OVERVIEW_FIELDS.filter((fieldName) => names.has(fieldName));
}

async function batchUpdate(client, tableName, tableId, updates) {
  assertTargetTableName(tableName);
  if (DRY_RUN || !updates.length) return 0;
  let count = 0;
  for (let index = 0; index < updates.length; index += 500) {
    const chunk = updates.slice(index, index + 500);
    await callJson(client, 'bitable_v1_appTableRecord_batchUpdate', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      data: { records: chunk },
    });
    count += chunk.length;
  }
  return count;
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableField.update',
  'bitable.v1.appTableRecord.search',
  'bitable.v1.appTableRecord.batchUpdate',
]);

try {
  const tableName = TARGET_TABLE_NAMES.projectOverview;
  const tableId = await tableIdByName(client, tableName);
  const report = {
    dry_run: DRY_RUN,
    processed: 0,
    changed: 0,
    written: 0,
    options_updated: [],
    by_status: {},
    samples: [],
  };
  const fields = await listFields(client, tableId);
  await ensureStatusOptions(client, tableId, fields, '项目状态', report);
  await ensureStatusOptions(client, tableId, fields, '系统项目状态', report);

  const rows = await searchAll(client, APP_TOKEN, tableId, existingFieldNames(fields));
  const updates = [];
  for (const row of rows) {
    const fieldsData = row.fields || {};
    const nextStatus = desiredStatus(fieldsData);
    report.processed += 1;
    report.by_status[nextStatus] = (report.by_status[nextStatus] || 0) + 1;
    const currentProjectStatus = textValue(fieldsData['项目状态']);
    const currentSystemStatus = textValue(fieldsData['系统项目状态']);
    if (currentProjectStatus === nextStatus && currentSystemStatus === nextStatus) continue;
    updates.push({
      record_id: row.record_id,
      fields: {
        '项目状态': nextStatus,
        '系统项目状态': nextStatus,
      },
    });
    if (report.samples.length < 12) {
      report.samples.push({
        项目编号: textValue(fieldsData['项目编号']),
        项目名称: textValue(fieldsData['项目名称']),
        原项目状态: currentProjectStatus,
        原系统项目状态: currentSystemStatus,
        新状态: nextStatus,
        开票状态: textValue(fieldsData['开票状态']),
        客户收款状态: textValue(fieldsData['客户收款状态']),
        项目阶段: listValue(fieldsData['项目阶段']),
      });
    }
  }

  report.changed = updates.length;
  report.written = await batchUpdate(client, tableName, tableId, updates);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
