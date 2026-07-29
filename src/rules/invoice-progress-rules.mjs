import { CUTOFF_APPLICATION_NO, EXCLUDED_TEST_APPLICATION_NOS } from '../config.mjs';

const DAY_MS = 86400000;

export function classifyApplication(applicationNo) {
  const value = String(applicationNo || '').trim();
  if (EXCLUDED_TEST_APPLICATION_NOS.has(value)) return 'excluded-test';
  return value >= CUTOFF_APPLICATION_NO ? 'new' : 'old';
}

export function deriveInvoiceStatus({ planDate, planAmount, actualInvoiceAmount = 0, today = Date.now() }) {
  if (!planDate || !planAmount) return '待人工补充';
  if (actualInvoiceAmount >= planAmount) return '已开票';
  if (actualInvoiceAmount > 0) return '部分开票';

  const daysUntil = Math.floor((planDate - today) / DAY_MS);
  if (daysUntil < 0) return '开票逾期';
  if (daysUntil <= 7) return '即将到期开票';
  return '未到期';
}

export function derivePaymentStatus({
  actualInvoiceAmount = 0,
  receivedAmount = 0,
  expectedPaymentDate,
  today = Date.now(),
}) {
  if (!actualInvoiceAmount) return '待开票';
  if (receivedAmount >= actualInvoiceAmount) return '已回款';
  if (!expectedPaymentDate) return '待补预计回款日期';
  if (expectedPaymentDate < today) return '回款逾期';
  if (receivedAmount > 0) return '部分回款';
  return '待回款';
}

export function buildOldProjectNodes(project, invoices) {
  const sortedInvoices = [...invoices].sort((left, right) => (left.invoiceDate || 0) - (right.invoiceDate || 0));
  const nodes = sortedInvoices.map((invoice, index) => ({
    projectNo: project.projectNo,
    projectName: project.projectName,
    executionPeriod: index + 1,
    currentPlanAmount: invoice.invoiceAmount || 0,
    planDate: invoice.invoiceDate,
    actualInvoiceDate: invoice.invoiceDate,
    actualInvoiceAmount: invoice.invoiceAmount || 0,
    paymentDate: invoice.paymentDate,
    receivedAmount: invoice.receivedAmount || 0,
    invoiceNo: invoice.invoiceNo,
    generationStatus: '根据历史发票自动生成',
  }));

  const invoicedTotal = nodes.reduce((sum, node) => sum + node.actualInvoiceAmount, 0);
  const remainingAmount = Math.max((project.approvedAmount || 0) - invoicedTotal, 0);

  if (remainingAmount > 0 || nodes.length === 0) {
    nodes.push({
      projectNo: project.projectNo,
      projectName: project.projectName,
      executionPeriod: nodes.length + 1,
      currentPlanAmount: remainingAmount,
      actualInvoiceAmount: 0,
      receivedAmount: 0,
      generationStatus: nodes.length === 0 ? '待人工补充' : '待人工确认',
    });
  }

  return nodes.map((node) => ({
    ...node,
    currentPlanCount: nodes.length,
  }));
}

export function buildSplitInvoiceNodes(planRows, invoices) {
  const sortedInvoices = [...invoices].sort((left, right) => (left.invoiceDate || 0) - (right.invoiceDate || 0));
  if (sortedInvoices.length <= planRows.length) {
    return planRows.map((planRow, index) => {
      const invoice = sortedInvoices[index];
      return {
        ...planRow,
        executionPeriod: index + 1,
        currentPlanCount: planRows.length,
        currentPlanAmount: planRow.originalPlanAmount || invoice?.invoiceAmount || 0,
        actualInvoiceDate: invoice?.invoiceDate,
        actualInvoiceAmount: invoice?.invoiceAmount || 0,
        paymentDate: invoice?.paymentDate,
        receivedAmount: invoice?.receivedAmount || 0,
        invoiceNo: invoice?.invoiceNo,
        diffStatus: '',
      };
    });
  }

  return sortedInvoices.map((invoice, index) => ({
    ...planRows[Math.min(index, planRows.length - 1)],
    executionPeriod: index + 1,
    currentPlanCount: sortedInvoices.length,
    currentPlanAmount: invoice.invoiceAmount || 0,
    actualInvoiceDate: invoice.invoiceDate,
    actualInvoiceAmount: invoice.invoiceAmount || 0,
    paymentDate: invoice.paymentDate,
    receivedAmount: invoice.receivedAmount || 0,
    invoiceNo: invoice.invoiceNo,
    diffStatus: '实际拆分开票',
  }));
}
