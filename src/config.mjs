export const APP_TOKEN = 'UBbJbhoEQaYjmMsT43jcyjLWnnf';
export const CUTOFF_APPLICATION_NO = '202607270009';
export const EXCLUDED_TEST_APPLICATION_NOS = new Set(['202607270006', '202607270007', '202607270008']);

export const SOURCE_TABLES = {
  establishment: 'tblQzxPCsapUDyux',
  projectLedgers: [
    { name: '源_集熠项目台账', company: '集熠', id: 'tblQA49eTNIxerfd' },
    { name: '源_冶堂项目台账', company: '冶堂', id: 'tblcHmatrhYBJS9H' },
    { name: '源_亦所项目台账', company: '亦所', id: 'tblex4d8lQtklySe' },
  ],
  invoices: [
    { name: '集熠开票明细', id: 'tblgI0GGkDgjxxDr' },
    { name: '冶堂开票明细', id: 'tblD5TDKOcWKKfUC' },
    { name: '亦所开票明细', id: 'tbl6g0gLMUlKOVxF' },
  ],
};

export const TARGET_TABLE_NAMES = {
  projectOverview: '项目总览表',
  projectProgress: '项目进度表',
  invoicePlan: '项目开票计划表',
  invoiceDetail: '开票明细统一表',
  oldProjectPlan: '（旧项目）开票计划补录表',
  supplierPayment: '供应商付款',
};
