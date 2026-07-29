export const APP_TOKEN = 'UBbJbhoEQaYjmMsT43jcyjLWnnf';
export const CUTOFF_APPLICATION_NO = '202607270009';
export const EXCLUDED_TEST_APPLICATION_NOS = new Set(['202607270006', '202607270007', '202607270008']);

export const SOURCE_TABLES = {
  establishment: 'tblQzxPCsapUDyux',
  invoices: [
    { name: '集熠开票明细', id: 'tblgI0GGkDgjxxDr' },
    { name: '冶堂开票明细', id: 'tblD5TDKOcWKKfUC' },
    { name: '亦所开票明细', id: 'tbl6g0gLMUlKOVxF' },
  ],
};

export const TARGET_TABLE_NAMES = {
  invoiceProgressTrial: '项目开票进度表_试运行',
  invoiceCollection: '开票明细归集表',
  oldProjectPlan: '（旧项目）开票计划补录表',
  syncLog: '同步日志',
};

export const SELECT_OPTIONS = {
  invoiceStatus: ['待人工补充', '已开票', '部分开票', '即将到期开票', '开票逾期', '未到期'],
  paymentStatus: ['待开票', '已回款', '回款逾期', '部分回款', '待回款', '待补预计回款日期'],
  overallStatus: ['金额异常待核对', '项目负责人待处理', '回款逾期', '开票逾期', '即将到期开票', '部分回款', '待回款', '已回款', '未到期', '待人工补充'],
  generationStatus: ['源计划自动生成', '根据历史发票自动生成', '待人工确认', '待人工补充', '实际拆分开票'],
  diffStatus: ['无差异', '实际拆分开票', '金额异常待核对', '待人工确认'],
};

export const INVOICE_PROGRESS_FIELDS = [
  { name: '源记录键', type: 1, uiType: 'Text' },
  { name: '项目编号', type: 1, uiType: 'Text' },
  { name: '项目名称', type: 1, uiType: 'Text' },
  { name: '客户名称', type: 1, uiType: 'Text' },
  { name: '立项时项目负责人', type: 11, uiType: 'User' },
  { name: '当前权限负责人', type: 11, uiType: 'User' },
  { name: '立项开票总次数', type: 2, uiType: 'Number' },
  { name: '当前开票总次数', type: 2, uiType: 'Number' },
  { name: '原计划期次', type: 2, uiType: 'Number' },
  { name: '当前执行期次', type: 2, uiType: 'Number' },
  { name: '原计划开票金额', type: 2, uiType: 'Number' },
  { name: '当前计划开票金额', type: 2, uiType: 'Number' },
  { name: '计划开票日期', type: 5, uiType: 'DateTime' },
  { name: '预计回款日期', type: 5, uiType: 'DateTime' },
  { name: '实际开票日期', type: 5, uiType: 'DateTime' },
  { name: '实际开票金额', type: 2, uiType: 'Number' },
  { name: '回款日期', type: 5, uiType: 'DateTime' },
  { name: '回款金额', type: 2, uiType: 'Number' },
  { name: '未开票金额', type: 2, uiType: 'Number' },
  { name: '未回款金额', type: 2, uiType: 'Number' },
  { name: '逾期天数', type: 2, uiType: 'Number' },
  { name: '逾期金额', type: 2, uiType: 'Number' },
  { name: '开票状态', type: 3, uiType: 'SingleSelect', optionsKey: 'invoiceStatus' },
  { name: '回款状态', type: 3, uiType: 'SingleSelect', optionsKey: 'paymentStatus' },
  { name: '综合状态', type: 3, uiType: 'SingleSelect', optionsKey: 'overallStatus' },
  { name: '差异状态', type: 3, uiType: 'SingleSelect', optionsKey: 'diffStatus' },
  { name: '生成状态', type: 3, uiType: 'SingleSelect', optionsKey: 'generationStatus' },
  { name: '计划备注', type: 1, uiType: 'Text' },
  { name: '发票备注', type: 1, uiType: 'Text' },
  { name: '差异说明', type: 1, uiType: 'Text' },
  { name: '数据来源', type: 1, uiType: 'Text' },
  { name: '最后同步时间', type: 5, uiType: 'DateTime' },
];

export const INVOICE_COLLECTION_FIELDS = [
  { name: '源记录键', type: 1, uiType: 'Text' },
  { name: '来源表', type: 1, uiType: 'Text' },
  { name: '源记录ID', type: 1, uiType: 'Text' },
  { name: '发票号码', type: 1, uiType: 'Text' },
  { name: '项目编号', type: 1, uiType: 'Text' },
  { name: '项目名称', type: 1, uiType: 'Text' },
  { name: '客户名称', type: 1, uiType: 'Text' },
  { name: '开票日期', type: 5, uiType: 'DateTime' },
  { name: '开票金额', type: 2, uiType: 'Number' },
  { name: '回款日期', type: 5, uiType: 'DateTime' },
  { name: '回款金额', type: 2, uiType: 'Number' },
  { name: '备注', type: 1, uiType: 'Text' },
  { name: '匹配状态', type: 3, uiType: 'SingleSelect', options: ['自动匹配', '待人工确认', '未匹配项目'] },
  { name: '最后同步时间', type: 5, uiType: 'DateTime' },
];

export const OLD_PROJECT_PLAN_FIELDS = [
  { name: '源记录键', type: 1, uiType: 'Text' },
  { name: '项目编号', type: 1, uiType: 'Text' },
  { name: '项目名称', type: 1, uiType: 'Text' },
  { name: '开票总次数', type: 2, uiType: 'Number' },
  { name: '开票期次', type: 2, uiType: 'Number' },
  { name: '计划开票日期', type: 5, uiType: 'DateTime' },
  { name: '计划开票金额', type: 2, uiType: 'Number' },
  { name: '预计回款日期', type: 5, uiType: 'DateTime' },
  { name: '备注', type: 1, uiType: 'Text' },
  { name: '生成状态', type: 3, uiType: 'SingleSelect', optionsKey: 'generationStatus' },
  { name: '最后同步时间', type: 5, uiType: 'DateTime' },
];

export const SYNC_LOG_FIELDS = [
  { name: '运行时间', type: 5, uiType: 'DateTime' },
  { name: '运行类型', type: 1, uiType: 'Text' },
  { name: '结果', type: 3, uiType: 'SingleSelect', options: ['成功', '失败', '待确认'] },
  { name: '摘要', type: 1, uiType: 'Text' },
  { name: '详情JSON', type: 1, uiType: 'Text' },
];
