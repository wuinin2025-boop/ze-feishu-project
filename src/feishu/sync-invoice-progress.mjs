#!/usr/bin/env node

import {
  APP_TOKEN,
  SOURCE_TABLES,
  TARGET_TABLE_NAMES,
} from '../config.mjs';
import {
  buildOldProjectNodes,
  buildProgressKey,
  buildSplitInvoiceNodes,
  classifyApplication,
  collapseReversedInvoices,
  deriveInvoiceStatus,
  deriveOverallStatus,
  derivePaymentStatus,
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
  '团队信息_项目负责人',
  '项目立项_立项金额',
  '项目结算_结算金额（开票）',
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
  '开票额',
  '收款额',
  '收款日期',
  '备注',
  'SourceID',
];

function assertTargetTableName(tableName) {
  if (tableName.startsWith('源_')) {
    throw new Error(`Refusing to write source table: ${tableName}`);
  }
}

function peopleField(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw.flatMap((person) => person?.id ? [{ id: person.id }] : []);
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
  for (const name of Object.values(TARGET_TABLE_NAMES)) {
    if (!result.has(name)) throw new Error(`Target table not found: ${name}`);
  }
  return result;
}

async function batchCreate(client, tableName, tableId, records) {
  assertTargetTableName(tableName);
  if (DRY_RUN || !records.length) return 0;
  let count = 0;
  for (let index = 0; index < records.length; index += 500) {
    const chunk = records.slice(index, index + 500);
    await callJson(client, 'bitable_v1_appTableRecord_batchCreate', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      params: { user_id_type: 'open_id' },
      data: { records: chunk.map((fields) => ({ fields })) },
    });
    count += chunk.length;
  }
  return count;
}

async function batchUpdate(client, tableName, tableId, records) {
  assertTargetTableName(tableName);
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

async function batchDelete(client, tableName, tableId, recordIds) {
  assertTargetTableName(tableName);
  if (DRY_RUN || !recordIds.length) return 0;
  let count = 0;
  for (let index = 0; index < recordIds.length; index += 500) {
    const chunk = recordIds.slice(index, index + 500);
    await callJson(client, 'bitable_v1_appTableRecord_batchDelete', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      data: { records: chunk },
    });
    count += chunk.length;
  }
  return count;
}

async function upsertByKey(client, tableName, tableId, rows, { prune = false, pruneKey = () => true } = {}) {
  const existing = await searchAll(client, APP_TOKEN, tableId, ['源记录键']);
  const existingByKey = new Map(existing.map((record) => [textValue(record.fields?.['源记录键']), record.record_id]).filter(([key]) => key));
  const desiredKeys = new Set(rows.map((row) => textValue(row['源记录键'])).filter(Boolean));
  const staleRecordIds = prune
    ? [...existingByKey].flatMap(([key, recordId]) => !desiredKeys.has(key) && pruneKey(key) ? [recordId] : [])
    : [];
  const creates = [];
  const updates = [];
  for (const row of rows) {
    const key = textValue(row['源记录键']);
    if (!key) continue;
    const clean = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== ''));
    const recordId = existingByKey.get(key);
    if (recordId) updates.push({ record_id: recordId, fields: clean });
    else creates.push(clean);
  }
  return {
    planned: rows.length,
    deleted: await batchDelete(client, tableName, tableId, staleRecordIds),
    created: await batchCreate(client, tableName, tableId, creates),
    updated: await batchUpdate(client, tableName, tableId, updates),
    stale: staleRecordIds.length,
  };
}

function normalizeInvoice(source, record) {
  const fields = record.fields || {};
  const sourceId = textValue(fields.SourceID) || record.record_id;
  const invoiceNo = textValue(fields['发票号码']) || sourceId;
  const projectNo = textValue(fields['项目编号']);
  const invoiceAmount = numberValue(fields['开票额']) || 0;
  const receivedAmount = numberValue(fields['收款额']) || 0;
  return {
    sourceName: source.name,
    sourceId,
    key: `${source.name}|${sourceId}`,
    invoiceNo,
    projectNo,
    projectName: textValue(fields['项目名称']),
    customerName: textValue(fields['客户名称']),
    invoiceDate: timestampValue(fields['开票日期']),
    invoiceAmount,
    paymentDate: timestampValue(fields['收款日期']),
    receivedAmount,
    remark: textValue(fields['备注']),
  };
}

function normalizeProject(record) {
  const fields = record.fields || {};
  const approvedAmount = numberValue(fields['项目结算_结算金额（开票）'])
    ?? numberValue(fields['项目立项_立项金额'])
    ?? 0;
  return {
    recordId: record.record_id,
    applicationNo: textValue(fields['申请编号']),
    applicationStatus: textValue(fields['申请状态']),
    sourceId: textValue(fields.SourceID) || record.record_id,
    projectNo: textValue(fields['项目编号']),
    projectName: textValue(fields['项目名称']),
    customerName: textValue(fields['客户名称']),
    owner: peopleField(fields['团队信息_项目负责人']),
    approvedAmount,
    originalPlanCount: numberValue(fields['预计开票总次数']),
    originalPeriod: numberValue(fields['开票计划（根据合同约定开票频次新增对应明细）_开票期次(次)']),
    originalPlanDate: timestampValue(fields['开票计划（根据合同约定开票频次新增对应明细）_预计开票日期']),
    originalPlanAmount: numberValue(fields['开票计划（根据合同约定开票频次新增对应明细）_预计开票金额']),
    expectedPaymentDate: timestampValue(fields['开票计划（根据合同约定开票频次新增对应明细）_预计回款日期']),
  };
}

function buildInvoiceCollectionRows(invoices) {
  return invoices.map((invoice) => ({
    '源记录键': invoice.key,
    '来源表': invoice.sourceName,
    '源记录ID': invoice.sourceId,
    '发票号码': invoice.invoiceNo,
    '项目编号': invoice.projectNo,
    '项目名称': invoice.projectName,
    '客户名称': invoice.customerName,
    '开票日期': invoice.invoiceDate,
    '开票金额': invoice.invoiceAmount,
    '回款日期': invoice.paymentDate,
    '回款金额': invoice.receivedAmount,
    '备注': invoice.remark,
    '匹配状态': invoice.projectNo ? '自动匹配' : '未匹配项目',
    '最后同步时间': NOW,
  }));
}

function oldPlanRow(project, node) {
  return {
    '源记录键': `old-plan|${project.projectNo}|${node.executionPeriod}`,
    '项目编号': project.projectNo,
    '项目名称': project.projectName,
    '开票总次数': node.currentPlanCount,
    '开票期次': node.executionPeriod,
    '计划开票日期': node.planDate,
    '计划开票金额': node.currentPlanAmount,
    '预计回款日期': node.expectedPaymentDate,
    '备注': node.generationStatus,
    '生成状态': node.generationStatus,
    '最后同步时间': NOW,
  };
}

function progressRow(project, node, dataSource) {
  const invoiceStatus = deriveInvoiceStatus({
    planDate: node.planDate || node.originalPlanDate,
    planAmount: node.currentPlanAmount,
    actualInvoiceAmount: node.actualInvoiceAmount || 0,
    today: NOW,
  });
  const paymentStatus = derivePaymentStatus({
    actualInvoiceAmount: node.actualInvoiceAmount || 0,
    receivedAmount: node.receivedAmount || 0,
    expectedPaymentDate: node.expectedPaymentDate,
    today: NOW,
  });
  const diffStatus = node.diffStatus || '无差异';
  const planDate = node.planDate || node.originalPlanDate;
  const expectedPaymentDate = node.expectedPaymentDate;
  const invoiceOverdueDays = invoiceStatus === '开票逾期' && planDate ? Math.max(Math.floor((NOW - planDate) / 86400000), 0) : 0;
  const paymentOverdueDays = paymentStatus === '回款逾期' && expectedPaymentDate ? Math.max(Math.floor((NOW - expectedPaymentDate) / 86400000), 0) : 0;
  const uninvoiced = Math.max((node.currentPlanAmount || 0) - (node.actualInvoiceAmount || 0), 0);
  const unpaid = Math.max((node.actualInvoiceAmount || 0) - (node.receivedAmount || 0), 0);
  return {
    '源记录键': buildProgressKey({ projectNo: project.projectNo, executionPeriod: node.executionPeriod, invoiceNo: node.invoiceNo }),
    '项目编号': project.projectNo,
    '项目名称': project.projectName,
    '客户名称': project.customerName,
    '立项时项目负责人': project.owner,
    '当前权限负责人': project.owner,
    '立项开票总次数': node.originalPlanCount || project.originalPlanCount || node.currentPlanCount,
    '当前开票总次数': node.currentPlanCount,
    '原计划期次': node.originalPeriod,
    '当前执行期次': node.executionPeriod,
    '原计划开票金额': node.originalPlanAmount,
    '当前计划开票金额': node.currentPlanAmount,
    '计划开票日期': planDate,
    '预计回款日期': expectedPaymentDate,
    '实际开票日期': node.actualInvoiceDate,
    '实际开票金额': node.actualInvoiceAmount || 0,
    '回款日期': node.paymentDate,
    '回款金额': node.receivedAmount || 0,
    '未开票金额': uninvoiced,
    '未回款金额': unpaid,
    '逾期天数': Math.max(invoiceOverdueDays, paymentOverdueDays),
    '逾期金额': paymentStatus === '回款逾期' ? unpaid : invoiceStatus === '开票逾期' ? uninvoiced : 0,
    '开票状态': invoiceStatus,
    '回款状态': paymentStatus,
    '综合状态': deriveOverallStatus({ invoiceStatus, paymentStatus, diffStatus }),
    '差异状态': diffStatus,
    '生成状态': node.generationStatus || (diffStatus === '实际拆分开票' ? '实际拆分开票' : '源计划自动生成'),
    '计划备注': node.planRemark,
    '发票备注': node.remark,
    '差异说明': diffStatus === '实际拆分开票' ? `立项计划 ${node.originalPlanCount || project.originalPlanCount || ''} 次，实际开票 ${node.currentPlanCount} 次` : '',
    '数据来源': dataSource,
    '最后同步时间': NOW,
  };
}

function buildRows(projects, invoices) {
  const invoiceByProject = new Map();
  for (const invoice of invoices) addToMap(invoiceByProject, invoice.projectNo, invoice);

  const approvedProjects = projects.filter((project) => project.applicationStatus === '已通过' && project.projectNo);
  const oldProjectByNo = new Map();
  const newPlanByProject = new Map();
  const excludedTests = [];

  for (const project of approvedProjects) {
    const classification = classifyApplication(project.applicationNo);
    if (classification === 'excluded-test') {
      excludedTests.push(project);
      continue;
    }
    if (classification === 'old') {
      if (!oldProjectByNo.has(project.projectNo)) oldProjectByNo.set(project.projectNo, project);
      continue;
    }
    if (project.originalPeriod) addToMap(newPlanByProject, project.projectNo, project);
  }

  for (const projectNo of newPlanByProject.keys()) {
    oldProjectByNo.delete(projectNo);
  }

  const oldPlanRows = [];
  const progressRows = [];

  for (const project of oldProjectByNo.values()) {
    const projectInvoices = collapseReversedInvoices(invoiceByProject.get(project.projectNo) || []);
    const nodes = buildOldProjectNodes(project, projectInvoices);
    for (const node of nodes) {
      oldPlanRows.push(oldPlanRow(project, node));
      progressRows.push(progressRow(project, node, '旧项目自动初始化'));
    }
  }

  for (const [projectNo, planRows] of newPlanByProject) {
    const sortedPlans = [...planRows].sort((left, right) => (left.originalPeriod || 0) - (right.originalPeriod || 0));
    const project = sortedPlans[0];
    const invoicesForProject = collapseReversedInvoices(invoiceByProject.get(projectNo) || []);
    const nodes = buildSplitInvoiceNodes(sortedPlans, invoicesForProject).map((node) => ({
      ...node,
      planDate: node.originalPlanDate,
      expectedPaymentDate: node.expectedPaymentDate,
      generationStatus: node.diffStatus === '实际拆分开票' ? '实际拆分开票' : '源计划自动生成',
      remark: invoicesForProject.find((invoice) => invoice.invoiceNo === node.invoiceNo)?.remark,
    }));
    for (const node of nodes) progressRows.push(progressRow(project, node, '源立项开票计划'));
  }

  return {
    invoiceCollectionRows: buildInvoiceCollectionRows(invoices),
    oldPlanRows,
    progressRows,
    stats: {
      approved_project_count: approvedProjects.length,
      old_project_count: oldProjectByNo.size,
      new_project_count: newPlanByProject.size,
      excluded_test_count: excludedTests.length,
      invoice_count: invoices.length,
      old_plan_rows: oldPlanRows.length,
      progress_rows: progressRows.length,
      manual_confirmation_rows: progressRows.filter((row) => ['待人工确认', '待人工补充'].includes(row['生成状态'])).length,
      split_rows: progressRows.filter((row) => row['差异状态'] === '实际拆分开票').length,
    },
  };
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTableRecord.search',
  'bitable.v1.appTableRecord.batchCreate',
  'bitable.v1.appTableRecord.batchUpdate',
  'bitable.v1.appTableRecord.batchDelete',
]);

try {
  const tableIds = await tableIdByName(client);
  const [sourceProjects, ...invoiceSources] = await Promise.all([
    searchAll(client, APP_TOKEN, SOURCE_TABLES.establishment, ESTABLISHMENT_FIELDS),
    ...SOURCE_TABLES.invoices.map((source) => searchAll(client, APP_TOKEN, source.id, INVOICE_FIELDS)
      .then((records) => records.map((record) => normalizeInvoice(source, record)))),
  ]);
  const projects = sourceProjects.map(normalizeProject);
  const invoices = invoiceSources.flat();
  const rows = buildRows(projects, invoices);

  const invoiceCollectionResult = await upsertByKey(
    client,
    TARGET_TABLE_NAMES.invoiceCollection,
    tableIds.get(TARGET_TABLE_NAMES.invoiceCollection),
    rows.invoiceCollectionRows,
    { prune: true },
  );
  const oldPlanResult = await upsertByKey(
    client,
    TARGET_TABLE_NAMES.oldProjectPlan,
    tableIds.get(TARGET_TABLE_NAMES.oldProjectPlan),
    rows.oldPlanRows,
    { prune: true, pruneKey: (key) => key.startsWith('old-plan|') },
  );
  const progressResult = await upsertByKey(
    client,
    TARGET_TABLE_NAMES.invoiceProgressTrial,
    tableIds.get(TARGET_TABLE_NAMES.invoiceProgressTrial),
    rows.progressRows,
    { prune: true },
  );

  const report = {
    dry_run: DRY_RUN,
    stats: rows.stats,
    upsert: {
      invoice_collection: invoiceCollectionResult,
      old_project_plan: oldPlanResult,
      invoice_progress: progressResult,
    },
  };

  if (!DRY_RUN) {
    await batchCreate(client, TARGET_TABLE_NAMES.syncLog, tableIds.get(TARGET_TABLE_NAMES.syncLog), [{
      '运行时间': NOW,
      '运行类型': '项目开票进度同步',
      '结果': '成功',
      '摘要': `进度表 ${progressResult.created} 新增 / ${progressResult.updated} 更新`,
      '详情JSON': JSON.stringify(report),
    }]);
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
