#!/usr/bin/env node

import {
  APP_TOKEN,
  INVOICE_COLLECTION_FIELDS,
  INVOICE_PROGRESS_FIELDS,
  OLD_PROJECT_PLAN_FIELDS,
  SELECT_OPTIONS,
  SYNC_LOG_FIELDS,
  TARGET_TABLE_NAMES,
} from '../config.mjs';
import { callJson, connectFeishu } from './client.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

const TABLE_SPECS = [
  { name: TARGET_TABLE_NAMES.invoiceProgressTrial, fields: INVOICE_PROGRESS_FIELDS, views: invoiceProgressViews() },
  { name: TARGET_TABLE_NAMES.invoiceCollection, fields: INVOICE_COLLECTION_FIELDS, views: [] },
  { name: TARGET_TABLE_NAMES.oldProjectPlan, fields: OLD_PROJECT_PLAN_FIELDS, views: [{ name: '待人工补充旧项目', fieldName: '生成状态', value: '待人工补充' }] },
  { name: TARGET_TABLE_NAMES.syncLog, fields: SYNC_LOG_FIELDS, views: [] },
];

function invoiceProgressViews() {
  return [
    { name: '待人工补充旧项目', fieldName: '生成状态', value: '待人工补充' },
    { name: '金额异常待核对', fieldName: '综合状态', value: '金额异常待核对' },
    { name: '实际拆分开票', fieldName: '差异状态', value: '实际拆分开票' },
    { name: '即将到期开票', fieldName: '开票状态', value: '即将到期开票' },
    { name: '开票逾期', fieldName: '开票状态', value: '开票逾期' },
    { name: '回款逾期', fieldName: '回款状态', value: '回款逾期' },
  ];
}

function assertTargetTableName(name) {
  if (name.startsWith('源_')) {
    throw new Error(`Refusing to write source table: ${name}`);
  }
}

function fieldProperty(spec) {
  if (spec.property) return spec.property;
  if (spec.type === 3) {
    const names = spec.options || SELECT_OPTIONS[spec.optionsKey] || [];
    return { options: names.map((name, index) => ({ name, color: (index % 20) + 1 })) };
  }
  if (spec.type === 11) return { multiple: Boolean(spec.multiple) };
  return undefined;
}

function conditionValue(field, requested) {
  if ([3, 4].includes(field.type)) {
    const option = field.property?.options?.find((item) => item.name === requested);
    if (!option) throw new Error(`Option not found: ${field.field_name}=${requested}`);
    return JSON.stringify([option.id]);
  }
  return requested;
}

async function listTables(client) {
  const items = [];
  let pageToken;
  do {
    const data = await callJson(client, 'bitable_v1_appTable_list', {
      path: { app_token: APP_TOKEN },
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    items.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return items;
}

async function ensureTable(client, tableSpec, tables, report) {
  assertTargetTableName(tableSpec.name);
  const existing = tables.find((table) => table.name === tableSpec.name);
  if (existing) {
    report.tables.existing.push({ name: tableSpec.name, table_id: existing.table_id });
    return existing;
  }
  report.tables.to_create.push({ name: tableSpec.name });
  if (DRY_RUN) return { name: tableSpec.name, table_id: `dry:${tableSpec.name}` };

  const data = await callJson(client, 'bitable_v1_appTable_create', {
    path: { app_token: APP_TOKEN },
    data: {
      table: {
        name: tableSpec.name,
      },
    },
  });
  const refreshedTables = await listTables(client);
  const table = data.table || data.data?.table || refreshedTables.find((item) => item.name === tableSpec.name);
  if (!table) throw new Error(`Created table but could not resolve table id: ${tableSpec.name}`);
  report.tables.created.push({ name: table.name, table_id: table.table_id });
  return table;
}

async function listFields(client, tableId) {
  if (DRY_RUN && tableId.startsWith('dry:')) return [];
  const data = await callJson(client, 'bitable_v1_appTableField_list', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { page_size: 200 },
  });
  return data.items || [];
}

async function ensureFields(client, table, fieldSpecs, report) {
  const fields = await listFields(client, table.table_id);
  for (const spec of fieldSpecs) {
    const existing = fields.find((field) => field.field_name === spec.name);
    if (existing) {
      report.fields.existing.push({ table: table.name, field: spec.name });
      const property = spec.type === 11 ? fieldProperty(spec) : undefined;
      const needsPropertyUpdate = property && JSON.stringify(existing.property || {}) !== JSON.stringify(property);
      if (needsPropertyUpdate) {
        report.fields.to_update ||= [];
        report.fields.updated ||= [];
        report.fields.to_update.push({ table: table.name, field: spec.name, property });
        if (!DRY_RUN) {
          await callJson(client, 'bitable_v1_appTableField_update', {
            path: { app_token: APP_TOKEN, table_id: table.table_id, field_id: existing.field_id },
            data: {
              field_name: existing.field_name,
              type: existing.type,
              ui_type: existing.ui_type,
              property,
            },
          });
          report.fields.updated.push({ table: table.name, field: spec.name, property });
        }
      }
      continue;
    }
    report.fields.to_create.push({ table: table.name, field: spec.name, type: spec.type });
    if (DRY_RUN) continue;
    const property = fieldProperty(spec);
    await callJson(client, 'bitable_v1_appTableField_create', {
      path: { app_token: APP_TOKEN, table_id: table.table_id },
      data: {
        field_name: spec.name,
        type: spec.type,
        ui_type: spec.uiType,
        ...(property ? { property } : {}),
      },
    });
    report.fields.created.push({ table: table.name, field: spec.name, type: spec.type });
  }
}

async function listViews(client, tableId) {
  if (DRY_RUN && tableId.startsWith('dry:')) return [];
  const data = await callJson(client, 'bitable_v1_appTableView_list', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { page_size: 100 },
  });
  return data.items || [];
}

async function ensureViews(client, table, viewSpecs, report) {
  if (!viewSpecs.length) return;
  const [views, fields] = await Promise.all([listViews(client, table.table_id), listFields(client, table.table_id)]);
  for (const spec of viewSpecs) {
    const existing = views.find((view) => view.view_name === spec.name);
    if (existing) {
      report.views.existing.push({ table: table.name, view: spec.name });
      continue;
    }
    report.views.to_create.push({ table: table.name, view: spec.name });
    if (DRY_RUN) continue;
    const created = await callJson(client, 'bitable_v1_appTableView_create', {
      path: { app_token: APP_TOKEN, table_id: table.table_id },
      data: { view_name: spec.name, view_type: 'grid' },
    });
    const field = fields.find((item) => item.field_name === spec.fieldName);
    if (field) {
      await callJson(client, 'bitable_v1_appTableView_patch', {
        path: { app_token: APP_TOKEN, table_id: table.table_id, view_id: created.view.view_id },
        data: {
          property: {
            filter_info: {
              conjunction: 'and',
              conditions: [{
                field_id: field.field_id,
                operator: 'is',
                value: conditionValue(field, spec.value),
              }],
            },
          },
        },
      });
    }
    report.views.created.push({ table: table.name, view: spec.name });
  }
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTable.create',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableField.create',
  'bitable.v1.appTableField.update',
  'bitable.v1.appTableView.list',
  'bitable.v1.appTableView.create',
  'bitable.v1.appTableView.patch',
]);

const report = {
  dry_run: DRY_RUN,
  tables: { existing: [], to_create: [], created: [] },
  fields: { existing: [], to_create: [], created: [] },
  views: { existing: [], to_create: [], created: [] },
};

try {
  const tables = await listTables(client);
  for (const spec of TABLE_SPECS) {
    const table = await ensureTable(client, spec, tables, report);
    await ensureFields(client, table, spec.fields, report);
    await ensureViews(client, table, spec.views, report);
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
