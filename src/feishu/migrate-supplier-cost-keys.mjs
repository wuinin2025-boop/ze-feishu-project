#!/usr/bin/env node

import { APP_TOKEN, TARGET_TABLE_NAMES } from '../config.mjs';
import { buildSupplierCostKey, extractApplicationNo } from '../rules/supplier-cost-rules.mjs';
import { callJson, connectFeishu, searchAll, textValue } from './client.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

async function findTableId(client, tableName) {
  let pageToken;
  do {
    const data = await callJson(client, 'bitable_v1_appTable_list', {
      path: { app_token: APP_TOKEN },
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    const table = (data.items || []).find((item) => item.name === tableName);
    if (table) return table.table_id;
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  throw new Error(`找不到数据表：${tableName}`);
}

function paymentApplicationNo(value) {
  const values = String(value || '')
    .split(/[、,，]/)
    .map(extractApplicationNo)
    .filter(Boolean);
  return [...new Set(values)].length === 1 ? values[0] : '';
}

async function batchUpdate(client, tableId, rows) {
  if (DRY_RUN || !rows.length) return 0;
  let count = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    await callJson(client, 'bitable_v1_appTableRecord_batchUpdate', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      params: { user_id_type: 'open_id' },
      data: { records: chunk },
    });
    count += chunk.length;
  }
  return count;
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTableRecord.search',
  'bitable.v1.appTableRecord.batchUpdate',
]);

try {
  const tableId = await findTableId(client, TARGET_TABLE_NAMES.supplierCost);
  const records = await searchAll(client, APP_TOKEN, tableId, [
    '成本记录标题',
    '成本唯一键',
    'PO申请编号',
    '付款申请编号汇总',
  ]);
  const candidates = records.map((record) => {
    const poApplicationNo = extractApplicationNo(textValue(record.fields?.['PO申请编号']));
    const paymentNo = paymentApplicationNo(textValue(record.fields?.['付款申请编号汇总']));
    const nextKey = buildSupplierCostKey({
      poApplicationNo,
      paymentApplicationNo: poApplicationNo ? '' : paymentNo,
    });
    return {
      recordId: record.record_id,
      title: textValue(record.fields?.['成本记录标题']),
      currentKey: textValue(record.fields?.['成本唯一键']),
      nextKey,
    };
  });

  const keyOwners = new Map();
  for (const item of candidates) {
    if (!item.nextKey) continue;
    const owners = keyOwners.get(item.nextKey) || [];
    owners.push(item.recordId);
    keyOwners.set(item.nextKey, owners);
  }
  const duplicateKeys = [...keyOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([key, owners]) => ({ key, recordCount: owners.length }));
  const unresolved = candidates.filter((item) => !item.nextKey);
  const updates = candidates
    .filter((item) => item.nextKey && item.nextKey !== item.currentKey)
    .map((item) => ({ record_id: item.recordId, fields: { '成本唯一键': item.nextKey } }));

  if (duplicateKeys.length) {
    throw new Error(`发现重复稳定键，已停止且未写入：${JSON.stringify(duplicateKeys.slice(0, 20))}`);
  }
  const updated = await batchUpdate(client, tableId, updates);
  console.log(JSON.stringify({
    mode: DRY_RUN ? '试算' : '正式迁移',
    total: records.length,
    plannedUpdates: updates.length,
    updated,
    unchanged: candidates.length - updates.length - unresolved.length,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, 50).map((item) => ({ recordId: item.recordId, title: item.title })),
    duplicateCount: duplicateKeys.length,
    created: 0,
    deleted: 0,
  }, null, 2));
} finally {
  await client.close();
}
