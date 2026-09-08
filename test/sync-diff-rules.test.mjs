import test from 'node:test';
import assert from 'node:assert/strict';

import { changedUpdateFields } from '../src/rules/sync-diff-rules.mjs';

test('unchanged rows do not refresh recent sync time', () => {
  const result = changedUpdateFields(
    {
      项目编号: 'P1',
      项目名称: '测试项目',
      最近同步时间: Date.UTC(2026, 7, 3),
    },
    {
      项目编号: 'P1',
      项目名称: '测试项目',
      源更新时间: Date.UTC(2026, 7, 4),
      最近同步时间: Date.UTC(2026, 7, 4),
    },
  );

  assert.deepEqual(result, {});
});

test('unchanged rows skip write when recent sync time is empty', () => {
  const result = changedUpdateFields(
    {
      项目编号: 'P1',
      项目名称: '测试项目',
    },
    {
      项目编号: 'P1',
      项目名称: '测试项目',
      源更新时间: Date.UTC(2026, 7, 4),
      最近同步时间: Date.UTC(2026, 7, 4),
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
      最近同步时间: Date.UTC(2026, 7, 3),
    },
    {
      项目编号: 'P1',
      项目名称: '新名称',
      源更新时间: today,
      最近同步时间: today,
    },
  );

  assert.deepEqual(result, {
    项目名称: '新名称',
    源更新时间: today,
    最近同步时间: today,
  });
});

test('create-only people fields are not overwritten on existing records', () => {
  const today = Date.UTC(2026, 7, 4);
  const result = changedUpdateFields(
    {
      项目编号: 'P1',
      当前项目负责人: [{ id: 'manual_manager' }],
      项目参与人员: [{ id: 'manual_member' }],
    },
    {
      项目编号: 'P1',
      当前项目负责人: [{ id: 'source_manager' }],
      项目参与人员: [{ id: 'source_member' }],
      源更新时间: today,
      最近同步时间: today,
    },
    { createOnlyFields: ['当前项目负责人', '项目参与人员'] },
  );

  assert.deepEqual(result, {});
});

test('fill-empty people fields are populated when target is blank', () => {
  const today = Date.UTC(2026, 8, 8);
  const result = changedUpdateFields(
    {
      当前项目负责人: [],
      项目参与人员: [],
    },
    {
      当前项目负责人: [{ id: 'source_manager' }],
      项目参与人员: [{ id: 'source_member' }],
      最近同步时间: today,
    },
    { fillEmptyFields: ['当前项目负责人', '项目参与人员'] },
  );

  assert.deepEqual(result, {
    当前项目负责人: [{ id: 'source_manager' }],
    项目参与人员: [{ id: 'source_member' }],
    最近同步时间: today,
  });
});

test('fill-empty people fields preserve existing manual values', () => {
  const result = changedUpdateFields(
    {
      当前项目负责人: [{ id: 'manual_manager' }],
      项目参与人员: [{ id: 'manual_member' }],
    },
    {
      当前项目负责人: [{ id: 'source_manager' }],
      项目参与人员: [{ id: 'source_member' }],
      最近同步时间: Date.UTC(2026, 8, 8),
    },
    { fillEmptyFields: ['当前项目负责人', '项目参与人员'] },
  );

  assert.deepEqual(result, {});
});

test('source id changes alone do not trigger an update', () => {
  const result = changedUpdateFields(
    {
      项目名称: '项目A',
      源记录ID: 'old',
    },
    {
      项目名称: '项目A',
      源记录ID: 'new',
      最近同步时间: Date.UTC(2026, 8, 8),
    },
    { ignoredDiffFields: ['源记录ID'] },
  );

  assert.deepEqual(result, {});
});

test('source id is refreshed when a business field changes', () => {
  const today = Date.UTC(2026, 8, 8);
  const result = changedUpdateFields(
    {
      项目名称: '旧名称',
      源记录ID: 'old',
    },
    {
      项目名称: '新名称',
      源记录ID: 'new',
      最近同步时间: today,
    },
    { ignoredDiffFields: ['源记录ID'] },
  );

  assert.deepEqual(result, {
    项目名称: '新名称',
    源记录ID: 'new',
    最近同步时间: today,
  });
});
