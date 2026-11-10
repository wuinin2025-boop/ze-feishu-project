import test from 'node:test';
import assert from 'node:assert/strict';

import { callJson } from '../src/feishu/client.mjs';

test('Feishu MCP calls allow long-running synchronization requests', async () => {
  let receivedOptions;
  const client = {
    async callTool(_request, _schema, options) {
      receivedOptions = options;
      return {
        content: [{ type: 'text', text: '{"code":0,"items":[]}' }],
      };
    },
  };

  const result = await callJson(client, 'test_tool', {});

  assert.equal(result.code, 0);
  assert.ok(receivedOptions.timeout >= 180_000);
  assert.equal(receivedOptions.resetTimeoutOnProgress, true);
});
