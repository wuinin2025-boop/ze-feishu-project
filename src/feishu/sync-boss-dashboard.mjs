#!/usr/bin/env node

import { APP_TOKEN, TARGET_TABLE_NAMES } from '../config.mjs';
import {
  callJson,
  connectFeishu,
  numberValue,
  searchAll,
  textValue,
} from './client.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const TABLE_NAME = '逾期回款项目明细表';
const NOW = Date.now();
const FIELDS = [
  { name: '记录标题', type: 1, uiType: 'Text' },
  { name: '项目编号', type: 1, uiType: 'Text' },
  { name: '项目名称', type: 1, uiType: 'Text' },
  { name: '项目负责人', type: 11, uiType: 'User', property: { multiple: true } },
  { name: '最长逾期天数', type: 2, uiType: 'Number' },
  { name: '逾期回款金额', type: 2, uiType: 'Number', property: { formatter: '0.00' } },
  { name: '未回款金额', type: 2, uiType: 'Number', property: { formatter: '0.00' } },
  { name: '最近预计回款日期', type: 5, uiType: 'DateTime' },
  { name: '逾期期次', type: 1, uiType: 'Text' },
  { name: '处理提示', type: 1, uiType: 'Text' },
  { name: '最后同步时间', type: 5, uiType: 'DateTime' },
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

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function minDate(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Math.min(left, right);
}

function keyOf(row) {
  return textValue(row.fields?.['项目编号']) || textValue(row.fields?.['项目名称']) || row.record_id;
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

async function ensureTable(client) {
  const tables = await listTables(client);
  const existing = tables.find((table) => table.name === TABLE_NAME);
  if (existing || DRY_RUN) return existing || { name: TABLE_NAME, table_id: `dry:${TABLE_NAME}` };
  const data = await callJson(client, 'bitable_v1_appTable_create', {
    path: { app_token: APP_TOKEN },
    data: { table: { name: TABLE_NAME } },
  });
  return data.table || (await listTables(client)).find((table) => table.name === TABLE_NAME);
}

async function listFields(client, tableId) {
  if (DRY_RUN && tableId.startsWith('dry:')) return [];
  const data = await callJson(client, 'bitable_v1_appTableField_list', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { page_size: 200 },
  });
  return data.items || [];
}

async function ensureFields(client, tableId) {
  const fields = await listFields(client, tableId);
  const existing = new Set(fields.map((field) => field.field_name));
  const created = [];
  for (const spec of FIELDS) {
    if (existing.has(spec.name)) continue;
    created.push(spec.name);
    if (DRY_RUN) continue;
    await callJson(client, 'bitable_v1_appTableField_create', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      data: {
        field_name: spec.name,
        type: spec.type,
        ui_type: spec.uiType,
        ...(spec.property ? { property: spec.property } : {}),
      },
    });
  }
  return created;
}

async function tableIdByName(client, name) {
  const table = (await listTables(client)).find((item) => item.name === name);
  if (!table) throw new Error(`Target table not found: ${name}`);
  return table.table_id;
}

function buildRows(progressRows) {
  const grouped = new Map();
  for (const row of progressRows) {
    const fields = row.fields || {};
    const overdueAmount = numberValue(fields['回款逾期金额']) || (
      textValue(fields['回款状态']) === '回款逾期' ? numberValue(fields['未回款金额']) || 0 : 0
    );
    const overdueDays = numberValue(fields['回款逾期天数']) || 0;
    if (overdueAmount <= 0 && overdueDays <= 0) continue;
    const key = keyOf(row);
    const entry = grouped.get(key) || {
      projectNo: textValue(fields['项目编号']),
      projectName: textValue(fields['项目名称']),
      managers: peopleValue(fields['当前权限负责人']),
      maxDays: 0,
      overdueAmount: 0,
      unpaidAmount: 0,
      nearestExpectedDate: undefined,
      periods: [],
    };
    entry.maxDays = Math.max(entry.maxDays, overdueDays);
    entry.overdueAmount = roundMoney(entry.overdueAmount + overdueAmount);
    entry.unpaidAmount = roundMoney(entry.unpaidAmount + (numberValue(fields['未回款金额']) || 0));
    entry.nearestExpectedDate = minDate(entry.nearestExpectedDate, numberValue(fields['预计回款日期']));
    const period = textValue(fields['当前执行期次']);
    if (period && !entry.periods.includes(period)) entry.periods.push(period);
    if (!entry.managers.length) entry.managers = peopleValue(fields['当前权限负责人']);
    grouped.set(key, entry);
  }

  return [...grouped.values()]
    .sort((left, right) => right.overdueAmount - left.overdueAmount || right.maxDays - left.maxDays)
    .map((entry) => ({
      记录标题: entry.projectNo || entry.projectName,
      项目编号: entry.projectNo,
      项目名称: entry.projectName,
      项目负责人: entry.managers,
      最长逾期天数: entry.maxDays,
      逾期回款金额: entry.overdueAmount,
      未回款金额: entry.unpaidAmount,
      最近预计回款日期: entry.nearestExpectedDate,
      逾期期次: entry.periods.join('、'),
      处理提示: `${entry.projectNo || entry.projectName} 回款逾期 ${entry.maxDays} 天，逾期金额 ${entry.overdueAmount.toFixed(2)}，请负责人跟进回款。`,
      最后同步时间: NOW,
    }));
}

async function batchCreate(client, tableId, rows) {
  if (DRY_RUN || !rows.length) return 0;
  await callJson(client, 'bitable_v1_appTableRecord_batchCreate', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { user_id_type: 'open_id' },
    data: { records: rows.map((fields) => ({ fields })) },
  });
  return rows.length;
}

async function batchUpdate(client, tableId, rows) {
  if (DRY_RUN || !rows.length) return 0;
  await callJson(client, 'bitable_v1_appTableRecord_batchUpdate', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { user_id_type: 'open_id' },
    data: { records: rows },
  });
  return rows.length;
}

async function batchDelete(client, tableId, recordIds) {
  if (DRY_RUN || !recordIds.length) return 0;
  await callJson(client, 'bitable_v1_appTableRecord_batchDelete', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    data: { records: recordIds },
  });
  return recordIds.length;
}

async function upsertRows(client, tableId, rows) {
  if (DRY_RUN && tableId.startsWith('dry:')) {
    return { planned: rows.length, created: rows.length, updated: 0, deleted: 0 };
  }
  const existing = await searchAll(client, APP_TOKEN, tableId, ['记录标题']);
  const existingByTitle = new Map(existing.map((row) => [textValue(row.fields?.['记录标题']), row.record_id]).filter(([key]) => key));
  const desiredTitles = new Set(rows.map((row) => row['记录标题']).filter(Boolean));
  const creates = [];
  const updates = [];
  for (const row of rows) {
    const title = row['记录标题'];
    const recordId = existingByTitle.get(title);
    if (recordId) updates.push({ record_id: recordId, fields: row });
    else creates.push(row);
  }
  const deletes = [...existingByTitle].flatMap(([title, recordId]) => desiredTitles.has(title) ? [] : [recordId]);
  return {
    planned: rows.length,
    created: await batchCreate(client, tableId, creates),
    updated: await batchUpdate(client, tableId, updates),
    deleted: await batchDelete(client, tableId, deletes),
  };
}

async function ensureViews(client, tableId, fields) {
  if (DRY_RUN) return [];
  const data = await callJson(client, 'bitable_v1_appTableView_list', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { page_size: 100 },
  });
  const existing = new Set((data.items || []).map((view) => view.view_name));
  const created = [];
  for (const name of ['老板看逾期回款', '按负责人查看']) {
    if (existing.has(name)) continue;
    await callJson(client, 'bitable_v1_appTableView_create', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      data: { view_name: name, view_type: 'grid' },
    });
    created.push(name);
  }
  return created;
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTable.create',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableField.create',
  'bitable.v1.appTableView.list',
  'bitable.v1.appTableView.create',
  'bitable.v1.appTableRecord.search',
  'bitable.v1.appTableRecord.batchCreate',
  'bitable.v1.appTableRecord.batchUpdate',
  'bitable.v1.appTableRecord.batchDelete',
]);

try {
  const table = await ensureTable(client);
  const createdFields = await ensureFields(client, table.table_id);
  const progressTableId = await tableIdByName(client, TARGET_TABLE_NAMES.invoiceProgressTrial);
  const progressRows = await searchAll(client, APP_TOKEN, progressTableId, [
    '项目编号',
    '项目名称',
    '当前权限负责人',
    '当前执行期次',
    '预计回款日期',
    '回款状态',
    '未回款金额',
    '回款逾期天数',
    '回款逾期金额',
  ]);
  const rows = buildRows(progressRows);
  const result = await upsertRows(client, table.table_id, rows);
  const createdViews = await ensureViews(client, table.table_id, await listFields(client, table.table_id));
  console.log(JSON.stringify({
    dry_run: DRY_RUN,
    table: { name: TABLE_NAME, id: table.table_id },
    fields_created: createdFields,
    views_created: createdViews,
    overdue_projects: rows.length,
    upsert: result,
    samples: rows.slice(0, 10).map((row) => ({
      项目编号: row.项目编号,
      项目名称: row.项目名称,
      最长逾期天数: row.最长逾期天数,
      逾期回款金额: row.逾期回款金额,
      逾期期次: row.逾期期次,
      处理提示: row.处理提示,
    })),
  }, null, 2));
} finally {
  await client.close();
}
