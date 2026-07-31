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
  projectOverview: '项目总览表',
  invoicePlan: '项目开票计划表',
  invoiceDetail: '开票明细统一表',
  oldProjectPlan: '（旧项目）开票计划补录表',
};

export const LEGACY_TABLE_NAMES = {
  invoiceProgress: '项目开票进度表',
  invoiceCollection: '开票明细归集表',
};
