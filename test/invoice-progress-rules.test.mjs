import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInvoiceCollectionTitle,
  buildOldProjectNodes,
  buildProgressKey,
  buildSingleLinkField,
  buildSplitInvoiceNodes,
  buildSyncLogTitle,
  classifyApplication,
  collapseReversedInvoices,
  deriveInvoiceStatus,
  deriveOverallStatus,
  derivePaymentStatus,
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

test('single link field uses Feishu write format', () => {
  assert.deepEqual(buildSingleLinkField('rec123'), ['rec123']);
  assert.equal(buildSingleLinkField(''), undefined);
  assert.equal(buildSingleLinkField(undefined), undefined);
});

test('invoice collection and sync log titles replace blank first fields', () => {
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
  assert.equal(
    buildSyncLogTitle({ runTime: Date.UTC(2026, 6, 30, 4, 0, 0), runType: '项目开票进度同步', result: '成功' }),
    '2026-07-30 04:00:00|项目开票进度同步|成功',
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
