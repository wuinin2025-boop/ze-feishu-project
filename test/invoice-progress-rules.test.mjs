import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOldProjectNodes,
  buildSplitInvoiceNodes,
  classifyApplication,
  deriveInvoiceStatus,
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
