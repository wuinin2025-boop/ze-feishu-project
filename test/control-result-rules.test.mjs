import test from 'node:test';
import assert from 'node:assert/strict';

import {
  commandFailure,
  describeFailure,
} from '../src/rules/control-result-rules.mjs';

test('formats structured verification failures for non-technical readers', () => {
  assert.equal(
    describeFailure({ name: '统一明细金额一致', detail: 'detail=100, source=120' }),
    '统一明细金额一致：detail=100, source=120',
  );
});

test('explains a missing Feishu field from a failed command', () => {
  assert.equal(
    commandFailure({ ok: false, code: 1, stderr: 'field name 服务内容1 not exist' }, '同步数据'),
    '同步数据失败：飞书字段“服务内容1”不存在，可能已被改名或删除。',
  );
});
