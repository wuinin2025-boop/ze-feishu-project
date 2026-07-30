#!/usr/bin/env node

import { APP_TOKEN } from '../config.mjs';
import { callJson, connectFeishu } from './client.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

const TABLES = {
  tasks: {
    tableId: 'tblMqbOebPtzjEdH',
    tableName: '项目进度表',
    views: [
      {
        viewName: '日常任务',
        hiddenFields: [
          '创建时间',
          '任务创建人',
          '项目编号',
          '项目状态',
          '项目名称',
          '最后更新时间',
          '权限_可管理人员',
          '项目成员',
          '工时偏差（小时）',
        ],
      },
    ],
  },
  oldPlan: {
    tableId: 'tblOJRhUniTa1yRU',
    tableName: '（旧项目）开票计划补录表',
    views: [
      {
        viewName: '日常补录',
        hiddenFields: [
          '记录标识',
          '项目负责人',
          '立项金额',
          '开票总次数',
          '项目编号',
          '项目名称',
          '补录人',
          '同步状态',
          '同步到应收记录',
          '同步结果说明',
          '同步时间',
          '权限_可管理人员',
          '源记录键',
          '生成状态',
          '最后同步时间',
        ],
      },
    ],
  },
  invoiceProgress: {
    tableId: 'tblA4obaIS0jeylo',
    tableName: '项目开票进度表',
    views: [
      {
        viewName: '日常开票进度',
        hiddenFields: [
          '记录标题',
          '立项时项目负责人',
          '当前权限负责人',
          '权限_可管理人员',
          '立项开票总次数',
          '当前开票总次数',
          '原计划期次',
          '原计划开票金额',
          '计划备注',
          '差异状态',
          '生成状态',
          '差异说明',
          '数据来源',
          '最后同步时间',
        ],
      },
    ],
  },
};

async function listFields(client, tableId) {
  const data = await callJson(client, 'bitable_v1_appTableField_list', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { page_size: 200 },
  });
  return data.items || [];
}

async function listViews(client, tableId) {
  const data = await callJson(client, 'bitable_v1_appTableView_list', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    params: { page_size: 100 },
  });
  return data.items || [];
}

async function createGridView(client, tableId, viewName) {
  if (DRY_RUN) return { view_id: `dry:${viewName}`, view_name: viewName, created: true };
  const data = await callJson(client, 'bitable_v1_appTableView_create', {
    path: { app_token: APP_TOKEN, table_id: tableId },
    data: { view_name: viewName, view_type: 'grid' },
  });
  return { ...data.view, created: true };
}

async function patchHiddenFields(client, tableId, viewId, hiddenFieldIds) {
  if (DRY_RUN) return;
  await callJson(client, 'bitable_v1_appTableView_patch', {
    path: { app_token: APP_TOKEN, table_id: tableId, view_id: viewId },
    data: { property: { hidden_fields: hiddenFieldIds } },
  });
}

function resolveHiddenFields(fields, hiddenFieldNames) {
  const byName = new Map(fields.map((field) => [field.field_name, field]));
  const primaryFieldId = fields[0]?.field_id;
  const hidden = [];
  const missing = [];
  const primary = [];
  for (const name of hiddenFieldNames) {
    const field = byName.get(name);
    if (!field) {
      missing.push(name);
      continue;
    }
    if (field.field_id === primaryFieldId) {
      primary.push(name);
      continue;
    }
    hidden.push({ field_name: name, field_id: field.field_id });
  }
  return { hidden, missing, primary };
}

const client = await connectFeishu([
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableView.list',
  'bitable.v1.appTableView.create',
  'bitable.v1.appTableView.patch',
]);

try {
  const report = {
    dry_run: DRY_RUN,
    tables: [],
  };

  for (const table of Object.values(TABLES)) {
    const [fields, views] = await Promise.all([
      listFields(client, table.tableId),
      listViews(client, table.tableId),
    ]);

    const tableReport = {
      table: table.tableName,
      table_id: table.tableId,
      views: [],
    };

    for (const spec of table.views) {
      const existing = views.find((view) => view.view_name === spec.viewName);
      const view = existing || await createGridView(client, table.tableId, spec.viewName);
      const { hidden, missing, primary } = resolveHiddenFields(fields, spec.hiddenFields);
      await patchHiddenFields(client, table.tableId, view.view_id, hidden.map((field) => field.field_id));
      tableReport.views.push({
        view: spec.viewName,
        view_id: view.view_id,
        action: existing ? 'updated' : 'created',
        hidden_fields: hidden.map((field) => field.field_name),
        protected_primary_fields: primary,
        missing_fields: missing,
      });
    }

    report.tables.push(tableReport);
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
