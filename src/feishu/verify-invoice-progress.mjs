#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_TOKEN,
  SOURCE_TABLES,
  TARGET_TABLE_NAMES,
} from '../config.mjs';
import {
  buildInvoiceDetailKey,
  disambiguateInvoiceDetailKeys,
  markOffsetInvoices,
  normalizeInvoiceNo,
  resolveProjectPreEstablishmentAmount,
} from '../rules/invoice-progress-rules.mjs';
import {
  callJson,
  connectFeishu,
  numberValue,
  searchAll,
  textValue,
  timestampValue,
} from './client.mjs';

const REPORT_PATH = process.env.INVOICE_VERIFICATION_REPORT_PATH
  || fileURLToPath(new URL('../../docs/trial-results/2026-07-31-invoice-model-verification.md', import.meta.url));

const SOURCE_INVOICE_FIELDS = [
  '发票号码',
  '项目编号',
  '项目名称',
  '客户名称',
  '开票日期',
  '开票额',
  '收款额',
  'SourceID',
];

const PROJECT_OVERVIEW_VERIFY_FIELDS = [
  '项目编号',
  '项目分类管理',
  '立项公司',
  '预立项金额',
];

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
  return new Map(tables.map((table) => [table.name, table.table_id]));
}

function duplicateValues(rows, fieldName) {
  const counts = new Map();
  for (const row of rows) {
    const value = textValue(row.fields?.[fieldName]);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

function duplicateSourceKeys(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.detailKey) continue;
    const group = groups.get(row.detailKey) || [];
    group.push(row);
    groups.set(row.detailKey, group);
  }
  return [...groups]
    .filter(([, group]) => group.length > 1)
    .map(([value, group]) => ({
      value,
      count: group.length,
      projects: group.map((row) => row.projectNo).filter(Boolean),
      amounts: group.map((row) => row.invoiceAmount),
    }));
}

function sum(rows, fieldName) {
  return rows.reduce((total, row) => total + (numberValue(row.fields?.[fieldName]) || 0), 0);
}

function normalizeSourceInvoice(source, record) {
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
    invoiceDate: timestampValue(fields['开票日期']),
    invoiceAmount: numberValue(fields['开票额']) || 0,
    receivedAmount: numberValue(fields['收款额']) || 0,
  };
  return {
    ...base,
    detailKey: buildInvoiceDetailKey(base),
  };
}

function markdown(report, samples) {
  return `# 开票计划与统一明细验证结果

生成时间：${new Date().toISOString()}

## 总览

- 验证结果：${report.pass ? '通过' : '未通过'}
- 项目开票计划表记录数：${report.counts.invoice_plan}
- 开票明细统一表记录数：${report.counts.invoice_detail}
- 旧项目补录记录数（只读检查）：${report.counts.old_project_plan}
- 源发票记录数：${report.counts.source_invoices}
- 统一明细纳入统计开票金额：${report.amounts.detail_included_invoice}
- 源发票抵消后纳入统计开票金额：${report.amounts.source_included_invoice}
- 统一明细纳入统计收款金额：${report.amounts.detail_included_received}
- 源发票抵消后纳入统计收款金额：${report.amounts.source_included_received}

## 关键检查

${report.checks.map((check) => `- ${check.pass ? '通过' : '失败'}：${check.name}${check.detail ? `。${check.detail}` : ''}`).join('\n')}

## 样例

### 金额异常待确认

\`\`\`json
${JSON.stringify(samples.amountExceptionRows, null, 2)}
\`\`\`

### Hankook

\`\`\`json
${JSON.stringify(samples.hankookRows, null, 2)}
\`\`\`

## 失败项

\`\`\`json
${JSON.stringify(report.failures, null, 2)}
\`\`\`
`;
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTableRecord.search',
]);

try {
  const tableIds = await tableIdByName(client);
  const failures = [];
  const checks = [];
  function check(name, pass, detail = '') {
    checks.push({ name, pass, detail });
    if (!pass) failures.push({ name, detail });
  }

  const planTableId = tableIds.get(TARGET_TABLE_NAMES.invoicePlan);
  const detailTableId = tableIds.get(TARGET_TABLE_NAMES.invoiceDetail);
  const projectOverviewTableId = tableIds.get(TARGET_TABLE_NAMES.projectOverview);
  const oldPlanTableId = tableIds.get(TARGET_TABLE_NAMES.oldProjectPlan);
  check('项目开票计划表存在', Boolean(planTableId), planTableId || 'missing');
  check('开票明细统一表存在', Boolean(detailTableId), detailTableId || 'missing');

  const [planRows, detailRows, projectOverviewRows, oldPlanRows, sourceInvoices, preEstablishmentLedgers] = await Promise.all([
    planTableId ? searchAll(client, APP_TOKEN, planTableId) : [],
    detailTableId ? searchAll(client, APP_TOKEN, detailTableId) : [],
    projectOverviewTableId ? searchAll(client, APP_TOKEN, projectOverviewTableId, PROJECT_OVERVIEW_VERIFY_FIELDS) : [],
    oldPlanTableId ? searchAll(client, APP_TOKEN, oldPlanTableId, ['记录标识']) : [],
    Promise.all(SOURCE_TABLES.invoices.map((source) => searchAll(client, APP_TOKEN, source.id, SOURCE_INVOICE_FIELDS)
      .then((records) => records.map((record) => normalizeSourceInvoice(source, record)))))
      .then((groups) => disambiguateInvoiceDetailKeys(groups.flat())),
    Promise.all(SOURCE_TABLES.projectLedgers.filter((source) => source.company !== '冶堂').map(async (source) => {
      const records = await searchAll(client, APP_TOKEN, source.id, ['项目编号', '预立项金额']);
      return records.map((record) => ({
        sourceName: source.name,
        projectNo: textValue(record.fields?.['项目编号']),
        amount: numberValue(record.fields?.['预立项金额']),
      }));
    })).then((groups) => groups.flat()),
  ]);

  const blankPlanKeys = planRows.filter((row) => !textValue(row.fields?.['计划唯一键']));
  const blankDetailKeys = detailRows.filter((row) => !textValue(row.fields?.['明细唯一键']));
  const duplicatePlanKeys = duplicateValues(planRows, '计划唯一键');
  const duplicateDetailKeys = duplicateValues(detailRows, '明细唯一键');
  const duplicateSourceInvoiceKeys = duplicateSourceKeys(sourceInvoices);

  const offsetSources = markOffsetInvoices(sourceInvoices);
  const includedSourceInvoices = offsetSources.filter((invoice) => invoice.includedInStats);
  const includedDetails = detailRows.filter((row) => textValue(row.fields?.['是否纳入统计']) === '是');
  const sourceDetailKeys = new Set(sourceInvoices.map((invoice) => invoice.detailKey).filter(Boolean));
  const staleDetailKeys = detailRows
    .map((row) => textValue(row.fields?.['明细唯一键']))
    .filter((key) => key && !sourceDetailKeys.has(key));
  const detailsByKey = new Map(detailRows.map((row) => [textValue(row.fields?.['明细唯一键']), row]));
  const missingSourceKeys = sourceInvoices.filter((invoice) => !detailsByKey.has(invoice.detailKey));
  const mismatchedDetailRows = sourceInvoices.flatMap((invoice) => {
    const row = detailsByKey.get(invoice.detailKey);
    if (!row) return [];
    const fields = row.fields || {};
    const different = [];
    if (textValue(fields['项目编号']) !== invoice.projectNo) different.push('项目编号');
    if (Math.abs((numberValue(fields['开票金额']) || 0) - invoice.invoiceAmount) >= 0.01) different.push('开票金额');
    if (Math.abs((numberValue(fields['收款金额']) || 0) - invoice.receivedAmount) >= 0.01) different.push('收款金额');
    if (invoice.duplicateInvoiceNote && !textValue(fields['备注']).includes(invoice.duplicateInvoiceNote)) different.push('跨项目备注');
    return different.length ? [{ key: invoice.detailKey, fields: different }] : [];
  });

  const sourceIncludedInvoice = includedSourceInvoices.reduce((total, invoice) => total + (invoice.invoiceAmount || 0), 0);
  const sourceIncludedReceived = includedSourceInvoices.reduce((total, invoice) => total + (invoice.receivedAmount || 0), 0);
  const detailIncludedInvoice = sum(includedDetails, '开票金额');
  const detailIncludedReceived = sum(includedDetails, '收款金额');

  const adminInDashboardRows = detailRows.filter((row) => (
    textValue(row.fields?.['项目分类管理']) === '行政/内部项目'
    && ['经营项目总览', '走账项目总览'].includes(textValue(row.fields?.['老板驾驶舱分组']))
  ));
  const hankookRows = detailRows.filter((row) => textValue(row.fields?.['客户名称']) === 'Hankook & Company Co., Ltd');
  const badHankookRows = hankookRows.filter((row) => textValue(row.fields?.['发票编号显示值']) !== 'Hankook 001');
  const amountExceptionRows = planRows.filter((row) => textValue(row.fields?.['匹配状态']) === '金额异常待确认');
  const preEstablishmentByProject = new Map();
  for (const row of preEstablishmentLedgers) {
    if (!row.projectNo) continue;
    preEstablishmentByProject.set(row.projectNo, [...(preEstablishmentByProject.get(row.projectNo) || []), row]);
  }
  const preEstablishmentMismatches = projectOverviewRows.flatMap((row) => {
    const projectNo = textValue(row.fields?.['项目编号']);
    const expected = resolveProjectPreEstablishmentAmount({
      companyName: textValue(row.fields?.['立项公司']),
      ledgerRows: preEstablishmentByProject.get(projectNo),
    });
    const actual = numberValue(row.fields?.['预立项金额']);
    const matches = expected === null ? actual === undefined : actual !== undefined && Math.abs(actual - expected) < 0.01;
    return matches ? [] : [{ projectNo, expected, actual: actual ?? null }];
  });

  check('计划唯一键不为空', blankPlanKeys.length === 0, `blank=${blankPlanKeys.length}`);
  check('明细唯一键不为空', blankDetailKeys.length === 0, `blank=${blankDetailKeys.length}`);
  check('计划唯一键不重复', duplicatePlanKeys.length === 0, JSON.stringify(duplicatePlanKeys.slice(0, 5)));
  check('明细唯一键不重复', duplicateDetailKeys.length === 0, JSON.stringify(duplicateDetailKeys.slice(0, 5)));
  check('源发票按项目区分后的明细标识不重复', duplicateSourceInvoiceKeys.length === 0, JSON.stringify(duplicateSourceInvoiceKeys.slice(0, 5)));
  check('每条源发票均有对应统一明细', missingSourceKeys.length === 0, JSON.stringify(missingSourceKeys.map((row) => row.detailKey).slice(0, 5)));
  check('逐条项目归属金额及跨项目备注一致', mismatchedDetailRows.length === 0, JSON.stringify(mismatchedDetailRows.slice(0, 5)));
  check('统一明细开票金额等于源发票抵消后金额', Math.abs(detailIncludedInvoice - sourceIncludedInvoice) < 0.01, `detail=${detailIncludedInvoice}, source=${sourceIncludedInvoice}`);
  check('统一明细收款金额等于源发票抵消后金额', Math.abs(detailIncludedReceived - sourceIncludedReceived) < 0.01, `detail=${detailIncludedReceived}, source=${sourceIncludedReceived}`);
  check('统一明细不存在源表已删除记录', staleDetailKeys.length === 0, JSON.stringify(staleDetailKeys.slice(0, 5)));
  check('行政/内部项目不进入老板驾驶舱经营或走账分组', adminInDashboardRows.length === 0, `rows=${adminInDashboardRows.length}`);
  check('Hankook 空发票号使用默认显示值', badHankookRows.length === 0, `bad=${badHankookRows.length}, hankook=${hankookRows.length}`);
  check('预立项金额对应集熠亦所台账且冶堂为空', preEstablishmentMismatches.length === 0, JSON.stringify(preEstablishmentMismatches.slice(0, 5)));

  const report = {
    pass: failures.length === 0,
    counts: {
      invoice_plan: planRows.length,
      invoice_detail: detailRows.length,
      old_project_plan: oldPlanRows.length,
      source_invoices: sourceInvoices.length,
      amount_exception_plan_rows: amountExceptionRows.length,
      offset_source_rows: offsetSources.filter((invoice) => invoice.offsetStatus === '已抵消').length,
    },
    amounts: {
      detail_included_invoice: Number(detailIncludedInvoice.toFixed(2)),
      source_included_invoice: Number(sourceIncludedInvoice.toFixed(2)),
      detail_included_received: Number(detailIncludedReceived.toFixed(2)),
      source_included_received: Number(sourceIncludedReceived.toFixed(2)),
    },
    checks,
    failures,
    report_path: REPORT_PATH,
  };

  const compact = (rows) => rows.slice(0, 8).map((row) => ({
    计划唯一键: textValue(row.fields?.['计划唯一键']),
    明细唯一键: textValue(row.fields?.['明细唯一键']),
    项目编号: textValue(row.fields?.['项目编号']),
    项目名称: textValue(row.fields?.['项目名称']),
    客户名称: textValue(row.fields?.['客户名称']),
    发票编号显示值: textValue(row.fields?.['发票编号显示值']),
    计划开票金额: numberValue(row.fields?.['计划开票金额']),
    实际开票金额: numberValue(row.fields?.['实际开票金额']),
    匹配状态: textValue(row.fields?.['匹配状态']),
  }));

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, markdown(report, {
    amountExceptionRows: compact(amountExceptionRows),
    hankookRows: compact(hankookRows),
  }));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  await client.close();
}
