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
  deriveProfitRateWarning,
  deriveProjectStages,
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
const REPORT_KEY_LIMIT = 200;
const TIME_ONLY_FIELDS = new Set(['最后同步时间', '源更新时间']);

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

const PROJECT_LEDGER_FIELDS = [
  '立项公司',
  '项目编号',
  '项目名称',
  '项目类型',
  '项目阶段',
  '项目负责人',
  '客户关联',
  '客户名称文本',
  '立项金额',
  '立项成本',
  'PO成本',
  '结算金额',
  '结算成本',
  '收款金额',
  'SourceID',
];

const OLD_PROJECT_PLAN_FIELDS = [
  '源记录键',
  '项目编号',
  '项目名称',
  '预计开票总次数',
  '开票总次数',
  '开票期次',
  '计划开票日期',
  '计划开票金额',
  '预计回款日期',
  '回款金额',
  '回款时间',
  '发票备注',
  '备注',
  '生成状态',
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
  '项目状态',
  '系统项目状态',
  '项目阶段',
  '立项金额',
  '立项成本',
  '结算金额',
  '结算成本',
  'PO金额',
  '累计实际付款金额',
  '未关闭风险数',
  '已开票金额',
  '已收款金额',
  '预计开票总次数',
  '计划开票总金额',
  '逾期开票金额',
  '逾期回款金额',
  '下一计划开票日期',
  '下一计划开票金额',
  '下一预计回款日期',
  '最近预计回款日期',
  '开票状态',
  '客户收款状态',
  '开票计划预警',
  '回款计划预警',
  '应收数据粒度',
  '开票回款计划说明',
  '最后同步时间',
];

const PROJECT_PROGRESS_FIELDS = [
  '任务名称',
  '关联项目',
  '项目编号',
  '任务状态',
  '风险等级',
];

const INVOICE_DETAIL_STALE_FIELDS = [
  '明细唯一键',
  '是否纳入统计',
];

const SUPPLIER_PAYMENT_FIELDS = [
  '项目编号',
  '付款金额',
  '付款状态',
  '实际付款金额',
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

function cleanUpdateFields(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => (
    value !== undefined
    && value !== ''
    && (!Array.isArray(value) || value.length > 0)
  )));
}

function cleanUpdateFieldsWithClears(row, clearableFields = []) {
  const clearable = new Set(clearableFields);
  return Object.fromEntries(Object.entries(row).filter(([fieldName, value]) => (
    value !== undefined
    && (
      clearable.has(fieldName)
      || (
        value !== ''
        && (!Array.isArray(value) || value.length > 0)
      )
    )
  )));
}

function comparableFieldValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return Number(value.toFixed(6));
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (item == null) return [];
        if (typeof item === 'string' || typeof item === 'number') return [String(item).trim()];
        if (typeof item === 'object') {
          if (Array.isArray(item.link_record_ids)) return item.link_record_ids;
          if (Array.isArray(item.record_ids)) return item.record_ids;
          return [item.record_id ?? item.id ?? item.text ?? item.name ?? item.value ?? ''];
        }
        return [];
      })
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean)
      .sort()
      .join('|');
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.link_record_ids)) return comparableFieldValue(value.link_record_ids);
    if (Array.isArray(value.record_ids)) return comparableFieldValue(value.record_ids);
    return comparableFieldValue(value.record_id ?? value.id ?? value.text ?? value.name ?? value.value ?? '');
  }
  return String(value).trim();
}

function fieldChanged(existingFields, fieldName, nextValue) {
  const current = comparableFieldValue(existingFields?.[fieldName]);
  const next = comparableFieldValue(nextValue);
  if (typeof current === 'number' || typeof next === 'number') {
    return Math.abs(Number(current || 0) - Number(next || 0)) >= 0.005;
  }
  return current !== next;
}

function changedUpdateFields(existingFields, nextFields, options = {}) {
  const createOnlyFields = new Set(options.createOnlyFields || []);
  const fields = cleanUpdateFieldsWithClears(nextFields, options.clearableFields || []);
  for (const fieldName of createOnlyFields) delete fields[fieldName];
  const changedEntries = Object.entries(fields)
    .filter(([fieldName, value]) => !TIME_ONLY_FIELDS.has(fieldName) && fieldChanged(existingFields, fieldName, value));
  if (!changedEntries.length) return {};
  const changed = Object.fromEntries(changedEntries);
  if (Object.hasOwn(fields, '最后同步时间')) changed['最后同步时间'] = fields['最后同步时间'];
  if (Object.hasOwn(fields, '源更新时间')) changed['源更新时间'] = fields['源更新时间'];
  return changed;
}

function addToMap(map, key, value) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

function multiSelectValue(value) {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const values = value.flatMap((item) => {
      if (item == null) return [];
      if (typeof item === 'string' || typeof item === 'number') return [String(item).trim()];
      if (typeof item === 'object') return [item.text ?? item.name ?? item.value ?? ''];
      return [];
    }).map(String).map((item) => item.trim()).filter(Boolean);
    return values.length ? [...new Set(values)] : undefined;
  }
  const text = textValue(value);
  return text ? text.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) : undefined;
}

function singleSelectValue(value) {
  return textValue(value) || undefined;
}

function userFieldValue(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const users = value
    .map((item) => item?.id)
    .filter(Boolean)
    .map((id) => ({ id }));
  return users.length ? users : undefined;
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
    TARGET_TABLE_NAMES.projectProgress,
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

async function batchDelete(client, tableName, tableId, recordIds) {
  assertWritableTarget(tableName);
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

async function readKeyMap(client, tableId, keyField) {
  const records = await searchAll(client, APP_TOKEN, tableId, [keyField]);
  return new Map(records
    .map((record) => [textValue(record.fields?.[keyField]), record.record_id])
    .filter(([key]) => key));
}

async function readRecordMapByKey(client, tableId, keyField, fieldNames) {
  const records = await searchAll(client, APP_TOKEN, tableId, fieldNames ? [...new Set([keyField, ...fieldNames])] : undefined);
  return new Map(records
    .map((record) => [textValue(record.fields?.[keyField]), record])
    .filter(([key]) => key));
}

async function readRecordMapById(client, tableId, fieldNames) {
  const records = await searchAll(client, APP_TOKEN, tableId, fieldNames);
  return new Map(records.map((record) => [record.record_id, record]));
}

function changedRecordUpdates(existingById, rows, options = {}) {
  const updates = [];
  const skipped = [];
  for (const row of rows) {
    const existing = existingById.get(row.record_id);
    const fields = changedUpdateFields(existing?.fields || {}, row.fields || {}, options);
    if (Object.keys(fields).length) updates.push({ record_id: row.record_id, fields });
    else skipped.push(row.record_id);
  }
  return { updates, skipped };
}

async function upsertByKey(client, tableName, tableId, rows, keyField, options = {}) {
  const compareFieldNames = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const existingByKey = await readRecordMapByKey(client, tableId, keyField, compareFieldNames);
  const creates = [];
  const updates = [];
  const createdKeys = [];
  const updatedKeys = [];
  let skippedUnchanged = 0;
  for (const row of rows) {
    const key = textValue(row[keyField]);
    if (!key) continue;
    const existing = existingByKey.get(key);
    if (existing) {
      const fields = changedUpdateFields(existing.fields || {}, row, options);
      if (Object.keys(fields).length) {
        updates.push({ record_id: existing.record_id, fields });
        updatedKeys.push(key);
      } else {
        skippedUnchanged += 1;
      }
    } else {
      const fields = cleanUpdateFields(row);
      creates.push(fields);
      createdKeys.push(key);
    }
  }
  return {
    planned: rows.length,
    created: await batchCreate(client, tableName, tableId, creates),
    updated: await batchUpdate(client, tableName, tableId, updates),
    created_key_count: createdKeys.length,
    updated_key_count: updatedKeys.length,
    skipped_unchanged_count: skippedUnchanged,
    key_display_limit: REPORT_KEY_LIMIT,
    created_keys: createdKeys.slice(0, REPORT_KEY_LIMIT),
    updated_keys: updatedKeys.slice(0, REPORT_KEY_LIMIT),
  };
}

function normalizeProjectOverview(record) {
  const fields = record.fields || {};
  return {
    recordId: record.record_id,
    projectNo: textValue(fields['项目编号']),
    projectName: textValue(fields['项目名称']),
    projectCategory: textValue(fields['项目分类管理']),
    projectStatus: textValue(fields['项目状态']),
    establishmentAmount: numberValue(fields['立项金额']) || 0,
    establishmentCost: numberValue(fields['立项成本']) || 0,
    settlementAmount: numberValue(fields['结算金额']) || 0,
    settlementCost: numberValue(fields['结算成本']) || 0,
    poAmount: numberValue(fields['PO金额']) || 0,
    actualPaymentAmount: numberValue(fields['累计实际付款金额']) || 0,
    invoicedAmount: numberValue(fields['已开票金额']) || 0,
    receivedAmount: numberValue(fields['已收款金额']) || 0,
    planInvoiceAmount: numberValue(fields['计划开票总金额']) || 0,
    overdueInvoiceAmount: numberValue(fields['逾期开票金额']) || 0,
    overduePaymentAmount: numberValue(fields['逾期回款金额']) || 0,
    nextPlanDate: timestampValue(fields['下一计划开票日期']),
    nextExpectedPaymentDate: timestampValue(fields['下一预计回款日期']),
  };
}

function dataCompleteness({ projectNo, projectName, manager }) {
  return projectNo && projectName && (Array.isArray(manager) ? manager.length > 0 : Boolean(manager)) ? '完整' : '待补充';
}

function normalizeLedgerProject(source, record) {
  const fields = record.fields || {};
  const projectNo = textValue(fields['项目编号']);
  const establishmentAmount = numberValue(fields['立项金额']);
  const establishmentCost = numberValue(fields['立项成本']);
  const settlementAmount = numberValue(fields['结算金额']);
  const settlementCost = numberValue(fields['结算成本']);
  const poAmount = numberValue(fields['PO成本']);
  const manager = userFieldValue(fields['项目负责人']);
  return {
    projectNo,
    row: {
      '项目编号': projectNo,
      '项目名称': textValue(fields['项目名称']),
      '立项公司': singleSelectValue(fields['立项公司']) || source.company,
      '客户': textValue(fields['客户名称文本']) || textValue(fields['客户关联']),
      '项目类型': multiSelectValue(fields['项目类型']),
      '项目阶段': deriveProjectStages({
        projectNo,
        establishmentAmount,
        establishmentCost,
        settlementAmount,
        settlementCost,
        poAmount,
      }),
      '当前项目负责人': manager,
      '源项目负责人': manager,
      '立项金额': establishmentAmount,
      '立项成本': establishmentCost,
      'PO金额': poAmount,
      '结算金额': settlementAmount,
      '结算成本': settlementCost,
      '已收款金额': numberValue(fields['收款金额']),
      '源记录ID': textValue(fields.SourceID) || record.record_id,
      '数据来源': [source.name],
      '源更新时间': NOW,
      '最后同步时间': NOW,
      '同步状态': '正常',
      '数据完整性状态': dataCompleteness({ projectNo, projectName: textValue(fields['项目名称']), manager }),
      '项目编号异常': projectNo ? '正常' : '缺失',
    },
  };
}

function normalizeEstablishmentProject(record) {
  const fields = record.fields || {};
  const projectNo = textValue(fields['项目编号']);
  const establishmentAmount = numberValue(fields['项目立项_立项金额']) || numberValue(fields['预立项_预立项金额']);
  const establishmentCost = numberValue(fields['项目立项_立项成本']) || numberValue(fields['预立项_预立项成本']);
  const settlementAmount = numberValue(fields['项目结算_结算金额（开票）']);
  const settlementCost = numberValue(fields['项目结算_结算成本']);
  const manager = userFieldValue(fields['团队信息_项目负责人']);
  const establishmentProfitRate = numberValue(fields['项目立项_立项毛利率']);
  const settlementProfitRate = numberValue(fields['项目结算_结算毛利率']);
  return {
    projectNo,
    row: {
      '项目编号': projectNo,
      '项目名称': textValue(fields['项目名称']),
      '立项公司': singleSelectValue(fields['立项公司']),
      '客户': textValue(fields['客户名称']),
      '项目类型': multiSelectValue(fields['项目类型']),
      '项目阶段': deriveProjectStages({
        projectNo,
        establishmentAmount,
        establishmentCost,
        settlementAmount,
        settlementCost,
      }),
      '项目描述': textValue(fields['项目描述']),
      '当前项目负责人': manager,
      '源项目负责人': manager,
      '立项金额': establishmentAmount,
      '立项成本': establishmentCost,
      '结算金额': settlementAmount,
      '结算成本': settlementCost,
      '立项毛利': numberValue(fields['项目立项_立项毛利']),
      '立项毛利率': establishmentProfitRate,
      '立项毛利率预警': deriveProfitRateWarning({ amount: establishmentAmount, rate: establishmentProfitRate }),
      '结算毛利': numberValue(fields['项目结算_结算毛利']),
      '结算毛利率': settlementProfitRate,
      '结算毛利率预警': deriveProfitRateWarning({ amount: settlementAmount, rate: settlementProfitRate }),
      '源记录ID': textValue(fields.SourceID) || record.record_id,
      '数据来源': ['源_立项申请'],
      '源更新时间': NOW,
      '最后同步时间': NOW,
      '同步状态': '正常',
      '数据完整性状态': dataCompleteness({ projectNo, projectName: textValue(fields['项目名称']), manager }),
      '项目编号异常': projectNo ? '正常' : '缺失',
    },
  };
}

function mergeProjectRows(projectRows) {
  const rowsByProjectNo = new Map();
  for (const item of projectRows) {
    if (!item.projectNo) continue;
    const existing = rowsByProjectNo.get(item.projectNo) || {};
    const merged = { ...existing };
    for (const [key, value] of Object.entries(item.row)) {
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
      if (key === '数据来源') {
        merged[key] = [...new Set([...(merged[key] || []), ...value])];
        continue;
      }
      merged[key] = value;
    }
    rowsByProjectNo.set(item.projectNo, merged);
  }
  return [...rowsByProjectNo.values()];
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
    dataSource: '源立项开票计划',
  };
}

function normalizeOldPlanSource(record) {
  const fields = record.fields || {};
  const projectNo = textValue(fields['项目编号']);
  const period = numberValue(fields['开票期次']);
  const planCount = numberValue(fields['预计开票总次数']) || numberValue(fields['开票总次数']);
  return {
    sourceId: textValue(fields['源记录键']) || record.record_id,
    applicationNo: '',
    applicationStatus: '人工补录',
    projectNo,
    projectName: textValue(fields['项目名称']),
    customerName: '',
    period,
    planKey: buildPlanUniqueKey({ projectNo, period }),
    planCount,
    planDate: timestampValue(fields['计划开票日期']),
    planAmount: numberValue(fields['计划开票金额']) || 0,
    expectedPaymentDate: timestampValue(fields['预计回款日期']),
    dataSource: '旧项目开票计划补录',
    remark: textValue(fields['备注']) || textValue(fields['发票备注']) || textValue(fields['生成状态']),
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

function normalizeSupplierPayment(record) {
  const fields = record.fields || {};
  return {
    projectNo: textValue(fields['项目编号']),
    paymentAmount: numberValue(fields['付款金额']) || 0,
    actualPaymentAmount: numberValue(fields['实际付款金额']) || 0,
    paymentStatus: textValue(fields['付款状态']),
  };
}

function normalizeProjectProgress(record) {
  const fields = record.fields || {};
  return {
    recordId: record.record_id,
    projectNo: textValue(fields['项目编号']),
    taskName: textValue(fields['任务名称']),
    taskStatus: textValue(fields['任务状态']),
    riskLevel: textValue(fields['风险等级']),
  };
}

function openRiskCountByProject(progressRows) {
  const result = new Map();
  for (const row of progressRows) {
    if (!row.projectNo) continue;
    if (!['低', '中', '高'].includes(row.riskLevel)) continue;
    if (['已完成', '已取消'].includes(row.taskStatus)) continue;
    result.set(row.projectNo, (result.get(row.projectNo) || 0) + 1);
  }
  return result;
}

function attachProjectRisks(projects, progressRows) {
  const counts = openRiskCountByProject(progressRows);
  return projects.map((project) => ({
    ...project,
    openRiskCount: counts.get(project.projectNo) || 0,
  }));
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

function oldPlanRows(rows) {
  const rowsByKey = new Map();
  let skipped = 0;
  for (const row of rows) {
    if (!row.projectNo || !row.period) {
      skipped += 1;
      continue;
    }
    rowsByKey.set(row.planKey, row);
  }
  return {
    rows: [...rowsByKey.values()],
    stats: {
      old_project_plan_rows: rowsByKey.size,
      old_project_plan_skipped_rows: skipped,
    },
  };
}

function mergePlanRows(sourceRows, manualRows) {
  const rowsByKey = new Map();
  for (const row of sourceRows) rowsByKey.set(row.planKey, row);
  for (const row of manualRows) rowsByKey.set(row.planKey, row);
  return [...rowsByKey.values()];
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

function buildPlanRows(plans, detailRecordIdsByKey, invoicesByKey) {
  return plans.map((plan) => {
    const linkedInvoiceRecordIds = (plan.linkedInvoiceKeys || [])
      .map((key) => detailRecordIdsByKey.get(key))
      .filter(Boolean);
    const invoiceNos = [...new Set((plan.linkedInvoiceKeys || [])
      .map((key) => invoicesByKey.get(key)?.displayInvoiceNo || invoicesByKey.get(key)?.invoiceNo)
      .filter(Boolean))];
    return {
      '计划唯一键': plan.planKey,
      '关联项目': linkField(plan.projectRecordId),
      '关联发票': linkedInvoiceRecordIds.length ? linkField(linkedInvoiceRecordIds, true) : [],
      '发票编号': invoiceNos.join('、'),
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
      '实际开票日期': plan.actualInvoiceDate ?? null,
      '实际收款日期': plan.paymentDate ?? null,
      '未开票金额': plan.uninvoicedAmount,
      '未收款金额': plan.unpaidAmount,
      '开票差异金额': Number((Number(plan.actualInvoiceAmount || 0) - Number(plan.planAmount || 0)).toFixed(2)),
      '开票逾期天数': plan.invoiceOverdueDays,
      '回款逾期天数': plan.paymentOverdueDays,
      '异常原因': plan.diffStatus === '金额异常待确认' ? '实际开票金额超过计划开票金额，需人工确认。' : '',
      '数据来源': plan.dataSource || '源立项开票计划',
      '最后同步时间': NOW,
    };
  });
}

function buildInvoicePlanLinkUpdates(matchedInvoices, detailRecordIdsByKey, planRecordIdsByKey) {
  return matchedInvoices.flatMap((invoice) => {
    const detailRecordId = detailRecordIdsByKey.get(invoice.detailKey);
    const planRecordId = invoice.linkedPlanKey ? planRecordIdsByKey.get(invoice.linkedPlanKey) : undefined;
    if (!detailRecordId) return [];
    return [{
      record_id: detailRecordId,
      fields: {
        '关联计划': planRecordId ? linkField(planRecordId) : [],
        '匹配状态': invoice.matchStatus,
      },
    }];
  });
}

function staleInvoiceDetailRecordIds(existingDetailRows, currentDetailRows) {
  const currentKeys = new Set(currentDetailRows.map((row) => textValue(row['明细唯一键'])).filter(Boolean));
  return existingDetailRows.flatMap((row) => {
    const key = textValue(row.fields?.['明细唯一键']);
    if (!key || currentKeys.has(key)) return [];
    return [row.record_id];
  });
}

function buildProjectOverviewUpdateRows(projects, matched) {
  return buildProjectOverviewMetricRows({
    projects,
    plans: matched.plans,
    invoices: matched.invoices,
    today: NOW,
  });
}

function buildProjectOverviewUpdates(projects, matched) {
  return buildProjectOverviewUpdateRows(projects, matched).map((row) => ({
    record_id: row.recordId,
    fields: cleanFields(row.fields),
  }));
}

function paymentAmountByProject(payments) {
  const result = new Map();
  for (const payment of payments) {
    if (!payment.projectNo) continue;
    const current = result.get(payment.projectNo) || 0;
    result.set(payment.projectNo, current + Number(payment.actualPaymentAmount || 0));
  }
  return result;
}

function attachProjectPayments(projects, payments) {
  const actualPaymentByProject = paymentAmountByProject(payments);
  return projects.map((project) => ({
    ...project,
    actualPaymentAmount: actualPaymentByProject.get(project.projectNo) ?? project.actualPaymentAmount,
  }));
}

function buildProjectProgressCreateRows(projects, progressRows) {
  const existingProjectNos = new Set(progressRows.map((row) => row.projectNo).filter(Boolean));
  const rows = [];
  for (const project of projects) {
    if (!project.recordId || !project.projectNo) continue;
    if (project.projectCategory !== '经营项目') continue;
    if (existingProjectNos.has(project.projectNo)) continue;
    rows.push({
      '任务名称': project.projectName || project.projectNo,
      '关联项目': linkField(project.recordId),
      '任务状态': '进行中',
      '风险等级': '无',
    });
    existingProjectNos.add(project.projectNo);
  }
  return rows;
}

async function createProjectProgressRows(client, tableId, rows) {
  const keys = rows.map((row) => textValue(row['任务名称'])).filter(Boolean);
  return {
    planned: rows.length,
    created: await batchCreate(client, TARGET_TABLE_NAMES.projectProgress, tableId, rows),
    created_key_count: keys.length,
    key_display_limit: REPORT_KEY_LIMIT,
    created_keys: keys.slice(0, REPORT_KEY_LIMIT),
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
  const supplierPaymentTableId = tableIds.get(TARGET_TABLE_NAMES.supplierPayment);
  const oldProjectPlanTableId = tableIds.get(TARGET_TABLE_NAMES.oldProjectPlan);
  const [
    sourceProjects,
    existingProjectOverviewRecords,
    oldProjectPlanRecords,
    supplierPaymentRecords,
    projectProgressRecords,
    projectLedgerGroups,
    ...invoiceSources
  ] = await Promise.all([
    searchAll(client, APP_TOKEN, SOURCE_TABLES.establishment, ESTABLISHMENT_FIELDS),
    searchAll(client, APP_TOKEN, tableIds.get(TARGET_TABLE_NAMES.projectOverview), PROJECT_OVERVIEW_FIELDS),
    oldProjectPlanTableId ? searchAll(client, APP_TOKEN, oldProjectPlanTableId, OLD_PROJECT_PLAN_FIELDS) : [],
    supplierPaymentTableId ? searchAll(client, APP_TOKEN, supplierPaymentTableId, SUPPLIER_PAYMENT_FIELDS) : [],
    searchAll(client, APP_TOKEN, tableIds.get(TARGET_TABLE_NAMES.projectProgress), PROJECT_PROGRESS_FIELDS),
    Promise.all(SOURCE_TABLES.projectLedgers.map((source) => searchAll(client, APP_TOKEN, source.id)
      .then((records) => records.map((record) => normalizeLedgerProject(source, record))))),
    ...SOURCE_TABLES.invoices.map((source) => searchAll(client, APP_TOKEN, source.id, INVOICE_FIELDS)
      .then((records) => records.map((record) => normalizeInvoice(source, record)))),
  ]);

  const sourcePlans = sourcePlanRows(sourceProjects.map(normalizePlanSource));
  const manualOldPlans = oldPlanRows(oldProjectPlanRecords.map(normalizeOldPlanSource));
  const projectOverviewSourceRows = mergeProjectRows([
    ...projectLedgerGroups.flat(),
    ...sourceProjects
      .filter((record) => textValue(record.fields?.['申请状态']) === '已通过')
      .map(normalizeEstablishmentProject),
  ]);
  const projectOverviewResult = await upsertByKey(
    client,
    TARGET_TABLE_NAMES.projectOverview,
    tableIds.get(TARGET_TABLE_NAMES.projectOverview),
    projectOverviewSourceRows,
    '项目编号',
    { createOnlyFields: ['当前项目负责人', '项目参与人员', '项目阶段', '已收款金额'] },
  );

  const projectOverviewRecords = DRY_RUN
    ? existingProjectOverviewRecords
    : await searchAll(client, APP_TOKEN, tableIds.get(TARGET_TABLE_NAMES.projectOverview), PROJECT_OVERVIEW_FIELDS);
  const supplierPayments = supplierPaymentRecords.map(normalizeSupplierPayment);
  const projectProgressRows = projectProgressRecords.map(normalizeProjectProgress);
  const projectOverviewRows = attachProjectRisks(
    attachProjectPayments(projectOverviewRecords.map(normalizeProjectOverview), supplierPayments),
    projectProgressRows,
  );
  const projectProgressCreateRows = buildProjectProgressCreateRows(projectOverviewRows, projectProgressRows);
  const projectProgressResult = await createProjectProgressRows(
    client,
    tableIds.get(TARGET_TABLE_NAMES.projectProgress),
    projectProgressCreateRows,
  );
  const { plans, invoices } = attachProjects(
    mergePlanRows(sourcePlans.rows, manualOldPlans.rows),
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

  const detailRecordIdsByKey = await readKeyMap(client, tableIds.get(TARGET_TABLE_NAMES.invoiceDetail), '明细唯一键');

  const invoicesByKey = new Map(matched.invoices.map((invoice) => [invoice.detailKey, invoice]));
  const planRows = buildPlanRows(matched.plans, detailRecordIdsByKey, invoicesByKey);
  const planResult = await upsertByKey(
    client,
    TARGET_TABLE_NAMES.invoicePlan,
    tableIds.get(TARGET_TABLE_NAMES.invoicePlan),
    planRows,
    '计划唯一键',
    {
      clearableFields: [
        '关联发票',
        '发票编号',
        '实际开票日期',
        '实际收款日期',
        '异常原因',
      ],
    },
  );

  const planRecordIdsByKey = await readKeyMap(client, tableIds.get(TARGET_TABLE_NAMES.invoicePlan), '计划唯一键');
  const plannedDetailPlanLinkUpdates = buildInvoicePlanLinkUpdates(matched.invoices, detailRecordIdsByKey, planRecordIdsByKey);
  const detailRecordsById = await readRecordMapById(
    client,
    tableIds.get(TARGET_TABLE_NAMES.invoiceDetail),
    ['关联计划', '匹配状态'],
  );
  const detailPlanLinkChanges = changedRecordUpdates(detailRecordsById, plannedDetailPlanLinkUpdates, {
    clearableFields: ['关联计划'],
  });
  const detailPlanLinkUpdates = detailPlanLinkChanges.updates;
  const linkedDetails = await batchUpdate(
    client,
    TARGET_TABLE_NAMES.invoiceDetail,
    tableIds.get(TARGET_TABLE_NAMES.invoiceDetail),
    detailPlanLinkUpdates,
  );
  const existingInvoiceDetailRows = await searchAll(
    client,
    APP_TOKEN,
    tableIds.get(TARGET_TABLE_NAMES.invoiceDetail),
    INVOICE_DETAIL_STALE_FIELDS,
  );
  const staleInvoiceDetailIds = staleInvoiceDetailRecordIds(existingInvoiceDetailRows, invoiceRows);
  const staleDetails = await batchDelete(
    client,
    TARGET_TABLE_NAMES.invoiceDetail,
    tableIds.get(TARGET_TABLE_NAMES.invoiceDetail),
    staleInvoiceDetailIds,
  );
  const projectOverviewUpdateRows = buildProjectOverviewUpdateRows(projectOverviewRows, matched);
  const plannedProjectOverviewUpdates = projectOverviewUpdateRows.map((row) => ({
    record_id: row.recordId,
    fields: cleanFields(row.fields),
  }));
  const projectOverviewRecordsById = new Map(projectOverviewRecords.map((record) => [record.record_id, record]));
  const projectOverviewChanges = changedRecordUpdates(projectOverviewRecordsById, plannedProjectOverviewUpdates);
  const projectOverviewUpdates = projectOverviewChanges.updates;
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
      old_project_plan_rows: manualOldPlans.rows.length,
      source_invoice_rows: invoiceRows.length,
      matched_invoice_rows: matched.invoices.filter((invoice) => invoice.linkedPlanKey).length,
      offset_invoice_rows: matched.invoices.filter((invoice) => invoice.offsetStatus === '已抵消').length,
      unmatched_invoice_rows: matched.invoices.filter((invoice) => ['未匹配项目', '计划外开票', '红冲待确认'].includes(invoice.matchStatus)).length,
      amount_exception_plan_rows: matched.plans.filter((plan) => plan.matchStatus === '金额异常待确认').length,
      project_overview_updates: projectOverviewUpdates.length,
      project_overview_unchanged_rows: projectOverviewChanges.skipped.length,
      project_progress_created_candidates: projectProgressCreateRows.length,
      stale_invoice_detail_rows: staleInvoiceDetailIds.length,
      ...sourcePlans.stats,
      ...manualOldPlans.stats,
    },
    upsert: {
      project_overview_sources: projectOverviewResult,
      invoice_detail: invoiceResult,
      invoice_plan: planResult,
      invoice_detail_plan_links: {
        planned: plannedDetailPlanLinkUpdates.length,
        updated: linkedDetails,
        updated_key_count: detailPlanLinkUpdates.length,
        skipped_unchanged_count: detailPlanLinkChanges.skipped.length,
      },
      stale_invoice_details: {
        planned: staleInvoiceDetailIds.length,
        deleted: staleDetails,
        deleted_key_count: staleInvoiceDetailIds.length,
        key_display_limit: REPORT_KEY_LIMIT,
        deleted_keys: staleInvoiceDetailIds.slice(0, REPORT_KEY_LIMIT),
      },
      project_overview: {
        planned: plannedProjectOverviewUpdates.length,
        updated: projectOverviewUpdateResult,
        updated_key_count: projectOverviewUpdates.length,
        skipped_unchanged_count: projectOverviewChanges.skipped.length,
        key_display_limit: REPORT_KEY_LIMIT,
        updated_keys: projectOverviewUpdateRows
          .filter((row) => projectOverviewUpdates.some((update) => update.record_id === row.recordId))
          .map((row) => row.projectNo)
          .filter(Boolean)
          .slice(0, REPORT_KEY_LIMIT),
      },
      project_progress: projectProgressResult,
    },
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
