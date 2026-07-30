#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  APP_TOKEN,
  SOURCE_TABLES,
  TARGET_TABLE_NAMES,
} from '../config.mjs';
import {
  callJson,
  connectFeishu,
  numberValue,
  searchAll,
  textValue,
} from './client.mjs';

const REPORT_PATH = fileURLToPath(new URL('../../docs/trial-results/2026-07-30-invoice-progress-verification.md', import.meta.url));

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
  const byName = new Map(tables.map((table) => [table.name, table.table_id]));
  for (const name of Object.values(TARGET_TABLE_NAMES)) {
    if (!byName.has(name)) throw new Error(`Target table not found: ${name}`);
  }
  return byName;
}

function sum(rows, fieldName) {
  return rows.reduce((total, row) => total + (numberValue(row.fields?.[fieldName]) || 0), 0);
}

function projectRows(rows, matcher) {
  return rows.filter((row) => {
    const fields = row.fields || {};
    return matcher({
      projectNo: textValue(fields['项目编号']),
      projectName: textValue(fields['项目名称']),
      sourceKey: textValue(fields['记录标题']),
    });
  });
}

function compactRows(rows) {
  return rows.slice(0, 8).map((row) => ({
    项目编号: textValue(row.fields?.['项目编号']),
    项目名称: textValue(row.fields?.['项目名称']),
    当前执行期次: numberValue(row.fields?.['当前执行期次']),
    当前计划开票金额: numberValue(row.fields?.['当前计划开票金额']),
    实际开票金额: numberValue(row.fields?.['实际开票金额']),
    回款金额: numberValue(row.fields?.['回款金额']),
    开票状态: textValue(row.fields?.['开票状态']),
    回款状态: textValue(row.fields?.['回款状态']),
    综合状态: textValue(row.fields?.['综合状态']),
    差异状态: textValue(row.fields?.['差异状态']),
    生成状态: textValue(row.fields?.['生成状态']),
  }));
}

function linkRecordIds(value) {
  return Array.isArray(value?.link_record_ids) ? value.link_record_ids : [];
}

function markdown(report, samples) {
  return `# 项目开票进度试运行验证结果

生成时间：${new Date().toISOString()}

## 总览

- 验证结果：${report.pass ? '通过' : '未通过'}
- 项目开票进度表记录数：${report.counts.invoice_progress}
- 开票明细归集记录数：${report.counts.invoice_collection}
- 旧项目补录记录数：${report.counts.old_project_plan}
- 源发票记录数：${report.counts.source_invoices}
- 试运行表回款金额合计：${report.amounts.progress_received}
- 发票归集回款金额合计：${report.amounts.collection_received}
- 源发票回款金额合计：${report.amounts.source_invoice_received}
- 待人工确认/补充记录数：${report.counts.manual_confirmation}
- 实际拆分开票记录数：${report.counts.split_rows}

## 关键检查

${report.checks.map((check) => `- ${check.pass ? '通过' : '失败'}：${check.name}${check.detail ? `。${check.detail}` : ''}`).join('\n')}

## 样例记录

### 2026韩泰轮胎专项费用

\`\`\`json
${JSON.stringify(samples.hankook, null, 2)}
\`\`\`

### 202607270009 / YS260727LUFFY

\`\`\`json
${JSON.stringify(samples.application009, null, 2)}
\`\`\`

### 202607270012 / E26 TEST

\`\`\`json
${JSON.stringify(samples.application012, null, 2)}
\`\`\`

### 实际拆分开票

\`\`\`json
${JSON.stringify(samples.splitRows, null, 2)}
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
  const [progress, collection, oldPlan, sourceInvoiceRecords] = await Promise.all([
    searchAll(client, APP_TOKEN, tableIds.get(TARGET_TABLE_NAMES.invoiceProgressTrial)),
    searchAll(client, APP_TOKEN, tableIds.get(TARGET_TABLE_NAMES.invoiceCollection)),
    searchAll(client, APP_TOKEN, tableIds.get(TARGET_TABLE_NAMES.oldProjectPlan)),
    Promise.all(SOURCE_TABLES.invoices.map((source) => searchAll(client, APP_TOKEN, source.id, ['收款额']))).then((groups) => groups.flat()),
  ]);

  const failures = [];
  const checks = [];
  function check(name, pass, detail = '') {
    checks.push({ name, pass, detail });
    if (!pass) failures.push({ name, detail });
  }

  const rows009 = projectRows(progress, ({ projectNo }) => projectNo === 'YS260727LUFFY');
  const rows012 = projectRows(progress, ({ projectNo }) => projectNo === 'E26 TEST');
  const testRows = projectRows(progress, ({ projectNo }) => projectNo === 'E2016test');
  const blankKeyRows = progress.filter((row) => !textValue(row.fields?.['记录标题']));
  const manualRows = progress.filter((row) => ['待人工确认', '待人工补充'].includes(textValue(row.fields?.['生成状态'])));
  const splitRows = progress.filter((row) => textValue(row.fields?.['差异状态']) === '实际拆分开票');
  const autoOldPlanRows = oldPlan.filter((row) => textValue(row.fields?.['源记录键']).startsWith('old-plan|'));
  const unlinkedOldPlanRows = autoOldPlanRows.filter((row) => linkRecordIds(row.fields?.['关联项目']).length === 0);

  const sourceInvoiceReceived = sum(sourceInvoiceRecords, '收款额');
  const collectionReceived = sum(collection, '回款金额');
  const progressReceived = sum(progress, '回款金额');

  check('202607270009 作为新项目进入试运行表', rows009.length >= 1, `rows=${rows009.length}`);
  check('202607270006-008 测试记录未进入正式逻辑', testRows.length === 0, `E2016test rows=${testRows.length}`);
  check('每条进度记录都有记录标题', blankKeyRows.length === 0, `blank=${blankKeyRows.length}`);
  check('发票归集回款金额等于源发票收款额', Math.abs(collectionReceived - sourceInvoiceReceived) < 0.01, `collection=${collectionReceived}, source=${sourceInvoiceReceived}`);
  check('202607270012 样例存在', rows012.length >= 1, `rows=${rows012.length}`);
  check('试运行表有待人工确认/补充视图数据', manualRows.length > 0, `manual=${manualRows.length}`);
  check('自动生成的旧项目补录行都已关联项目总览表', unlinkedOldPlanRows.length === 0, `unlinked=${unlinkedOldPlanRows.length}`);

  const report = {
    pass: failures.length === 0,
    counts: {
      invoice_progress: progress.length,
      invoice_collection: collection.length,
      old_project_plan: oldPlan.length,
      source_invoices: sourceInvoiceRecords.length,
      manual_confirmation: manualRows.length,
      split_rows: splitRows.length,
      old_project_plan_unlinked: unlinkedOldPlanRows.length,
    },
    amounts: {
      progress_received: Number(progressReceived.toFixed(2)),
      collection_received: Number(collectionReceived.toFixed(2)),
      source_invoice_received: Number(sourceInvoiceReceived.toFixed(2)),
    },
    checks,
    failures,
    report_path: REPORT_PATH,
  };

  const samples = {
    hankook: compactRows(projectRows(progress, ({ projectName }) => projectName.includes('韩泰'))),
    application009: compactRows(rows009),
    application012: compactRows(rows012),
    splitRows: compactRows(splitRows),
  };

  fs.writeFileSync(REPORT_PATH, markdown(report, samples));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  await client.close();
}
