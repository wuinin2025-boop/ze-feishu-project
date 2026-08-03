#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import {
  APP_TOKEN,
  TARGET_TABLE_NAMES,
} from '../config.mjs';
import {
  callJson,
  connectFeishu,
} from './client.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

const FIELD_TYPES = {
  text: 1,
  number: 2,
  singleSelect: 3,
  date: 5,
  singleLink: 18,
  formula: 20,
  duplexLink: 21,
};

const CATEGORY_OPTIONS = [
  { name: '经营项目', color: 20 },
  { name: '行政/内部项目', color: 44 },
  { name: '走账项目', color: 1 },
];

const YES_NO_OPTIONS = [
  { name: '是', color: 20 },
  { name: '否', color: 44 },
];

const PLAN_STATUS_OPTIONS = [
  { name: '待匹配', color: 1 },
  { name: '部分匹配', color: 4 },
  { name: '已匹配', color: 20 },
  { name: '金额异常待确认', color: 44 },
];

const INVOICE_MATCH_OPTIONS = [
  { name: '自动匹配', color: 20 },
  { name: '未匹配项目', color: 44 },
  { name: '计划外开票', color: 1 },
  { name: '已抵消', color: 2 },
  { name: '红冲待确认', color: 44 },
];

const INVOICE_STATUS_OPTIONS = [
  { name: '待人工补充', color: 1 },
  { name: '已开票', color: 20 },
  { name: '部分开票', color: 4 },
  { name: '即将到期开票', color: 5 },
  { name: '开票逾期', color: 44 },
  { name: '未到期', color: 6 },
];

const PAYMENT_STATUS_OPTIONS = [
  { name: '待开票', color: 1 },
  { name: '已回款', color: 20 },
  { name: '回款逾期', color: 44 },
  { name: '部分回款', color: 4 },
  { name: '待回款', color: 5 },
  { name: '待补预计回款日期', color: 6 },
];

const PROJECT_OVERVIEW_DESCRIPTIONS = {
  项目名称: '来源：三张源项目台账和审批通过的源_立项申请；按项目编号合并，同项目非空值取最新同步来源。',
  项目编号: '项目唯一识别键；用于项目总览、项目进度、开票计划、开票明细、供应商付款之间匹配。',
  客户: '来源：三张源项目台账的客户名称文本/客户关联，或审批通过的源_立项申请客户名称。',
  立项公司: '来源：项目台账或审批通过的源_立项申请；用于驾驶舱按公司筛选。',
  项目类型: '来源：项目台账或审批通过的源_立项申请。',
  项目分类管理: '人工维护：经营项目、行政/内部项目、走账项目；下游表通过关联项目引用。行政/内部项目不进入老板驾驶舱金额统计。',
  当前项目负责人: '首次创建项目总览记录时由源项目台账或审批通过的源_立项申请初始化；已有记录以人工维护为准，本地同步不覆盖。',
  项目参与人员: '人工或飞书自动化维护；当前本地同步脚本不覆盖。',
  项目阶段: '本地同步自动计算：有项目编号为立项；有结算追加结算；有PO金额追加PO；按计划开票总金额、已开票金额判断部分/全部开票；按成本目标和供应商实际付款判断部分/全部付款。',
  项目描述: '人工维护字段，本地同步脚本不覆盖。',
  源项目负责人: '来源：项目台账或审批通过的源_立项申请中的项目负责人，用于与当前项目负责人核对。',
  项目状态: '人工优先字段；暂停、暂缓、已终止、已取消等人工锁定状态本地同步不覆盖。未锁定时按系统计算结果同步：开票目标完成且已收齐为已完成；已结算或已开全票但未收齐为结算中；其余已立项项目为进行中。',
  开票状态: '本地同步按项目开票计划表和开票明细统一表汇总：已开票金额达到计划开票总金额为已全部开票；大于0未达目标为部分开票；否则未开票。',
  交接协同人: '人工维护字段；可作为项目协作和高级权限判断辅助人员。',
  数据来源: '本地同步写入本项目使用到的源表名称，可能包含三张项目台账和源_立项申请。',
  系统项目状态: '本地同步自动计算，不受人工项目状态影响；用于和人工维护的项目状态进行核对。',
  客户收款状态: '本地同步按开票明细统一表汇总：已收款金额达到已开票金额为已收齐；大于0未收齐为部分收款；否则未收款。',
  开票计划预警: '本地同步按项目开票计划表判断：存在逾期未开票金额为逾期；下一计划开票日期7天内为即将到期；否则正常。',
  回款计划预警: '本地同步按项目开票计划表判断：存在已开票未收且预计回款日已过的金额为逾期；下一预计回款日期7天内为即将到期；否则正常。',
  负责人交接状态: '当前本地同步脚本不维护；如需交接状态，请在飞书中人工或自动化维护。',
  最后负责人更新时间: '负责人变更辅助字段；当前本地同步脚本不写入。',
  未关闭风险数: '本地同步按项目进度表汇总：风险等级为低/中/高且任务状态不是已完成、已取消的任务数量。',
  立项金额: '来源：项目台账或审批通过的源_立项申请；表示项目立项口径金额，不与结算金额混用。',
  立项成本: '来源：项目台账或审批通过的源_立项申请；表示项目立项口径成本。',
  结算金额: '来源：项目台账或审批通过的源_立项申请；表示项目结算口径开票金额，允许与立项金额不同。',
  结算成本: '来源：项目台账或审批通过的源_立项申请；表示项目结算口径成本。',
  PO金额: '来源：三张源项目台账中的PO成本字段；当前本地同步不直接汇总源_PO申请。',
  已开票金额: '本地同步按项目编号汇总开票明细统一表中纳入统计的开票金额；红冲抵消记录不纳入。',
  已收款金额: '本地同步按项目编号汇总开票明细统一表中纳入统计的收款金额；红冲抵消记录不纳入。',
  逾期回款金额: '本地同步按项目开票计划表汇总：已实际开票、未收齐且预计回款日期早于今天的未收款金额。',
  付款申请审批中金额: '当前本地同步脚本不写入；如需使用，应由供应商付款或飞书自动化汇总审批中的付款申请。',
  供应商待付款金额: '当前本地同步脚本不写入；如需使用，应由供应商付款或飞书自动化汇总已审批待处理的付款申请。',
  累计实际付款金额: '本地同步按项目编号汇总供应商付款表的实际付款金额；不使用付款申请金额替代实际付款。',
  最近预计回款日期: '本地同步取项目开票计划表中未收齐期次最早的预计回款日期。',
  应收数据粒度: '本地同步标记本项目当前应收数据来源：计划开票、发票明细或项目汇总。',
  源记录ID: '本地同步写入所采用源记录的SourceID；缺失时使用飞书record_id，用于幂等同步。',
  源更新时间: '本地同步写入本次采用源记录时的同步时间。',
  最后同步时间: '本地同步脚本最近一次实际改动本记录的时间；如果本次计算结果没有变化，不会只为刷新时间而写入。',
  同步状态: '本地同步写入；正常表示本次项目主数据同步成功，不代表所有业务字段均已填写。',
  项目编号异常: '本地同步校验项目编号：有项目编号为正常，缺失为缺失。',
  数据完整性状态: '本地同步校验项目编号、项目名称、当前项目负责人；三者都有值为完整，否则待补充。',
  人工确认有效源记录ID: '历史重复源记录人工确认辅助字段；当前本地同步不读取，不作为日常取数依据。',
  关联线索: '人工或飞书关联字段；用于线索转正式项目后的回溯，本地同步脚本不写入。',
  上次当前负责人: '负责人变更自动化留痕字段；当前本地同步脚本不写入。',
  预计开票总次数: '本地同步按项目开票计划表汇总该项目计划期次数；旧项目来自旧项目补录，新项目来自源_立项申请开票计划。',
  计划开票总金额: '本地同步按项目开票计划表汇总该项目全部期次计划开票金额。',
  下一计划开票日期: '本地同步取项目开票计划表中未开票完成期次最早的计划开票日期；全部开完则为空。',
  下一计划开票金额: '本地同步取下一计划开票日期对应期次的未开票余额。',
  下一预计回款日期: '本地同步取项目开票计划表中未收齐期次最早的预计回款日期。',
  开票回款计划说明: '本地同步生成的计划摘要：期数、计划总额、下一计划开票、下一预计回款。',
  父记录: '项目层级同表关联字段；人工维护，当前本地同步脚本不使用。',
  立项毛利: '来源：审批通过的源_立项申请项目立项_立项毛利；项目台账没有该字段时不覆盖。',
  立项毛利率: '来源：审批通过的源_立项申请项目立项_立项毛利率；以小数表示，例如0.6代表60%。',
  立项毛利率预警: '本地同步按立项金额和立项毛利率计算：无金额或无毛利率为未计算；毛利率0为走账项目/异常；低于0.6为低于60%；否则正常。',
  结算毛利: '来源：审批通过的源_立项申请项目结算_结算毛利；项目台账没有该字段时不覆盖。',
  结算毛利率: '来源：审批通过的源_立项申请项目结算_结算毛利率；以小数表示，例如0.6代表60%。',
  结算毛利率预警: '本地同步按结算金额和结算毛利率计算：无金额或无毛利率为未计算；毛利率0为走账项目/异常；低于0.6为低于60%；否则正常。',
  逾期开票金额: '本地同步按项目开票计划表汇总：计划开票日期早于今天且未开票完成的未开票金额。',
};

const PROJECT_PROGRESS_DESCRIPTIONS = {
  任务名称: '人工维护的任务名称；本地同步为经营项目首次补齐项目进度记录时默认使用项目名称，后续不自动覆盖。',
  关联项目: '关联项目总览表；项目编号、项目名称、项目状态和权限人员由此关联带出。',
  任务执行人员: '人工指定本任务的实际执行人员。',
  开始时间: '人工维护的计划或实际开始日期。',
  结束时间: '人工维护的计划结束日期，用于任务进度和逾期判断。',
  优先级: '人工维护的任务优先级。',
  '预计工时（小时）': '人工填写的预计投入工时，单位为小时。',
  '实际工时（小时）': '人工填写的实际投入工时，单位为小时。',
  实际完成时间: '任务完成时人工填写的实际完成日期。',
  任务状态: '人工维护任务执行状态；本地同步新增经营项目进度记录时默认填进行中。',
  风险等级: '人工评估任务风险等级；本地同步新增经营项目进度记录时默认填无。',
  风险或阻碍: '人工记录任务风险、阻碍和需要协助事项。',
};

const INVOICE_PLAN_DESCRIPTIONS = {
  计划唯一键: '本地同步生成的唯一键，规则为“项目编号-计划期次”；用于识别同一个项目的同一期计划，避免重复创建。',
  关联项目: '本地同步按项目编号关联到项目总览表；项目编号、项目名称、项目分类管理等字段由此带出。',
  项目编号: '公式引用字段：从关联项目自动带出项目编号；本表不人工填写。',
  项目名称: '公式引用字段：从关联项目自动带出项目名称；本表不人工填写。',
  项目分类管理: '公式引用字段：从关联项目自动带出项目分类管理；用于区分经营项目、走账项目、行政/内部项目。',
  老板驾驶舱分组: '公式字段：经营项目进入经营项目总览，走账项目进入走账项目总览，行政/内部项目不纳入老板驾驶舱金额统计。',
  计划期次: '本地同步写入；旧项目来自（旧项目）开票计划补录表，新项目来自审批通过的源_立项申请开票计划。',
  计划总期数: '本地同步写入该项目计划总期数；旧项目优先取补录表的预计开票总次数/开票总次数，新项目取源_立项申请预计开票总次数。',
  计划开票金额: '本地同步写入本期计划开票金额；用于计算未开票金额、匹配状态、开票逾期和项目总览表计划开票总金额。',
  计划开票日期: '本地同步写入本期约定开票日期；用于判断即将到期开票和开票逾期天数。',
  预计回款日期: '本地同步写入本期预计回款日期；已开票未收齐时，用于判断回款逾期和回款逾期天数。',
  匹配状态: '本地同步计算：无发票为待匹配；部分开票为部分匹配；实际开票达到计划为已匹配；实际开票超过计划为金额异常待确认。',
  开票状态: '本地同步计算：缺少计划日期或金额为待人工补充；实际开票达到计划为已开票；部分开票为部分开票；未开票且日期已过为开票逾期；7天内到期为即将到期开票；否则未到期。',
  回款状态: '本地同步计算：未开票为待开票；已收款达到实际开票金额为已回款；已开票但未填预计回款日期为待补预计回款日期；预计回款日期已过且未收齐为回款逾期；部分收款为部分回款；否则待回款。',
  发票编号: '本地同步按关联发票汇总发票编号显示值；一期开多张发票时用顿号合并。Hankook & Company Co., Ltd 无发票号时显示 Hankook 001。',
  实际开票金额: '本地同步按自动匹配到本计划期次的开票明细汇总开票金额；红冲抵消记录不纳入。',
  实际收款金额: '本地同步按自动匹配到本计划期次的开票明细汇总收款金额；红冲抵消记录不纳入。',
  实际开票日期: '本地同步取本计划期次最早匹配发票的开票日期。',
  实际收款日期: '本地同步取本计划期次匹配发票中的收款日期；多张发票时取最近一次有值的收款日期。',
  未开票金额: '本地同步计算：计划开票金额减实际开票金额，小于0时按0显示。',
  未收款金额: '本地同步计算：实际开票金额减实际收款金额，小于0时按0显示。',
  开票差异金额: '本地同步计算：实际开票金额减计划开票金额；大于0代表本期实际开票超过计划，需要人工确认。',
  开票逾期天数: '本地同步计算：开票状态为开票逾期时，按今天减计划开票日期计算；未逾期为0。',
  回款逾期天数: '本地同步计算：回款状态为回款逾期时，按今天减预计回款日期计算；未逾期为0。',
  异常原因: '本地同步写入需要人工确认的原因；目前主要用于实际开票金额超过计划开票金额。',
  数据来源: '本地同步写入计划来源：旧项目开票计划补录或源立项开票计划。',
  最后同步时间: '本地同步最近一次写入或刷新本计划记录的时间。',
  关联发票: '本地同步关联自动匹配到本计划期次的开票明细统一表记录；用于回看实际发票和收款明细。',
};

function field(fieldName, type, property = {}, description = '') {
  return {
    field_name: fieldName,
    type,
    ...(Object.keys(property).length ? { property } : {}),
    ...(description ? { description: { text: description } } : {}),
  };
}

function text(fieldName, description = '') {
  return field(fieldName, FIELD_TYPES.text, {}, description);
}

function number(fieldName, description = '') {
  return field(fieldName, FIELD_TYPES.number, { formatter: '0.00' }, description);
}

function date(fieldName, description = '') {
  return field(fieldName, FIELD_TYPES.date, { date_formatter: 'yyyy/MM/dd' }, description);
}

function select(fieldName, options, description = '') {
  return field(fieldName, FIELD_TYPES.singleSelect, { options }, description);
}

function singleLink(fieldName, tableId, description = '', multiple = false) {
  return field(fieldName, FIELD_TYPES.singleLink, { table_id: tableId, multiple }, description);
}

function formula(fieldName, formulaExpression, dataType = 1, description = '') {
  return field(fieldName, FIELD_TYPES.formula, {
    formula_expression: formulaExpression,
    type: { data_type: dataType },
  }, description);
}

function linkLookupExpression({ tableId, linkFieldId, targetFieldId, combine = 'ARRAYJOIN(",")' }) {
  return `bitable::$table[${tableId}].$field[${linkFieldId}].$column[${targetFieldId}].${combine}`;
}

function dashboardGroupExpression(tableId, categoryFieldId) {
  const fieldRef = `bitable::$table[${tableId}].$field[${categoryFieldId}]`;
  return `IF(${fieldRef}="经营项目","经营项目总览",IF(${fieldRef}="走账项目","走账项目总览",IF(${fieldRef}="行政/内部项目","不纳入","项目分类待确认")))`;
}

function assertWritableTableName(tableName) {
  if (tableName.startsWith('源_') || tableName === TARGET_TABLE_NAMES.oldProjectPlan) {
    throw new Error(`Refusing to write protected table: ${tableName}`);
  }
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

async function listFields(client, tableId) {
  const items = [];
  let pageToken;
  do {
    const data = await callJson(client, 'bitable_v1_appTableField_list', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    items.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return items;
}

async function listViews(client, tableId) {
  const items = [];
  let pageToken;
  do {
    const data = await callJson(client, 'bitable_v1_appTableView_list', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    items.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return items;
}

async function ensureTable(client, tablesByName, tableName, primaryFieldName, defaultViewName, report) {
  assertWritableTableName(tableName);
  if (tablesByName.has(tableName)) return tablesByName.get(tableName);
  report.planned.tables.push(tableName);
  if (DRY_RUN) return undefined;
  const data = await callJson(client, 'bitable_v1_appTable_create', {
    path: { app_token: APP_TOKEN },
    data: {
      table: {
        name: tableName,
        default_view_name: defaultViewName,
        fields: [text(primaryFieldName)],
      },
    },
    params: { client_token: randomUUID() },
  });
  const tableId = data.table_id || data.table?.table_id || data.data?.table_id || data.data?.table?.table_id;
  if (!tableId) throw new Error(`Could not read created table id for ${tableName}: ${JSON.stringify(data)}`);
  tablesByName.set(tableName, tableId);
  report.created.tables.push(tableName);
  return tableId;
}

async function ensureField(client, tableName, tableId, fieldsByName, desiredField, report) {
  assertWritableTableName(tableName);
  if (fieldsByName.has(desiredField.field_name)) return fieldsByName.get(desiredField.field_name);
  report.planned.fields.push(`${tableName}.${desiredField.field_name}`);
  if (DRY_RUN || !tableId) return undefined;
  try {
    const data = await callJson(client, 'bitable_v1_appTableField_create', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      data: desiredField,
      params: { client_token: randomUUID() },
    });
    const created = data.field || data.data?.field || data;
    const fieldId = created.field_id || created.field?.field_id;
    report.created.fields.push(`${tableName}.${desiredField.field_name}`);
    const normalized = { ...created, field_id: fieldId, field_name: desiredField.field_name };
    fieldsByName.set(desiredField.field_name, normalized);
    return normalized;
  } catch (error) {
    if (desiredField.type === FIELD_TYPES.formula) {
      report.skipped_formula_fields.push({
        field: `${tableName}.${desiredField.field_name}`,
        reason: error.message,
      });
      return undefined;
    }
    throw error;
  }
}

function fieldDescriptionText(fieldItem) {
  const description = fieldItem?.description;
  if (!description) return '';
  if (typeof description === 'string') return description;
  return description.text || '';
}

function fieldUpdateProperty(fieldItem) {
  if (fieldItem.type === FIELD_TYPES.singleLink) {
    return {
      table_id: fieldItem.property?.table_id,
      multiple: Boolean(fieldItem.property?.multiple),
    };
  }
  return fieldItem.property;
}

async function ensureFieldDescription(client, tableName, tableId, fieldsByName, fieldName, description, report, options = {}) {
  assertWritableTableName(tableName);
  const existing = fieldsByName.get(fieldName);
  if (
    !existing
    || (!options.includeComputed && existing.type === FIELD_TYPES.singleLink)
    || (!options.includeComputed && existing.type === FIELD_TYPES.formula)
    || existing.type === FIELD_TYPES.duplexLink
    || existing.type >= 1000
  ) return;
  if (fieldDescriptionText(existing) === description) return;
  report.planned.field_descriptions.push(`${tableName}.${fieldName}`);
  if (DRY_RUN) return;
  await callJson(client, 'bitable_v1_appTableField_update', {
    path: { app_token: APP_TOKEN, table_id: tableId, field_id: existing.field_id },
    data: {
      field_name: existing.field_name,
      type: existing.type,
      ...(fieldUpdateProperty(existing) ? { property: fieldUpdateProperty(existing) } : {}),
      description: { text: description },
    },
  });
  report.updated.field_descriptions.push(`${tableName}.${fieldName}`);
}

async function ensureFieldDescriptions(client, tableName, tableId, fieldsByName, descriptions, report, options = {}) {
  for (const [fieldName, description] of Object.entries(descriptions)) {
    await ensureFieldDescription(client, tableName, tableId, fieldsByName, fieldName, description, report, options);
  }
}

async function ensureViews(client, tableName, tableId, viewNames, report) {
  assertWritableTableName(tableName);
  if (!tableId) {
    report.planned.views.push(...viewNames.map((name) => `${tableName}.${name}`));
    return;
  }
  const existing = await listViews(client, tableId);
  const existingNames = new Set(existing.map((view) => view.view_name));
  for (const viewName of viewNames) {
    if (existingNames.has(viewName)) continue;
    report.planned.views.push(`${tableName}.${viewName}`);
    if (DRY_RUN) continue;
    await callJson(client, 'bitable_v1_appTableView_create', {
      path: { app_token: APP_TOKEN, table_id: tableId },
      data: { view_name: viewName, view_type: 'grid' },
    });
    report.created.views.push(`${tableName}.${viewName}`);
  }
}

async function ensureInvoiceModel(client) {
  const report = {
    dry_run: DRY_RUN,
    planned: { tables: [], fields: [], field_descriptions: [], views: [] },
    created: { tables: [], fields: [], views: [] },
    updated: { field_descriptions: [] },
    skipped_formula_fields: [],
    protected_tables: [TARGET_TABLE_NAMES.oldProjectPlan],
  };

  const tables = await listTables(client);
  const tablesByName = new Map(tables.map((table) => [table.name, table.table_id]));
  const projectOverviewId = tablesByName.get(TARGET_TABLE_NAMES.projectOverview);
  if (!projectOverviewId) throw new Error(`Target table not found: ${TARGET_TABLE_NAMES.projectOverview}`);

  const overviewFields = new Map((await listFields(client, projectOverviewId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  await ensureFieldDescriptions(
    client,
    TARGET_TABLE_NAMES.projectOverview,
    projectOverviewId,
    overviewFields,
    PROJECT_OVERVIEW_DESCRIPTIONS,
    report,
  );
  await ensureField(
    client,
    TARGET_TABLE_NAMES.projectOverview,
    projectOverviewId,
    overviewFields,
    select('项目分类管理', CATEGORY_OPTIONS, '人工维护：经营项目、行政/内部项目、走账项目；下游表通过关联项目引用。'),
    report,
  );

  const planTableId = await ensureTable(client, tablesByName, TARGET_TABLE_NAMES.invoicePlan, '计划唯一键', '全部计划', report);
  const detailTableId = await ensureTable(client, tablesByName, TARGET_TABLE_NAMES.invoiceDetail, '明细唯一键', '全部明细', report);
  const progressTableId = tablesByName.get(TARGET_TABLE_NAMES.projectProgress);
  if (progressTableId) {
    const progressFields = new Map((await listFields(client, progressTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
    await ensureFieldDescriptions(
      client,
      TARGET_TABLE_NAMES.projectProgress,
      progressTableId,
      progressFields,
      PROJECT_PROGRESS_DESCRIPTIONS,
      report,
    );
  }
  if (DRY_RUN && (!planTableId || !detailTableId)) return report;

  const refreshedTables = new Map((await listTables(client)).map((table) => [table.name, table.table_id]));
  const actualPlanTableId = refreshedTables.get(TARGET_TABLE_NAMES.invoicePlan) || planTableId;
  const actualDetailTableId = refreshedTables.get(TARGET_TABLE_NAMES.invoiceDetail) || detailTableId;
  const actualOverviewFields = new Map((await listFields(client, projectOverviewId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const projectNoFieldId = actualOverviewFields.get('项目编号')?.field_id;
  const projectNameFieldId = actualOverviewFields.get('项目名称')?.field_id;
  const projectCategoryFieldId = actualOverviewFields.get('项目分类管理')?.field_id;

  const planFields = new Map((await listFields(client, actualPlanTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const detailFields = new Map((await listFields(client, actualDetailTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));

  const planProjectLink = await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, singleLink('关联项目', projectOverviewId, '关联项目总览表；项目编号、项目名称、项目分类管理从这里引用。'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, singleLink('关联项目', projectOverviewId, '关联项目总览表；项目编号、项目名称、项目分类管理从这里引用。'), report);

  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('计划期次'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('计划总期数'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('计划开票金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('计划开票日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('预计回款日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, select('匹配状态', PLAN_STATUS_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, select('开票状态', INVOICE_STATUS_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, select('回款状态', PAYMENT_STATUS_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, text('发票编号', '本地同步按关联发票汇总发票编号显示值；一期开多张发票时用顿号合并。'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('实际开票金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('实际收款金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('实际开票日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('实际收款日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('未开票金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('未收款金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('开票差异金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('开票逾期天数'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, number('回款逾期天数'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, text('异常原因'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, text('数据来源'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, date('最后同步时间'), report);

  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('来源主体'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('发票编号'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('发票编号显示值'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('项目编号'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('项目名称'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('客户名称'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('开票申请人'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, date('开票日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('收入额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('税金'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('开票金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('收款金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, number('欠款金额'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, date('收款日期'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, select('匹配状态', INVOICE_MATCH_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, select('抵消状态', INVOICE_MATCH_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, select('是否纳入统计', YES_NO_OPTIONS), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('异常原因'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('源表名称'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('源记录ID'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, text('备注'), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, date('最后同步时间'), report);

  await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, planFields, singleLink('关联发票', actualDetailTableId, '脚本匹配到本计划期次的开票明细。', true), report);
  await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, detailFields, singleLink('关联计划', actualPlanTableId, '脚本匹配到的项目开票计划期次。'), report);

  const latestPlanFields = new Map((await listFields(client, actualPlanTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const latestDetailFields = new Map((await listFields(client, actualDetailTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const planLinkFieldId = latestPlanFields.get('关联项目')?.field_id || planProjectLink?.field_id;
  const detailLinkFieldId = latestDetailFields.get('关联项目')?.field_id;

  if (projectNoFieldId && projectNameFieldId && projectCategoryFieldId && planLinkFieldId) {
    await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, latestPlanFields, formula('项目编号', linkLookupExpression({ tableId: actualPlanTableId, linkFieldId: planLinkFieldId, targetFieldId: projectNoFieldId }), 1, '查找引用：由关联项目带出项目编号。'), report);
    await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, latestPlanFields, formula('项目名称', linkLookupExpression({ tableId: actualPlanTableId, linkFieldId: planLinkFieldId, targetFieldId: projectNameFieldId }), 1, '查找引用：由关联项目带出项目名称。'), report);
    await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, latestPlanFields, formula('项目分类管理', linkLookupExpression({ tableId: actualPlanTableId, linkFieldId: planLinkFieldId, targetFieldId: projectCategoryFieldId }), 1, '查找引用：由关联项目带出项目分类管理。'), report);
  }

  if (projectCategoryFieldId && detailLinkFieldId) {
    await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, latestDetailFields, formula('项目分类管理', linkLookupExpression({ tableId: actualDetailTableId, linkFieldId: detailLinkFieldId, targetFieldId: projectCategoryFieldId }), 1, '查找引用：由关联项目带出项目分类管理。'), report);
  }

  const newestPlanFields = new Map((await listFields(client, actualPlanTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const newestDetailFields = new Map((await listFields(client, actualDetailTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  const planCategoryFieldId = newestPlanFields.get('项目分类管理')?.field_id;
  const detailCategoryFieldId = newestDetailFields.get('项目分类管理')?.field_id;
  if (planCategoryFieldId) {
    await ensureField(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, newestPlanFields, formula('老板驾驶舱分组', dashboardGroupExpression(actualPlanTableId, planCategoryFieldId), 1, '公式：经营项目进入经营项目总览，走账项目进入走账项目总览，行政/内部项目不纳入。'), report);
  }
  if (detailCategoryFieldId) {
    await ensureField(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, newestDetailFields, formula('老板驾驶舱分组', dashboardGroupExpression(actualDetailTableId, detailCategoryFieldId), 1, '公式：经营项目进入经营项目总览，走账项目进入走账项目总览，行政/内部项目不纳入。'), report);
  }

  const finalPlanFields = new Map((await listFields(client, actualPlanTableId)).map((fieldItem) => [fieldItem.field_name, fieldItem]));
  await ensureFieldDescriptions(
    client,
    TARGET_TABLE_NAMES.invoicePlan,
    actualPlanTableId,
    finalPlanFields,
    INVOICE_PLAN_DESCRIPTIONS,
    report,
    { includeComputed: true },
  );

  await ensureViews(client, TARGET_TABLE_NAMES.invoicePlan, actualPlanTableId, [
    '待匹配计划',
    '金额异常待确认',
    '开票逾期',
    '回款逾期',
    '项目分类待确认',
  ], report);
  await ensureViews(client, TARGET_TABLE_NAMES.invoiceDetail, actualDetailTableId, [
    '待匹配发票',
    '项目未匹配发票',
    '金额异常待确认',
    '红冲待确认',
    '重复明细唯一键',
  ], report);

  return report;
}

const client = await connectFeishu([
  'bitable.v1.appTable.list',
  'bitable.v1.appTable.create',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableField.create',
  'bitable.v1.appTableField.update',
  'bitable.v1.appTableView.list',
  'bitable.v1.appTableView.create',
]);

try {
  const report = await ensureInvoiceModel(client);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
