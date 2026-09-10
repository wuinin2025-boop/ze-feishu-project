export function extractApplicationNo(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/\d{8,}/);
  return match?.[0] || '';
}

export function buildSupplierCostKey({ poApplicationNo, paymentApplicationNo }) {
  const poNo = String(poApplicationNo || '').trim();
  const paymentNo = String(paymentApplicationNo || '').trim();
  if (poNo) return `PO|${poNo}`;
  if (paymentNo) return `付款未匹配PO|${paymentNo}`;
  return '';
}

export function isApprovedApplication(row) {
  return String(row?.applicationStatus || '').trim() === '已通过';
}

export function shouldIncludePaymentApplication(payment, poByApplicationNo) {
  if (!isApprovedApplication(payment)) return false;
  const linkedPoApplicationNo = String(payment?.linkedPoApplicationNo || '').trim();
  if (!linkedPoApplicationNo) return true;
  const linkedPo = poByApplicationNo.get(linkedPoApplicationNo);
  return !linkedPo || isApprovedApplication(linkedPo);
}

function paymentRecordScore(payment) {
  return (
    (Number(payment?.actualPaymentAmount || 0) !== 0 ? 8 : 0)
    + (payment?.actualPaymentDate ? 4 : 0)
    + (String(payment?.paymentStatus || '').trim() === '已付款' ? 2 : 0)
    + (Number(payment?.paymentAmount || 0) !== 0 ? 1 : 0)
  );
}

export function deduplicateSupplierPayments(payments = []) {
  const selected = new Map();
  for (const payment of payments) {
    const applicationNo = String(payment?.paymentApplicationNo || '').trim();
    const poIds = [...(payment?.linkedPoRecordIds || [])].sort().join(',');
    const projectNo = String(payment?.projectNo || '').trim().toUpperCase();
    const key = applicationNo && poIds
      ? `${projectNo}|${applicationNo}|${poIds}`
      : `record|${payment?.recordId || selected.size}`;
    const current = selected.get(key);
    if (!current || paymentRecordScore(payment) > paymentRecordScore(current)) {
      selected.set(key, payment);
    }
  }
  return [...selected.values()];
}

export function deriveSupplierPaymentStatus({
  poAmount = 0,
  appliedPaymentAmount = 0,
  actualPaymentAmount = 0,
}) {
  const cost = Number(poAmount || 0);
  const applied = Number(appliedPaymentAmount || 0);
  const actual = Number(actualPaymentAmount || 0);
  if (cost > 0 && actual - cost >= 0.005) return actual - cost >= 0.005 ? '超额付款' : '已付款';
  if (cost > 0 && Math.abs(actual - cost) < 0.005) return '已付款';
  if (actual > 0) return '部分付款';
  if (applied > 0) return '已申请待付款';
  return '未申请付款';
}

export function deriveSupplierInvoiceStatus(invoiceStatuses = []) {
  const normalized = invoiceStatuses.map((status) => String(status || '').trim()).filter(Boolean);
  if (!normalized.length) return '未申请付款';
  const receivedCount = normalized.filter((status) => status === '收到').length;
  const missingCount = normalized.filter((status) => status === '未收到').length;
  if (receivedCount === normalized.length) return '已收票';
  if (receivedCount > 0 && missingCount > 0) return '部分收票';
  if (missingCount === normalized.length) return '未收票';
  return '待确认';
}

export function supplierMatchStatus({ projectRecordId, paymentRecordIds = [], unmatchedPayment = false }) {
  if (unmatchedPayment) return '付款未匹配PO';
  if (!projectRecordId) return '项目未匹配';
  if (!paymentRecordIds.length) return '已匹配项目未匹配付款';
  return '已匹配项目和付款';
}
