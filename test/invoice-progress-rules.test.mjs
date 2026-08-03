import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInvoiceCollectionTitle,
  buildInvoiceDetailKey,
  buildOldProjectNodes,
  buildPlanUniqueKey,
  buildProjectOverviewMetricRows,
  buildProgressKey,
  classifyDashboardGroup,
  buildSplitInvoiceNodes,
  classifyApplication,
  collapseReversedInvoices,
  deriveInvoiceStatus,
  deriveOverallStatus,
  derivePaymentStatus,
  deriveProfitRateWarning,
  deriveProjectStatus,
  deriveProjectStages,
  matchInvoicesToPlans,
  normalizeInvoiceNo,
} from '../src/rules/invoice-progress-rules.mjs';

test('cutoff rules are explicit', () => {
  assert.equal(classifyApplication('202607270005'), 'old');
  assert.equal(classifyApplication('202607270006'), 'excluded-test');
  assert.equal(classifyApplication('202607270008'), 'excluded-test');
  assert.equal(classifyApplication('202607270009'), 'new');
});

test('invoice status supports upcoming and overdue reminders', () => {
  const today = Date.UTC(2026, 6, 30);
  assert.equal(deriveInvoiceStatus({ planDate: Date.UTC(2026, 7, 5), planAmount: 100, actualInvoiceAmount: 0, today }), '即将到期开票');
  assert.equal(deriveInvoiceStatus({ planDate: Date.UTC(2026, 6, 29), planAmount: 100, actualInvoiceAmount: 0, today }), '开票逾期');
  assert.equal(deriveInvoiceStatus({ planDate: Date.UTC(2026, 8, 1), planAmount: 100, actualInvoiceAmount: 0, today }), '未到期');
  assert.equal(deriveInvoiceStatus({ planDate: Date.UTC(2026, 6, 1), planAmount: 100, actualInvoiceAmount: 100, today }), '已开票');
});

test('payment status uses invoice detail received amount', () => {
  const today = Date.UTC(2026, 6, 30);
  assert.equal(derivePaymentStatus({ actualInvoiceAmount: 0, receivedAmount: 0, expectedPaymentDate: Date.UTC(2026, 6, 1), today }), '待开票');
  assert.equal(derivePaymentStatus({ actualInvoiceAmount: 100, receivedAmount: 100, expectedPaymentDate: Date.UTC(2026, 6, 1), today }), '已回款');
  assert.equal(derivePaymentStatus({ actualInvoiceAmount: 100, receivedAmount: 20, expectedPaymentDate: Date.UTC(2026, 6, 1), today }), '回款逾期');
});

test('old project with invoices adds a remaining final plan row', () => {
  const rows = buildOldProjectNodes({ projectNo: 'HT2026', approvedAmount: 1000 }, [
    { invoiceNo: 'F1', invoiceDate: 10, invoiceAmount: 200, receivedAmount: 200 },
    { invoiceNo: 'F2', invoiceDate: 20, invoiceAmount: 300, receivedAmount: 0 },
  ]);
  assert.deepEqual(rows.map((row) => row.currentPlanAmount), [200, 300, 500]);
  assert.deepEqual(rows.map((row) => row.generationStatus), ['根据历史发票自动生成', '根据历史发票自动生成', '待人工确认']);
});

test('actual split invoices create actual invoice count rows', () => {
  const rows = buildSplitInvoiceNodes([
    { originalPeriod: 1, originalPlanAmount: 300, originalPlanCount: 2 },
    { originalPeriod: 2, originalPlanAmount: 700, originalPlanCount: 2 },
  ], [
    { invoiceNo: 'F1', invoiceDate: 10, invoiceAmount: 200, receivedAmount: 200 },
    { invoiceNo: 'F2', invoiceDate: 20, invoiceAmount: 300, receivedAmount: 300 },
    { invoiceNo: 'F3', invoiceDate: 30, invoiceAmount: 500, receivedAmount: 0 },
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.currentPlanAmount), [200, 300, 500]);
  assert.deepEqual(rows.map((row) => row.currentPlanCount), [3, 3, 3]);
  assert.equal(rows[0].diffStatus, '实际拆分开票');
});

test('progress key is stable for actual and plan-only rows', () => {
  assert.equal(buildProgressKey({ projectNo: 'P1', executionPeriod: 2, invoiceNo: 'F2' }), 'P1|2|F2');
  assert.equal(buildProgressKey({ projectNo: 'P1', executionPeriod: 2 }), 'P1|2|计划');
});

test('plan key uses project number and period only', () => {
  assert.equal(buildPlanUniqueKey({ projectNo: 'P1', period: 2 }), 'P1-2');
  assert.equal(buildPlanUniqueKey({ projectNo: 'P1' }), 'P1-未定期次');
});

test('dashboard grouping follows manual project classification', () => {
  assert.equal(classifyDashboardGroup('经营项目'), '经营项目总览');
  assert.equal(classifyDashboardGroup('走账项目'), '走账项目总览');
  assert.equal(classifyDashboardGroup('行政/内部项目'), '不纳入');
  assert.equal(classifyDashboardGroup(''), '项目分类待确认');
});

test('project stages are derived from real project progress', () => {
  assert.deepEqual(deriveProjectStages({ projectNo: '' }), ['预立项']);
  assert.deepEqual(deriveProjectStages({
    projectNo: 'P1',
    establishmentAmount: 1000,
    establishmentCost: 600,
  }), ['立项']);
  assert.deepEqual(deriveProjectStages({
    projectNo: 'P1',
    settlementAmount: 1200,
    settlementCost: 700,
    poAmount: 500,
    plannedAmount: 1200,
    invoiceAmount: 1200,
    actualPaymentAmount: 700,
  }), ['立项', '结算', 'PO', '全部开票', '全部付款']);
  assert.deepEqual(deriveProjectStages({
    projectNo: 'P1',
    establishmentAmount: 1000,
    establishmentCost: 600,
    invoiceAmount: 300,
    actualPaymentAmount: 200,
  }), ['立项', '部分开票', '部分付款']);
});

test('project status preserves pause and follows invoice collection progress', () => {
  assert.equal(deriveProjectStatus({ currentStatus: '暂停', projectNo: 'P1' }), '暂停');
  assert.equal(deriveProjectStatus({ currentStatus: '暂缓', projectNo: 'P1' }), '暂缓');
  assert.equal(deriveProjectStatus({ currentStatus: '已终止', projectNo: 'P1' }), '已终止');
  assert.equal(deriveProjectStatus({ currentStatus: '已取消', projectNo: 'P1' }), '已取消');
  assert.equal(deriveProjectStatus({ projectNo: '' }), '未开始');
  assert.equal(deriveProjectStatus({
    projectNo: 'P1',
    plannedAmount: 1000,
    invoiceAmount: 1000,
    receivedAmount: 1000,
  }), '已完成');
  assert.equal(deriveProjectStatus({
    projectNo: 'P1',
    plannedAmount: 1000,
    invoiceAmount: 1000,
    receivedAmount: 200,
  }), '结算中');
  assert.equal(deriveProjectStatus({ projectNo: 'P1' }), '进行中');
});

test('profit rate warning uses decimal rates', () => {
  assert.equal(deriveProfitRateWarning({ amount: 0, rate: 0.7 }), '未计算');
  assert.equal(deriveProfitRateWarning({ amount: 1000, rate: 0 }), '走账项目/异常');
  assert.equal(deriveProfitRateWarning({ amount: 1000, rate: 0.5 }), '低于60%');
  assert.equal(deriveProfitRateWarning({ amount: 1000, rate: 0.6 }), '正常');
});

test('Hankook invoices use default display number when invoice number is blank', () => {
  assert.deepEqual(normalizeInvoiceNo({
    customerName: 'Hankook & Company Co., Ltd',
    invoiceNo: '',
  }), {
    rawInvoiceNo: '',
    displayInvoiceNo: 'Hankook 001',
    invoiceNoMissing: false,
    isHankook: true,
  });
  assert.equal(buildInvoiceDetailKey({
    sourceName: '集熠开票明细',
    projectNo: 'HT2026',
    customerName: 'Hankook & Company Co., Ltd',
    invoiceNo: '',
    sourceId: 'recA',
  }), '集熠开票明细|HT2026|Hankook 001|recA');
});

test('invoice collection titles replace blank first fields', () => {
  assert.equal(
    buildInvoiceCollectionTitle({
      sourceName: '集熠开票明细',
      projectNo: 'E260310YIYI',
      invoiceNo: 'INV-001',
      sourceId: 'recA',
    }),
    '集熠开票明细|E260310YIYI|INV-001',
  );
  assert.equal(
    buildInvoiceCollectionTitle({ sourceName: '冶堂开票明细', sourceId: 'recB' }),
    '冶堂开票明细|recB',
  );
});

test('overall status prioritizes amount, payment and invoice alerts', () => {
  assert.equal(deriveOverallStatus({ diffStatus: '金额异常待核对', invoiceStatus: '已开票', paymentStatus: '已回款' }), '金额异常待核对');
  assert.equal(deriveOverallStatus({ invoiceStatus: '已开票', paymentStatus: '回款逾期' }), '回款逾期');
  assert.equal(deriveOverallStatus({ invoiceStatus: '开票逾期', paymentStatus: '待开票' }), '开票逾期');
  assert.equal(deriveOverallStatus({ invoiceStatus: '即将到期开票', paymentStatus: '待开票' }), '即将到期开票');
});

test('reversed positive and negative invoices cancel out for progress generation', () => {
  assert.deepEqual(collapseReversedInvoices([
    { invoiceNo: 'A', invoiceAmount: 14000 },
    { invoiceNo: 'B', invoiceAmount: -14000 },
    { invoiceNo: 'C', invoiceAmount: 300 },
  ]), [
    { invoiceNo: 'C', invoiceAmount: 300 },
  ]);
});

test('invoice matching assigns amount mismatch to earliest unfinished period', () => {
  const today = Date.UTC(2026, 6, 31);
  const result = matchInvoicesToPlans([
    { projectNo: 'P1', period: 1, planAmount: 5000, planDate: Date.UTC(2026, 6, 1), expectedPaymentDate: Date.UTC(2026, 6, 20) },
    { projectNo: 'P1', period: 2, planAmount: 7000, planDate: Date.UTC(2026, 7, 1), expectedPaymentDate: Date.UTC(2026, 7, 20) },
  ], [
    { sourceName: '集熠开票明细', projectNo: 'P1', invoiceNo: 'F1', invoiceAmount: 6000, receivedAmount: 1000, invoiceDate: Date.UTC(2026, 6, 2), paymentDate: Date.UTC(2026, 6, 21) },
  ], { today });

  assert.equal(result.invoices[0].linkedPlanKey, 'P1-1');
  assert.equal(result.plans[0].matchStatus, '金额异常待确认');
  assert.equal(result.plans[0].diffStatus, '金额异常待确认');
  assert.equal(result.plans[1].matchStatus, '待匹配');
});

test('offset invoices are excluded before matching', () => {
  const result = matchInvoicesToPlans([
    { projectNo: 'P1', period: 1, planAmount: 14000 },
  ], [
    { sourceName: '集熠开票明细', projectNo: 'P1', invoiceNo: 'F1', invoiceAmount: 14000 },
    { sourceName: '集熠开票明细', projectNo: 'P1', invoiceNo: 'F2', invoiceAmount: -14000 },
  ]);

  assert.deepEqual(result.plans.map((plan) => plan.actualInvoiceAmount), [0]);
  assert.deepEqual(result.invoices.map((invoice) => invoice.matchStatus), ['已抵消', '已抵消']);
});

test('project overview metric rows refresh project-level derived fields', () => {
  const today = Date.UTC(2026, 6, 31);
  const rows = buildProjectOverviewMetricRows({
    today,
    projects: [
      { recordId: 'rec1', projectNo: 'P1', projectCategory: '经营项目', openRiskCount: 2 },
      { recordId: 'rec2', projectNo: 'P2', projectCategory: '走账项目', projectStatus: '暂停' },
    ],
    invoices: [
      { projectNo: 'P1', includedInStats: true, invoiceAmount: 600, receivedAmount: 100 },
    ],
    plans: [
      {
        projectNo: 'P1',
        planAmount: 1000,
        planDate: Date.UTC(2026, 6, 1),
        expectedPaymentDate: Date.UTC(2026, 6, 20),
        actualInvoiceAmount: 600,
        receivedAmount: 100,
        uninvoicedAmount: 400,
        unpaidAmount: 500,
        invoiceStatus: '开票逾期',
        paymentStatus: '回款逾期',
      },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].recordId, 'rec1');
  assert.equal(rows[0].fields['已开票金额'], 600);
  assert.equal(rows[0].fields['已收款金额'], 100);
  assert.equal(rows[0].fields['逾期开票金额'], 400);
  assert.equal(rows[0].fields['逾期回款金额'], 500);
  assert.equal(rows[0].fields['开票状态'], '部分开票');
  assert.equal(rows[0].fields['客户收款状态'], '部分收款');
  assert.equal(rows[0].fields['下一计划开票金额'], 400);
  assert.equal(rows[0].fields['未关闭风险数'], 2);
  assert.equal(rows[0].fields['项目状态'], '进行中');
  assert.equal(rows[0].fields['系统项目状态'], '进行中');
  assert.deepEqual(rows[0].fields['应收数据粒度'], ['计划开票', '发票明细']);
  assert.deepEqual(rows[0].fields['项目阶段'], ['立项', '部分开票']);
  assert.equal(rows[1].fields['项目状态'], '暂停');
  assert.equal(rows[1].fields['系统项目状态'], '进行中');
  assert.deepEqual(rows[1].fields['应收数据粒度'], ['项目汇总']);
});
