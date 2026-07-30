import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveProjectStatus,
  projectHasBusinessActivity,
} from '../src/rules/project-status-rules.mjs';

test('project status follows collection-first lifecycle rules', () => {
  assert.equal(deriveProjectStatus({
    sourceStages: ['立项', '结算'],
    invoiceStatus: '部分开票',
    collectionStatus: '已收齐',
    hasActivity: true,
  }), '已完成');

  assert.equal(deriveProjectStatus({
    sourceStages: ['立项', '结算'],
    invoiceStatus: '已全部开票',
    collectionStatus: '未收款',
    hasActivity: true,
  }), '结算中');
});

test('project status preserves paused and pre-establishment states', () => {
  assert.equal(deriveProjectStatus({
    sourceStages: ['立项'],
    currentStatus: '暂停',
    invoiceStatus: '已全部开票',
    collectionStatus: '已收齐',
    hasActivity: true,
  }), '暂停');

  assert.equal(deriveProjectStatus({
    sourceStages: ['预立项'],
    invoiceStatus: '未开票',
    collectionStatus: '未收款',
    hasActivity: false,
  }), '未开始');
});

test('project status treats business activity or establishment as in progress', () => {
  assert.equal(deriveProjectStatus({
    sourceStages: ['立项'],
    invoiceStatus: '未开票',
    collectionStatus: '未收款',
    hasActivity: false,
  }), '进行中');

  assert.equal(deriveProjectStatus({
    sourceStages: [],
    invoiceStatus: '部分开票',
    collectionStatus: '部分收款',
    hasActivity: true,
  }), '进行中');
});

test('business activity is inferred from stages, statuses, amounts, and receivable links', () => {
  assert.equal(projectHasBusinessActivity({
    sourceStages: ['预立项'],
    invoiceStatus: '未开票',
    collectionStatus: '未收款',
    amounts: {},
    linkedReceivableCount: 0,
  }), false);

  assert.equal(projectHasBusinessActivity({
    sourceStages: ['预立项'],
    invoiceStatus: '未开票',
    collectionStatus: '未收款',
    amounts: { po: 1 },
    linkedReceivableCount: 0,
  }), true);
});
