#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import {
  APP_TOKEN,
  TARGET_TABLE_NAMES,
} from '../config.mjs';
import {
  callJson,
  connectFeishu,
} from './client.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

const FIELD_TYPES = {
  text: 1,
  number: 2,
  singleSelect: 3,
  date: 5,
  singleLink: 18,
  formula: 20,
};

const CATEGORY_OPTIONS = [
  { name: '经营项目', color: 20 },
  { name: '行政/内部项目', color: 44 },
  { name: '走账项目', color: 1 },
];

const YES_NO_OPTIONS = [
  { name: '是', color: 20 },
  { name: '否', color: 44 },
];

const PLAN_STATUS_OPTIONS = [
  { name: '待匹配', color: 1 },
  { name: '部分匹配', color: 4 },
  { name: '已匹配', color: 20 },
  { name: '金额异常待确认', color: 44 },
];

const INVOICE_MATCH_OPTIONS = [
  { name: '自动匹配', color: 20 },
  { name: '未匹配项目', color: 44 },
  { name: '计划外开票', color: 1 },
  { name: '已抵消', color: 2 },
  { name: '红冲待确认', color: 44 },
];

const INVOICE_STATUS_OPTIONS = [
  { name: '待人工补充', color: 1 },
  { name: '已开票', color: 20 },
  { name: '部分开票', color: 4 },
  { name: '即将到期开票', color: 5 },
  { name: '开票逾期', color: 44 },
  { name: '未到期', color: 6 },
];

const PAYMENT_STATUS_OPTIONS = [
  { name: '待开票', color: 1 },
  { name: '已回款', color: 20 },
  { name: '回款逾期', color: 44 },
  { name: '部分回款', color: 4 },
  { name: '待回款', color: 5 },
  { name: '待补预计回款日期', color: 6 },
];

function field(fieldName, type, property = {}, description = '') {
  return {
    field_name: fieldName,
    type,
    ...(Object.keys(property).length ? { property } : {}),
    ...(description ? { description: { text: description } } : {}),
  };
}

function text(fieldName, description = '') {
  return field(fieldName, FIELD_TYPES.text, {}, description);
}

function number(fieldName, description = '') {
  return field(fieldName, FIELD_TYPES.number, { formatter: '0.00' }, description);
}

function date(fieldName, description = '') {
  return field(fieldName, FIELD_TYPES.date, { date_formatter: 'yyyy/MM/dd' }, description);
}

function select(fieldName, options, description = '') {
  return field(fieldName, FIELD_TYPES.singleSelect, { options }, description);
}

function singleLink(fieldName, tableId, description = '', multiple = false) {
  return field(fieldName, FIELD_TYPES.singleLink, { table_id: tableId, multiple }, description);
}

function formula(fieldName, formulaExpression, dataType = 1, description = '') {
  return field(fieldName, FIELD_TYPES.formula, {
    formula_expression: formulaExpression,
    type: { data_type: dataType },
  }, description);
}

function linkLookupExpression({ tableId, linkFieldId, targetFieldId, combine = 'ARRAYJOIN(",")' }) {
  return `bitable::$table[${tableId}].$field[${linkFieldId}].$column[${targetFieldId}].${combine}`;
}

function bossDashboardGroupExpression(tableId, categoryFieldId) {
  const fieldRef = `bitable::$table[${tableId}].$field[${categoryFieldId}]`;
  return `IF(${fieldRef}="经营项目","经营项目总览",IF(${fieldRef}="走账项目","走账项目总览",IF(${fieldRef}="行政/内部项目","不纳入","项目分类待确认")))`;
}

function assertWritableTableName(tableName) {
  if (tableName.startsWith('源_') || tableName === TARGET_TABLE_NAMES.oldProjectPlan) {
    throw new Error(`Refusing to write protected table: ${tableName}`);
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

async function listFields(client, tableId) {
  const items = [];
  let pageToken;
  do {
    const data = await callJson(client, 'bitable_v1_appTableField_list', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    items.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return items;
}

async function listViews(client, tableId) {
  const items = [];
  let pageToken;
  do {
    const data = await callJson(client, 'bitable_v1_appTableView_list', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    items.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return items;
}

async function ensureTable(client, tablesByName, tableName, primaryFieldName, defaultViewName, report) {
  assertWritableTableName(tableName);
  if (tablesByName.has(tableName)) return tablesByName.get(tableName);
  report.planned.tables.push(tableName);
  if (DRY_RUN) return undefined;
  const data = await callJson(client, 'bitable_v1_appTable_create', {
    path: { app_token: APP_TOKEN },
    data: {
      table: {
        name: tableName,
        default_view_name: defaultViewName,
        fields: [text(primaryFieldName)],
      },
    },
    params: { client_token: randomUUID() },
  });
  const tableId = data.table_id || data.table?.table_id || data.data?.table_id || data.data?.table?.table_id;
  if (!tableId) throw new Error(`Could not read created table id for ${tableName}: ${JSON.stringify(data)}`);
  tablesByName.set(tableName, tableId);
  report.created.tables.push(tableName);
  return tableId;
}

async function ensureField(client, tableName, tableId, fieldsByName, desiredField, report) {
  assertWritableTableName(tableName);
  if (fieldsByName.has(desiredField.field_name)) return fieldsByName.get(desiredField.field_name);
  report.planned.fields.push(`${tableName}.${desiredField.field_name}`);
  if (DRY_RUN || !tableId) return undefined;
  try {
    const data = await callJson(client, 'bitable_v1_appTableField_create', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      data: desiredField,
      params: { client_token: randomUUID() },
    });
    const created = data.field || data.data?.field || data;
    const fieldId = created.field_id || created.field?.field_id;
    report.created.fields.push(`${tableName}.${desiredField.field_name}`);
    const normalized = { ...created, field_id: fieldId, field_name: desiredField.field_name };
    fieldsByName.set(desiredField.field_name, normalized);
    return normalized;
  } catch (error) {
    if (desiredField.type === FIELD_TYPES.formula) {
      report.skipped_formula_fields.push({
        field: `${tableName}.${desiredField.field_name}`,
        reason: error.message,
      });
      return undefined;
    }
    throw error;
  }
}

async function ensureViews(client, tableName, tableId, viewNames, report) {
  assertWritableTableName(tableName);
  if (DRY_RUN || !tableId) {
    report.planned.views.push(...viewNames.map((name) => `${tableName}.${name}`));
    return;
  }
  const existing = await listViews(client, tableId);
  const existingNames = new Set(existing.map((view) => view.view_name));
  for (const viewName of viewNames) {
    if (existingNames.has(viewName)) continue;
    report.planned.views.push(`${tableName}.${viewName}`);
    await callJson(client, 'bitable_v1_appTableView_create', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      data: { view_name: viewName, view_type: 'grid' },
    });
    report.created.views.push(`${tableName}.${viewName}`);
  }
}

async function ensureInvoiceModel(client) {
  const report = {
    dry_run: DRY_RUN,
    planned: { tables: [], fields: [], views: [] },
    created: { tables: [], fields: [], views: [] },
    skipped_formula_fields: [],
    protected_tables: [TARGET_TABLE_NAMES.oldProjectPlan],
  };

  const tables = await listTables(client);
  const tablesByName = new Map(tables.map((table) => [table.name, table.table_id]));
  const projectOverviewId = tablesByName.get(TARGET_TABLE_NAMES.projectOverview);
  if (!projectOverviewId) throw new Error(`Target table not found: ${TARGET_TABLE_NAMES.projectOverview}`);

  const overviewFields = new Map((await listFields(client, projectOverviewId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  await ensureField(
    client,
    TARGET_TABLE_NAMES.projectOverview,
    projectOverviewId,
    overviewFields,
    select('项目分类管理', CATEGORY_OPTIONS, '人工维护：经营项目、行政/内部项目、走账项目；下游表通过关联项目引用。'),
    report,
  );

  const planTableId = await ensureTable(client, tablesByName, TARGET_TABLE_NAMES.invoicePlan, '计划唯一键', '全部计划', report);
  const detailTableId = await ensureTable(client, tablesByName, TARGET_TABLE_NAMES.invoiceDetail, '明细唯一键', '全部明细', report);
  if (DRY_RUN) return report;

  const refreshedTables = new Map((await listTables(client)).map((table) => [table.name, table.table_id]));
  const actualPlanTableId = refreshedTables.get(TARGET_TABLE_NAMES.invoicePlan) || planTableId;
  const actualDetailTableId = refreshedTables.get(TARGET_TABLE_NAMES.invoiceDetail) || detailTableId;
  const actualOverviewFields = new Map((await listFields(client, projectOverviewId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const projectNoFieldId = actualOverviewFields.get('项目编号')?.field_id;
  const projectNameFieldId = actualOverviewFields.get('项目名称')?.field_id;
  const projectCategoryFieldId = actualOverviewFields.get('项目分类管理')?.field_id;

  const planFields = new Map((await listFields(client, actualPlanTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const detailFields = new Map((await listFields(client, actualDetailTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));

  const planProjectLink = await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, singleLink('关联项目', projectOverviewId, '关联项目总览表；项目编号、项目名称、项目分类管理从这里引用。'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, singleLink('关联项目', projectOverviewId, '关联项目总览表；项目编号、项目名称、项目分类管理从这里引用。'), report);

  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('计划期次'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('计划总期数'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('计划开票金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('计划开票日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('预计回款日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, select('匹配状态', PLAN_STATUS_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, select('开票状态', INVOICE_STATUS_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, select('回款状态', PAYMENT_STATUS_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('实际开票金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('实际收款金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('实际开票日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('实际收款日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('未开票金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('未收款金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('开票差异金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('开票逾期天数'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('回款逾期天数'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, text('异常原因'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, text('数据来源'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('最后同步时间'), report);

  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('来源主体'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('发票编号'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('发票编号显示值'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('项目编号'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('项目名称'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('客户名称'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('开票申请人'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, date('开票日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('收入额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('税金'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('开票金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('收款金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('欠款金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, date('收款日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, select('匹配状态', INVOICE_MATCH_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, select('抵消状态', INVOICE_MATCH_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, select('是否纳入统计', YES_NO_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('异常原因'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('源表名称'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('源记录ID'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('备注'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, date('最后同步时间'), report);

  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, singleLink('关联发票', actualDetailTableId, '脚本匹配到本计划期次的开票明细。', true), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, singleLink('关联计划', actualPlanTableId, '脚本匹配到的项目开票计划期次。'), report);

  const latestPlanFields = new Map((await listFields(client, actualPlanTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const latestDetailFields = new Map((await listFields(client, actualDetailTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const planLinkFieldId = latestPlanFields.get('关联项目')?.field_id || planProjectLink?.field_id;
  const detailLinkFieldId = latestDetailFields.get('关联项目')?.field_id;

  if (projectNoFieldId && projectNameFieldId && projectCategoryFieldId && planLinkFieldId) {
    await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, latestPlanFields, formula('项目编号', linkLookupExpression({ tableId: actualPlanTableId, linkFieldId: planLinkFieldId, targetFieldId: projectNoFieldId }), 1, '查找引用：由关联项目带出项目编号。'), report);
    await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, latestPlanFields, formula('项目名称', linkLookupExpression({ tableId: actualPlanTableId, linkFieldId: planLinkFieldId, targetFieldId: projectNameFieldId }), 1, '查找引用：由关联项目带出项目名称。'), report);
    await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, latestPlanFields, formula('项目分类管理', linkLookupExpression({ tableId: actualPlanTableId, linkFieldId: planLinkFieldId, targetFieldId: projectCategoryFieldId }), 1, '查找引用：由关联项目带出项目分类管理。'), report);
  }

  if (projectCategoryFieldId && detailLinkFieldId) {
    await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, latestDetailFields, formula('项目分类管理', linkLookupExpression({ tableId: actualDetailTableId, linkFieldId: detailLinkFieldId, targetFieldId: projectCategoryFieldId }), 1, '查找引用：由关联项目带出项目分类管理。'), report);
  }

  const newestPlanFields = new Map((await listFields(client, actualPlanTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const newestDetailFields = new Map((await listFields(client, actualDetailTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const planCategoryFieldId = newestPlanFields.get('项目分类管理')?.field_id;
  const detailCategoryFieldId = newestDetailFields.get('项目分类管理')?.field_id;
  if (planCategoryFieldId) {
    await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, newestPlanFields, formula('老板驾驶舱分组', bossDashboardGroupExpression(actualPlanTableId, planCategoryFieldId), 1, '公式：经营项目进入经营项目总览，走账项目进入走账项目总览，行政/内部项目不纳入。'), report);
  }
  if (detailCategoryFieldId) {
    await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, newestDetailFields, formula('老板驾驶舱分组', bossDashboardGroupExpression(actualDetailTableId, detailCategoryFieldId), 1, '公式：经营项目进入经营项目总览，走账项目进入走账项目总览，行政/内部项目不纳入。'), report);
  }

  await ensureViews(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, [
    '待匹配计划',
    '金额异常待确认',
    '开票逾期',
    '回款逾期',
    '项目分类待确认',
  ], report);
  await ensureViews(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, [
    '待匹配发票',
    '项目未匹配发票',
    '金额异常待确认',
    '红冲待确认',
    '重复明细唯一键',
  ], report);

  return report;
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTable.create',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableField.create',
  'bitable.v1.appTableView.list',
  'bitable.v1.appTableView.create',
]);

try {
  const report = await ensureInvoiceModel(client);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
