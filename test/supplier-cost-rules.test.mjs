import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSupplierCostKey,
  deriveSupplierInvoiceStatus,
  deriveSupplierPaymentStatus,
  extractApplicationNo,
  supplierMatchStatus,
} from '../src/rules/supplier-cost-rules.mjs';

test('extracts PO application number from payment link text', () => {
  assert.equal(extractApplicationNo('202510090004-杨波-PO申请-2025-10-09 18:09:48'), '202510090004');
  assert.equal(extractApplicationNo('无编号'), '');
});

test('builds stable supplier cost key from PO first', () => {
  assert.equal(buildSupplierCostKey({ poSourceId: 'src_po', paymentSourceId: 'src_pay' }), 'PO|src_po');
  assert.equal(buildSupplierCostKey({ paymentSourceId: 'src_pay' }), '付款未匹配PO|src_pay');
});

test('derives supplier payment status from PO and actual payment amounts', () => {
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 0, actualPaymentAmount: 0 }), '未申请付款');
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 1000, actualPaymentAmount: 0 }), '已申请待付款');
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 1000, actualPaymentAmount: 400 }), '部分付款');
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 1000, actualPaymentAmount: 1000 }), '已付款');
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '已通过', poAmount: 1000, appliedPaymentAmount: 1000, actualPaymentAmount: 1200 }), '超额付款');
  assert.equal(deriveSupplierPaymentStatus({ poStatus: '审批中', poAmount: 1000 }), 'PO未通过');
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
