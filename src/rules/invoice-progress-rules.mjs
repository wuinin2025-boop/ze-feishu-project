import { CUTOFF_APPLICATION_NO, EXCLUDED_TEST_APPLICATION_NOS } from '../config.mjs';

const DAY_MS = 86400000;
const HANKOOK_CUSTOMER_NAME = 'Hankook & Company Co., Ltd';
const HANKOOK_DISPLAY_INVOICE_NO = 'Hankook 001';
const THIRTY_DAYS_MS = DAY_MS * 30;

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

export function buildProgressKey({ projectNo, executionPeriod, invoiceNo }) {
  return [projectNo || '未匹配项目', executionPeriod || '未定期次', invoiceNo || '计划'].join('|');
}

export function buildPlanUniqueKey({ projectNo, period }) {
  return [projectNo || '未匹配项目', period || '未定期次'].join('-');
}

export function classifyDashboardGroup(category) {
  const value = String(category || '').trim();
  if (value === '经营项目') return '经营项目总览';
  if (value === '走账项目') return '走账项目总览';
  if (value === '行政/内部项目') return '不纳入';
  return '项目分类待确认';
}

export function isIncludedInBossDashboard(category) {
  return ['经营项目', '走账项目'].includes(String(category || '').trim());
}

export function dashboardGroupForCategory(category) {
  const group = classifyDashboardGroup(category);
  return ['经营项目总览', '走账项目总览'].includes(group) ? group : '';
}

export function normalizeInvoiceNo({ customerName, invoiceNo }) {
  const rawInvoiceNo = String(invoiceNo || '').trim();
  const normalizedCustomerName = String(customerName || '').trim();
  const isHankook = normalizedCustomerName === HANKOOK_CUSTOMER_NAME;
  if (rawInvoiceNo) {
    return {
      rawInvoiceNo,
      displayInvoiceNo: rawInvoiceNo,
      invoiceNoMissing: false,
      isHankook,
    };
  }
  if (isHankook) {
    return {
      rawInvoiceNo: '',
      displayInvoiceNo: HANKOOK_DISPLAY_INVOICE_NO,
      invoiceNoMissing: false,
      isHankook: true,
    };
  }
  return {
    rawInvoiceNo: '',
    displayInvoiceNo: '',
    invoiceNoMissing: true,
    isHankook: false,
  };
}

export function buildInvoiceDetailKey(invoice) {
  const sourceName = String(invoice?.sourceName || '').trim() || '未知来源';
  const sourceId = String(invoice?.sourceId || '').trim();
  const projectNo = String(invoice?.projectNo || '').trim();
  const invoiceAmount = Number(invoice?.invoiceAmount || 0);
  const invoiceDate = invoice?.invoiceDate || '';
  const { displayInvoiceNo, invoiceNoMissing, isHankook } = normalizeInvoiceNo(invoice || {});
  if (displayInvoiceNo && !isHankook) return `${sourceName}|${displayInvoiceNo}`;
  if (isHankook) return [sourceName, projectNo || '未匹配项目', displayInvoiceNo, sourceId || invoiceDate || invoiceAmount].join('|');
  return [sourceName, '发票编号缺失', projectNo || '未匹配项目', sourceId || invoiceDate || invoiceAmount].join('|');
}

export function deriveOverdueDays({ date, today = Date.now(), active = true }) {
  if (!active || !date) return 0;
  return Math.max(Math.floor((today - date) / DAY_MS), 0);
}

export function buildInvoiceCollectionTitle(invoice) {
  const sourceName = String(invoice?.sourceName || '').trim();
  const projectNo = String(invoice?.projectNo || '').trim();
  const invoiceNo = normalizeInvoiceNo(invoice || {}).displayInvoiceNo;
  const sourceId = String(invoice?.sourceId || '').trim();
  const identifier = invoiceNo || sourceId || '未命名发票';
  return [sourceName, projectNo, identifier].filter(Boolean).join('|');
}

export function deriveOverallStatus({ invoiceStatus, paymentStatus, diffStatus }) {
  if (diffStatus === '金额异常待核对') return '金额异常待核对';
  if (paymentStatus === '回款逾期') return '回款逾期';
  if (invoiceStatus === '开票逾期') return '开票逾期';
  if (invoiceStatus === '即将到期开票') return '即将到期开票';
  if (paymentStatus === '部分回款') return '部分回款';
  if (paymentStatus === '待回款') return '待回款';
  if (paymentStatus === '已回款') return '已回款';
  if (invoiceStatus === '未到期') return '未到期';
  return '待人工补充';
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

export function collapseReversedInvoices(invoices) {
  const remaining = [];
  const used = new Set();
  for (let index = 0; index < invoices.length; index += 1) {
    if (used.has(index)) continue;
    const invoice = invoices[index];
    if ((invoice.invoiceAmount || 0) < 0) {
      const matchIndex = remaining.findIndex((candidate) => (
        Math.abs((candidate.invoiceAmount || 0) + (invoice.invoiceAmount || 0)) < 0.01
        && !used.has(candidate.__sourceIndex)
      ));
      if (matchIndex >= 0) {
        used.add(remaining[matchIndex].__sourceIndex);
        used.add(index);
        remaining.splice(matchIndex, 1);
        continue;
      }
    }
    remaining.push({ ...invoice, __sourceIndex: index });
  }
  return remaining.map(({ __sourceIndex, ...invoice }) => invoice);
}

export function markOffsetInvoices(invoices) {
  const rows = invoices.map((invoice, index) => ({
    ...invoice,
    __index: index,
    detailKey: invoice.detailKey || buildInvoiceDetailKey(invoice),
    offsetStatus: '未抵消',
    includedInStats: true,
  }));
  const positives = [];

  for (const row of rows) {
    const amount = Number(row.invoiceAmount || 0);
    if (amount < 0) {
      const match = positives.find((candidate) => (
        candidate.includedInStats
        && candidate.projectNo === row.projectNo
        && Math.abs(Number(candidate.invoiceAmount || 0) + amount) < 0.01
      ));
      row.includedInStats = false;
      if (match) {
        match.includedInStats = false;
        match.offsetStatus = '已抵消';
        match.offsetWith = row.detailKey;
        row.offsetStatus = '已抵消';
        row.offsetWith = match.detailKey;
      } else {
        row.offsetStatus = '红冲待确认';
      }
      continue;
    }
    positives.push(row);
  }

  return rows.map(({ __index, ...row }) => row);
}

export function matchInvoicesToPlans(plans, invoices, { today = Date.now() } = {}) {
  const matchedPlans = [...plans]
    .sort((left, right) => (Number(left.period || 0) - Number(right.period || 0)))
    .map((plan) => ({
      ...plan,
      planKey: plan.planKey || buildPlanUniqueKey(plan),
      linkedInvoiceKeys: [],
      actualInvoiceAmount: 0,
      receivedAmount: 0,
      actualInvoiceDate: undefined,
      paymentDate: undefined,
      matchStatus: '待匹配',
      diffStatus: '无差异',
    }));

  const planByKey = new Map(matchedPlans.map((plan) => [plan.planKey, plan]));
  const matchedInvoices = markOffsetInvoices(invoices)
    .sort((left, right) => (left.invoiceDate || 0) - (right.invoiceDate || 0))
    .map((invoice) => ({ ...invoice, matchStatus: '待匹配', linkedPlanKey: '' }));

  for (const invoice of matchedInvoices) {
    if (!invoice.includedInStats) {
      invoice.matchStatus = invoice.offsetStatus;
      continue;
    }
    if (!invoice.projectNo) {
      invoice.matchStatus = '未匹配项目';
      continue;
    }
    const target = matchedPlans.find((plan) => (
      plan.projectNo === invoice.projectNo
      && plan.actualInvoiceAmount < Number(plan.planAmount || 0) - 0.01
    ));
    if (!target) {
      invoice.matchStatus = '计划外开票';
      continue;
    }

    invoice.linkedPlanKey = target.planKey;
    target.linkedInvoiceKeys.push(invoice.detailKey || buildInvoiceDetailKey(invoice));
    target.actualInvoiceAmount += Number(invoice.invoiceAmount || 0);
    target.receivedAmount += Number(invoice.receivedAmount || 0);
    target.actualInvoiceDate = target.actualInvoiceDate || invoice.invoiceDate;
    target.paymentDate = invoice.paymentDate || target.paymentDate;
    invoice.matchStatus = '自动匹配';
  }

  for (const plan of matchedPlans) {
    const planAmount = Number(plan.planAmount || 0);
    const actualAmount = Number(plan.actualInvoiceAmount || 0);
    if (actualAmount > planAmount + 0.01) {
      plan.matchStatus = '金额异常待确认';
      plan.diffStatus = '金额异常待确认';
    } else if (actualAmount > 0) {
      plan.matchStatus = actualAmount >= planAmount - 0.01 ? '已匹配' : '部分匹配';
    }
    plan.invoiceStatus = deriveInvoiceStatus({
      planDate: plan.planDate,
      planAmount,
      actualInvoiceAmount: actualAmount,
      today,
    });
    plan.paymentStatus = derivePaymentStatus({
      actualInvoiceAmount: actualAmount,
      receivedAmount: plan.receivedAmount,
      expectedPaymentDate: plan.expectedPaymentDate,
      today,
    });
    plan.uninvoicedAmount = Math.max(planAmount - actualAmount, 0);
    plan.unpaidAmount = Math.max(actualAmount - Number(plan.receivedAmount || 0), 0);
    plan.invoiceOverdueDays = deriveOverdueDays({
      date: plan.planDate,
      today,
      active: plan.invoiceStatus === '开票逾期',
    });
    plan.paymentOverdueDays = deriveOverdueDays({
      date: plan.expectedPaymentDate,
      today,
      active: plan.paymentStatus === '回款逾期',
    });
  }

  return {
    plans: matchedPlans,
    invoices: matchedInvoices.map((invoice) => ({
      ...invoice,
      linkedPlanRecordId: invoice.linkedPlanKey ? planByKey.get(invoice.linkedPlanKey)?.recordId : undefined,
    })),
  };
}

function roundCurrency(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function earliestDate(values) {
  return values.filter(Boolean).sort((left, right) => left - right)[0];
}

function addInvoiceAgg(map, invoice) {
  if (!invoice.projectNo || !invoice.includedInStats) return;
  const agg = map.get(invoice.projectNo) || {
    invoiceAmount: 0,
    receivedAmount: 0,
    invoiceCount: 0,
  };
  agg.invoiceAmount += Number(invoice.invoiceAmount || 0);
  agg.receivedAmount += Number(invoice.receivedAmount || 0);
  agg.invoiceCount += 1;
  map.set(invoice.projectNo, agg);
}

function addPlanAgg(map, plan, today) {
  if (!plan.projectNo) return;
  const agg = map.get(plan.projectNo) || {
    planCount: 0,
    planAmount: 0,
    nextPlans: [],
    nextPayments: [],
    invoiceOverdueAmount: 0,
    paymentOverdueAmount: 0,
    amountExceptionCount: 0,
    future30PlanAmount: 0,
  };
  const planAmount = Number(plan.planAmount || 0);
  agg.planCount += 1;
  agg.planAmount += planAmount;
  if ((plan.actualInvoiceAmount || 0) < planAmount - 0.01) {
    agg.nextPlans.push({ date: plan.planDate, amount: planAmount });
    if (plan.planDate && plan.planDate >= today && plan.planDate <= today + THIRTY_DAYS_MS) {
      agg.future30PlanAmount += Math.max(planAmount - Number(plan.actualInvoiceAmount || 0), 0);
    }
  }
  if ((plan.receivedAmount || 0) < (plan.actualInvoiceAmount || 0) - 0.01) {
    agg.nextPayments.push(plan.expectedPaymentDate);
  }
  if (plan.invoiceStatus === '开票逾期') agg.invoiceOverdueAmount += Number(plan.uninvoicedAmount || 0);
  if (plan.paymentStatus === '回款逾期') agg.paymentOverdueAmount += Number(plan.unpaidAmount || 0);
  if (plan.matchStatus === '金额异常待确认' || plan.diffStatus === '金额异常待确认') agg.amountExceptionCount += 1;
  map.set(plan.projectNo, agg);
}

function projectInvoiceStatus({ plannedAmount, invoiceAmount }) {
  if (plannedAmount > 0 && invoiceAmount >= plannedAmount - 0.01) return '已全部开票';
  if (invoiceAmount > 0) return '部分开票';
  return '未开票';
}

function projectPaymentStatus({ invoiceAmount, receivedAmount }) {
  if (invoiceAmount > 0 && receivedAmount >= invoiceAmount - 0.01) return '已收齐';
  if (receivedAmount > 0) return '部分收款';
  return '未收款';
}

function warningStatus({ overdueAmount, nextDate, today }) {
  if (Number(overdueAmount || 0) > 0) return '逾期';
  if (nextDate && nextDate >= today && nextDate <= today + 7 * DAY_MS) return '即将到期';
  return '正常';
}

export function buildProjectOverviewMetricRows({ projects, plans, invoices, today = Date.now() }) {
  const invoiceByProject = new Map();
  const planByProject = new Map();
  for (const invoice of invoices) addInvoiceAgg(invoiceByProject, invoice);
  for (const plan of plans) addPlanAgg(planByProject, plan, today);

  return projects.flatMap((project) => {
    const invoiceAgg = invoiceByProject.get(project.projectNo);
    const planAgg = planByProject.get(project.projectNo);
    if (!invoiceAgg && !planAgg) return [];

    const invoiceAmount = roundCurrency(invoiceAgg?.invoiceAmount);
    const receivedAmount = roundCurrency(invoiceAgg?.receivedAmount);
    const planAmount = roundCurrency(planAgg?.planAmount);
    const nextPlan = (planAgg?.nextPlans || [])
      .filter((item) => item.date)
      .sort((left, right) => left.date - right.date)[0];
    const nextPaymentDate = earliestDate(planAgg?.nextPayments || []);
    const invoiceOverdueAmount = roundCurrency(planAgg?.invoiceOverdueAmount);
    const paymentOverdueAmount = roundCurrency(planAgg?.paymentOverdueAmount);

    return [{
      recordId: project.recordId,
      projectNo: project.projectNo,
      fields: {
        '最后同步时间': today,
        ...(invoiceAgg ? {
          '已开票金额': invoiceAmount,
          '已收款金额': receivedAmount,
        } : {}),
        ...(planAgg ? {
          '预计开票总次数': planAgg.planCount,
          '计划开票总金额': planAmount,
          '下一计划开票日期': nextPlan?.date,
          '下一计划开票金额': nextPlan?.amount,
          '下一预计回款日期': nextPaymentDate,
          '逾期开票金额': invoiceOverdueAmount,
          '逾期回款金额': paymentOverdueAmount,
          '开票状态': projectInvoiceStatus({ plannedAmount: planAmount, invoiceAmount }),
          '客户收款状态': projectPaymentStatus({ invoiceAmount, receivedAmount }),
          '开票计划预警': warningStatus({ overdueAmount: invoiceOverdueAmount, nextDate: nextPlan?.date, today }),
          '回款计划预警': warningStatus({ overdueAmount: paymentOverdueAmount, nextDate: nextPaymentDate, today }),
        } : {}),
      },
    }];
  });
}
