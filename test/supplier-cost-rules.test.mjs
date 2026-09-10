import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSupplierCostKey,
  deduplicateSupplierPayments,
  deriveSupplierInvoiceStatus,
  deriveSupplierPaymentStatus,
  extractApplicationNo,
  isApprovedApplication,
  shouldIncludePaymentApplication,
  supplierMatchStatus,
} from '../src/rules/supplier-cost-rules.mjs';

test('extracts PO application number from payment link text', () => {
  assert.equal(extractApplicationNo('202510090004-杨波-PO申请-2025-10-09 18:09:48'), '202510090004');
  assert.equal(extractApplicationNo('无编号'), '');
});

test('builds stable supplier cost key from PO first', () => {
  assert.equal(buildSupplierCostKey({ poApplicationNo: '202510090004', paymentApplicationNo: '202609080001' }), 'PO|202510090004');
  assert.equal(buildSupplierCostKey({ paymentApplicationNo: '202609080001' }), '付款未匹配PO|202609080001');
  assert.equal(buildSupplierCostKey({ poSourceId: 'unstable-source-id' }), '');
});

test('derives supplier payment status from PO and actual payment amounts', () => {
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 0, actualPaymentAmount: 0 }), '未申请付款');
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 1000, actualPaymentAmount: 0 }), '已申请待付款');
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 1000, actualPaymentAmount: 400 }), '部分付款');
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 1000, actualPaymentAmount: 1000 }), '已付款');
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 1000, actualPaymentAmount: 1200 }), '超额付款');
});

test('derives supplier invoice status from payment application invoice flags', () => {
  assert.equal(deriveSupplierInvoiceStatus([]), '未申请付款');
  assert.equal(deriveSupplierInvoiceStatus(['收到', '收到']), '已收票');
  assert.equal(deriveSupplierInvoiceStatus(['收到', '未收到']), '部分收票');
  assert.equal(deriveSupplierInvoiceStatus(['未收到']), '未收票');
  assert.equal(deriveSupplierInvoiceStatus(['其他']), '待确认');
});

test('derives supplier match status', () => {
  assert.equal(supplierMatchStatus({ projectRecordId: 'rec1', paymentRecordIds: ['pay1'] }), '已匹配项目和付款');
  assert.equal(supplierMatchStatus({ projectRecordId: 'rec1', paymentRecordIds: [] }), '已匹配项目未匹配付款');
  assert.equal(supplierMatchStatus({ projectRecordId: '', paymentRecordIds: [] }), '项目未匹配');
  assert.equal(supplierMatchStatus({ unmatchedPayment: true }), '付款未匹配PO');
});

test('includes only approved supplier applications', () => {
  assert.equal(isApprovedApplication({ applicationStatus: '已通过' }), true);
  assert.equal(isApprovedApplication({ applicationStatus: '审批中' }), false);
  assert.equal(isApprovedApplication({ applicationStatus: '已拒绝' }), false);
});

test('skips approved payment when linked PO is explicitly unapproved', () => {
  const poByApplicationNo = new Map([
    ['PO1', { applicationNo: 'PO1', applicationStatus: '审批中' }],
    ['PO2', { applicationNo: 'PO2', applicationStatus: '已通过' }],
  ]);

  assert.equal(shouldIncludePaymentApplication({ applicationStatus: '已通过', linkedPoApplicationNo: 'PO1' }, poByApplicationNo), false);
  assert.equal(shouldIncludePaymentApplication({ applicationStatus: '已通过', linkedPoApplicationNo: 'PO2' }, poByApplicationNo), true);
  assert.equal(shouldIncludePaymentApplication({ applicationStatus: '已通过', linkedPoApplicationNo: 'PO3' }, poByApplicationNo), true);
  assert.equal(shouldIncludePaymentApplication({ applicationStatus: '审批中', linkedPoApplicationNo: 'PO2' }, poByApplicationNo), false);
});

test('deduplicates supplier payments and keeps the manually completed record', () => {
  const payments = deduplicateSupplierPayments([
    {
      recordId: 'old',
      projectNo: 'E250601BONNIE',
      paymentApplicationNo: '202605270016',
      linkedPoRecordIds: ['po1'],
      paymentAmount: 699865,
      actualPaymentAmount: 0,
      paymentStatus: '审核通过待付款',
    },
    {
      recordId: 'manual',
      projectNo: 'E250601BONNIE',
      paymentApplicationNo: '202605270016',
      linkedPoRecordIds: ['po1'],
      paymentAmount: 699865,
      actualPaymentAmount: 699865,
      actualPaymentDate: Date.UTC(2026, 8, 10),
      paymentStatus: '已付款',
    },
  ]);

  assert.equal(payments.length, 1);
  assert.equal(payments[0].recordId, 'manual');
  assert.equal(payments[0].actualPaymentAmount, 699865);
});

test('does not merge different payment applications for the same PO and amount', () => {
  const payments = deduplicateSupplierPayments([
    { recordId: 'one', projectNo: 'P1', paymentApplicationNo: '202601010001', linkedPoRecordIds: ['po1'], paymentAmount: 100 },
    { recordId: 'two', projectNo: 'P1', paymentApplicationNo: '202601010002', linkedPoRecordIds: ['po1'], paymentAmount: 100 },
  ]);

  assert.equal(payments.length, 2);
});
