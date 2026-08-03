import test from 'node:test';
import assert from 'node:assert/strict';

import { changedUpdateFields } from '../src/rules/sync-diff-rules.mjs';

test('unchanged rows clear stale last sync time only', () => {
  const result = changedUpdateFields(
    {
      项目编号: 'P1',
      项目名称: '测试项目',
      最后同步时间: Date.UTC(2026, 7, 3),
    },
    {
      项目编号: 'P1',
      项目名称: '测试项目',
      源更新时间: Date.UTC(2026, 7, 4),
      最后同步时间: Date.UTC(2026, 7, 4),
    },
  );

  assert.deepEqual(result, { 最后同步时间: null });
});

test('unchanged rows skip write after last sync time is already empty', () => {
  const result = changedUpdateFields(
    {
      项目编号: 'P1',
      项目名称: '测试项目',
    },
    {
      项目编号: 'P1',
      项目名称: '测试项目',
      源更新时间: Date.UTC(2026, 7, 4),
      最后同步时间: Date.UTC(2026, 7, 4),
    },
  );

  assert.deepEqual(result, {});
});

test('changed rows include business changes and sync timestamps', () => {
  const today = Date.UTC(2026, 7, 4);
  const result = changedUpdateFields(
    {
      项目编号: 'P1',
      项目名称: '旧名称',
      最后同步时间: Date.UTC(2026, 7, 3),
    },
    {
      项目编号: 'P1',
      项目名称: '新名称',
      源更新时间: today,
      最后同步时间: today,
    },
  );

  assert.deepEqual(result, {
    项目名称: '新名称',
    源更新时间: today,
    最后同步时间: today,
  });
});
