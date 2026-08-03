#!/usr/bin/env node

import {
  APP_TOKEN,
  SOURCE_TABLES,
  TARGET_TABLE_NAMES,
} from '../config.mjs';
import {
  buildInvoiceDetailKey,
  buildPlanUniqueKey,
  buildProjectOverviewMetricRows,
  classifyApplication,
  matchInvoicesToPlans,
  normalizeInvoiceNo,
} from '../rules/invoice-progress-rules.mjs';
import {
  callJson,
  connectFeishu,
  numberValue,
  searchAll,
  textValue,
  timestampValue,
} from './client.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const NOW = Date.now();

const ESTABLISHMENT_FIELDS = [
  '申请编号',
  '申请状态',
  '项目编号',
  '项目名称',
  '客户名称',
  '预计开票总次数',
  '开票计划（根据合同约定开票频次新增对应明细）_开票期次(次)',
  '开票计划（根据合同约定开票频次新增对应明细）_预计开票日期',
  '开票计划（根据合同约定开票频次新增对应明细）_预计开票金额',
  '开票计划（根据合同约定开票频次新增对应明细）_预计回款日期',
  'SourceID',
];

const INVOICE_FIELDS = [
  '发票号码',
  '开票日期',
  '项目编号',
  '项目名称',
  '客户名称',
  '摘要',
  '收入额',
  '税金',
  '开票额',
  '收款额',
  '欠款额',
  '收款日期',
  '开票申请人',
  '备注',
  'SourceID',
];

const PROJECT_OVERVIEW_FIELDS = [
  '项目编号',
  '项目名称',
  '项目分类管理',
  '立项金额',
  '结算金额',
  '已开票金额',
  '已收款金额',
  '计划开票总金额',
  '逾期开票金额',
  '逾期回款金额',
  '下一计划开票日期',
  '下一预计回款日期',
];

function assertWritableTarget(tableName) {
  if (tableName.startsWith('源_') || tableName === TARGET_TABLE_NAMES.oldProjectPlan) {
    throw new Error(`Refusing to write protected table: ${tableName}`);
  }
}

function linkField(recordId, multiple = false) {
  if (!recordId) return undefined;
  return multiple ? [recordId].flat() : [recordId].flat();
}

function cleanFields(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== ''));
}

function addToMap(map, key, value) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
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

async function tableIdByName(client) {
  const tables = await listTables(client);
  const result = new Map(tables.map((table) => [table.name, table.table_id]));
  for (const name of [
    TARGET_TABLE_NAMES.projectOverview,
    TARGET_TABLE_NAMES.invoicePlan,
    TARGET_TABLE_NAMES.invoiceDetail,
  ]) {
    if (!result.has(name)) throw new Error(`Target table not found: ${name}. Run npm run setup:invoice-model first.`);
  }
  return result;
}

async function batchCreate(client, tableName, tableId, rows) {
  assertWritableTarget(tableName);
  if (DRY_RUN || !rows.length) return 0;
  let count = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    await callJson(client, 'bitable_v1_appTableRecord_batchCreate', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      params: { user_id_type: 'open_id' },
      data: { records: chunk.map((fields) => ({ fields })) },
    });
    count += chunk.length;
  }
  return count;
}

async function batchUpdate(client, tableName, tableId, rows) {
  assertWritableTarget(tableName);
  if (DRY_RUN || !rows.length) return 0;
  let count = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    await callJson(client, 'bitable_v1_appTableRecord_batchUpdate', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      params: { user_id_type: 'open_id' },
      data: { records: chunk },
    });
    count += chunk.length;
  }
  return count;
}

async function readKeyMap(client, tableId, keyField) {
  const records = await searchAll(client, APP_TOKEN, tableId, [keyField]);
  return new Map(records
    .map((record) => [textValue(record.fields?.[keyField]), record.record_id])
    .filter(([key]) => key));
}

async function upsertByKey(client, tableName, tableId, rows, keyField) {
  const existingByKey = await readKeyMap(client, tableId, keyField);
  const creates = [];
  const updates = [];
  for (const row of rows) {
    const key = textValue(row[keyField]);
    if (!key) continue;
    const fields = cleanFields(row);
    const recordId = existingByKey.get(key);
    if (recordId) updates.push({ record_id: recordId, fields });
    else creates.push(fields);
  }
  return {
    planned: rows.length,
    created: await batchCreate(client, tableName, tableId, creates),
    updated: await batchUpdate(client, tableName, tableId, updates),
  };
}

function normalizeProjectOverview(record) {
  const fields = record.fields || {};
  return {
    recordId: record.record_id,
    projectNo: textValue(fields['项目编号']),
    projectName: textValue(fields['项目名称']),
    projectCategory: textValue(fields['项目分类管理']),
    establishmentAmount: numberValue(fields['立项金额']) || 0,
    settlementAmount: numberValue(fields['结算金额']) || 0,
    invoicedAmount: numberValue(fields['已开票金额']) || 0,
    receivedAmount: numberValue(fields['已收款金额']) || 0,
    planInvoiceAmount: numberValue(fields['计划开票总金额']) || 0,
    overdueInvoiceAmount: numberValue(fields['逾期开票金额']) || 0,
    overduePaymentAmount: numberValue(fields['逾期回款金额']) || 0,
    nextPlanDate: timestampValue(fields['下一计划开票日期']),
    nextExpectedPaymentDate: timestampValue(fields['下一预计回款日期']),
  };
}

function normalizePlanSource(record) {
  const fields = record.fields || {};
  const projectNo = textValue(fields['项目编号']);
  const period = numberValue(fields['开票计划（根据合同约定开票频次新增对应明细）_开票期次(次)']);
  return {
    sourceId: textValue(fields.SourceID) || record.record_id,
    applicationNo: textValue(fields['申请编号']),
    applicationStatus: textValue(fields['申请状态']),
    projectNo,
    projectName: textValue(fields['项目名称']),
    customerName: textValue(fields['客户名称']),
    period,
    planKey: buildPlanUniqueKey({ projectNo, period }),
    planCount: numberValue(fields['预计开票总次数']),
    planDate: timestampValue(fields['开票计划（根据合同约定开票频次新增对应明细）_预计开票日期']),
    planAmount: numberValue(fields['开票计划（根据合同约定开票频次新增对应明细）_预计开票金额']) || 0,
    expectedPaymentDate: timestampValue(fields['开票计划（根据合同约定开票频次新增对应明细）_预计回款日期']),
  };
}

function normalizeInvoice(source, record) {
  const fields = record.fields || {};
  const sourceId = textValue(fields.SourceID) || record.record_id;
  const rawInvoiceNo = textValue(fields['发票号码']);
  const customerName = textValue(fields['客户名称']);
  const invoiceNo = normalizeInvoiceNo({ customerName, invoiceNo: rawInvoiceNo });
  const base = {
    sourceName: source.name,
    sourceId,
    rawInvoiceNo,
    invoiceNo: invoiceNo.displayInvoiceNo,
    displayInvoiceNo: invoiceNo.displayInvoiceNo,
    invoiceNoMissing: invoiceNo.invoiceNoMissing,
    isHankook: invoiceNo.isHankook,
    projectNo: textValue(fields['项目编号']),
    projectName: textValue(fields['项目名称']),
    customerName,
    summary: textValue(fields['摘要']),
    incomeAmount: numberValue(fields['收入额']) || 0,
    taxAmount: numberValue(fields['税金']) || 0,
    invoiceAmount: numberValue(fields['开票额']) || 0,
    receivedAmount: numberValue(fields['收款额']) || 0,
    debtAmount: numberValue(fields['欠款额']) || 0,
    invoiceDate: timestampValue(fields['开票日期']),
    paymentDate: timestampValue(fields['收款日期']),
    applicant: textValue(fields['开票申请人']),
    remark: textValue(fields['备注']),
  };
  return {
    ...base,
    detailKey: buildInvoiceDetailKey(base),
  };
}

function attachProjects(plans, invoices, overviewRows) {
  const overviewByProjectNo = new Map();
  for (const row of overviewRows) {
    if (row.projectNo && !overviewByProjectNo.has(row.projectNo)) overviewByProjectNo.set(row.projectNo, row);
  }
  return {
    plans: plans.map((plan) => ({
      ...plan,
      projectRecordId: overviewByProjectNo.get(plan.projectNo)?.recordId,
      projectCategory: overviewByProjectNo.get(plan.projectNo)?.projectCategory,
    })),
    invoices: invoices.map((invoice) => ({
      ...invoice,
      projectRecordId: overviewByProjectNo.get(invoice.projectNo)?.recordId,
      projectCategory: overviewByProjectNo.get(invoice.projectNo)?.projectCategory,
    })),
  };
}

function sourcePlanRows(projects) {
  const rowsByKey = new Map();
  const excludedTests = [];
  const oldProjects = new Set();
  let candidateNewRows = 0;
  let duplicateNewRows = 0;
  for (const project of projects) {
    if (project.applicationStatus !== '已通过' || !project.projectNo || !project.period) continue;
    const classification = classifyApplication(project.applicationNo);
    if (classification === 'excluded-test') {
      excludedTests.push(project);
      continue;
    }
    if (classification === 'old') {
      oldProjects.add(project.projectNo);
      continue;
    }
    candidateNewRows += 1;
    if (rowsByKey.has(project.planKey)) duplicateNewRows += 1;
    else rowsByKey.set(project.planKey, project);
  }
  return {
    rows: [...rowsByKey.values()],
    stats: {
      excluded_test_count: excludedTests.length,
      old_project_count_skipped: oldProjects.size,
      source_plan_candidate_count: candidateNewRows,
      source_plan_duplicate_count: duplicateNewRows,
    },
  };
}

function buildInvoiceRows(invoices) {
  return invoices.map((invoice) => ({
    '明细唯一键': invoice.detailKey,
    '来源主体': invoice.sourceName,
    '发票编号': invoice.rawInvoiceNo,
    '发票编号显示值': invoice.displayInvoiceNo,
    '关联项目': linkField(invoice.projectRecordId),
    '项目编号': invoice.projectNo,
    '项目名称': invoice.projectName,
    '客户名称': invoice.customerName,
    '开票申请人': invoice.applicant,
    '开票日期': invoice.invoiceDate,
    '收入额': invoice.incomeAmount,
    '税金': invoice.taxAmount,
    '开票金额': invoice.invoiceAmount,
    '收款金额': invoice.receivedAmount,
    '欠款金额': invoice.debtAmount,
    '收款日期': invoice.paymentDate,
    '匹配状态': invoice.matchStatus || '待匹配',
    '抵消状态': invoice.offsetStatus || '未抵消',
    '是否纳入统计': invoice.includedInStats ? '是' : '否',
    '异常原因': invoice.invoiceNoMissing ? '发票编号缺失' : '',
    '源表名称': invoice.sourceName,
    '源记录ID': invoice.sourceId,
    '备注': invoice.remark,
    '最后同步时间': NOW,
  }));
}

function buildPlanRows(plans, detailRecordIdsByKey) {
  return plans.map((plan) => {
    const linkedInvoiceRecordIds = (plan.linkedInvoiceKeys || [])
      .map((key) => detailRecordIdsByKey.get(key))
      .filter(Boolean);
    return {
      '计划唯一键': plan.planKey,
      '关联项目': linkField(plan.projectRecordId),
      '关联发票': linkedInvoiceRecordIds.length ? linkField(linkedInvoiceRecordIds, true) : undefined,
      '计划期次': plan.period,
      '计划总期数': plan.planCount,
      '计划开票金额': plan.planAmount,
      '计划开票日期': plan.planDate,
      '预计回款日期': plan.expectedPaymentDate,
      '匹配状态': plan.matchStatus,
      '开票状态': plan.invoiceStatus,
      '回款状态': plan.paymentStatus,
      '实际开票金额': plan.actualInvoiceAmount,
      '实际收款金额': plan.receivedAmount,
      '实际开票日期': plan.actualInvoiceDate,
      '实际收款日期': plan.paymentDate,
      '未开票金额': plan.uninvoicedAmount,
      '未收款金额': plan.unpaidAmount,
      '开票差异金额': Number((Number(plan.actualInvoiceAmount || 0) - Number(plan.planAmount || 0)).toFixed(2)),
      '开票逾期天数': plan.invoiceOverdueDays,
      '回款逾期天数': plan.paymentOverdueDays,
      '异常原因': plan.diffStatus === '金额异常待确认' ? '实际开票金额超过计划开票金额，需人工确认。' : '',
      '数据来源': '源立项开票计划',
      '最后同步时间': NOW,
    };
  });
}

function buildInvoicePlanLinkUpdates(matchedInvoices, detailRecordIdsByKey, planRecordIdsByKey) {
  return matchedInvoices.flatMap((invoice) => {
    const detailRecordId = detailRecordIdsByKey.get(invoice.detailKey);
    const planRecordId = invoice.linkedPlanKey ? planRecordIdsByKey.get(invoice.linkedPlanKey) : undefined;
    if (!detailRecordId || !planRecordId) return [];
    return [{
      record_id: detailRecordId,
      fields: {
        '关联计划': linkField(planRecordId),
        '匹配状态': invoice.matchStatus,
      },
    }];
  });
}

function buildProjectOverviewUpdates(projects, matched) {
  return buildProjectOverviewMetricRows({
    projects,
    plans: matched.plans,
    invoices: matched.invoices,
    today: NOW,
  }).map((row) => ({
    record_id: row.recordId,
    fields: cleanFields(row.fields),
  }));
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTableRecord.search',
  'bitable.v1.appTableRecord.batchCreate',
  'bitable.v1.appTableRecord.batchUpdate',
]);

try {
  const tableIds = await tableIdByName(client);
  const [sourceProjects, projectOverviewRecords, ...invoiceSources] = await Promise.all([
    searchAll(client, APP_TOKEN, SOURCE_TABLES.establishment, ESTABLISHMENT_FIELDS),
    searchAll(client, APP_TOKEN, tableIds.get(TARGET_TABLE_NAMES.projectOverview), PROJECT_OVERVIEW_FIELDS),
    ...SOURCE_TABLES.invoices.map((source) => searchAll(client, APP_TOKEN, source.id, INVOICE_FIELDS)
      .then((records) => records.map((record) => normalizeInvoice(source, record)))),
  ]);

  const sourcePlans = sourcePlanRows(sourceProjects.map(normalizePlanSource));
  const projectOverviewRows = projectOverviewRecords.map(normalizeProjectOverview);
  const { plans, invoices } = attachProjects(
    sourcePlans.rows,
    invoiceSources.flat(),
    projectOverviewRows,
  );
  const matched = matchInvoicesToPlans(plans, invoices, { today: NOW });

  const invoiceRows = buildInvoiceRows(matched.invoices);
  const invoiceResult = await upsertByKey(
    client,
    TARGET_TABLE_NAMES.invoiceDetail,
    tableIds.get(TARGET_TABLE_NAMES.invoiceDetail),
    invoiceRows,
    '明细唯一键',
  );

  const detailRecordIdsByKey = DRY_RUN
    ? new Map()
    : await readKeyMap(client, tableIds.get(TARGET_TABLE_NAMES.invoiceDetail), '明细唯一键');

  const planRows = buildPlanRows(matched.plans, detailRecordIdsByKey);
  const planResult = await upsertByKey(
    client,
    TARGET_TABLE_NAMES.invoicePlan,
    tableIds.get(TARGET_TABLE_NAMES.invoicePlan),
    planRows,
    '计划唯一键',
  );

  const planRecordIdsByKey = DRY_RUN
    ? new Map()
    : await readKeyMap(client, tableIds.get(TARGET_TABLE_NAMES.invoicePlan), '计划唯一键');
  const detailPlanLinkUpdates = buildInvoicePlanLinkUpdates(matched.invoices, detailRecordIdsByKey, planRecordIdsByKey);
  const linkedDetails = await batchUpdate(
    client,
    TARGET_TABLE_NAMES.invoiceDetail,
    tableIds.get(TARGET_TABLE_NAMES.invoiceDetail),
    detailPlanLinkUpdates,
  );
  const projectOverviewUpdates = buildProjectOverviewUpdates(projectOverviewRows, matched);
  const projectOverviewUpdateResult = await batchUpdate(
    client,
    TARGET_TABLE_NAMES.projectOverview,
    tableIds.get(TARGET_TABLE_NAMES.projectOverview),
    projectOverviewUpdates,
  );

  const report = {
    dry_run: DRY_RUN,
    protected_tables: [TARGET_TABLE_NAMES.oldProjectPlan],
    stats: {
      source_plan_rows: sourcePlans.rows.length,
      source_invoice_rows: invoiceRows.length,
      matched_invoice_rows: matched.invoices.filter((invoice) => invoice.linkedPlanKey).length,
      offset_invoice_rows: matched.invoices.filter((invoice) => invoice.offsetStatus === '已抵消').length,
      unmatched_invoice_rows: matched.invoices.filter((invoice) => ['未匹配项目', '计划外开票', '红冲待确认'].includes(invoice.matchStatus)).length,
      amount_exception_plan_rows: matched.plans.filter((plan) => plan.matchStatus === '金额异常待确认').length,
      project_overview_updates: projectOverviewUpdates.length,
      ...sourcePlans.stats,
    },
    upsert: {
      invoice_detail: invoiceResult,
      invoice_plan: planResult,
      invoice_detail_plan_links: linkedDetails,
      project_overview: {
        planned: projectOverviewUpdates.length,
        updated: projectOverviewUpdateResult,
      },
    },
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
