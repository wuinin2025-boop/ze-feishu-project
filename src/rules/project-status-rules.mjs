function cleanText(value) {
  return String(value || '').trim();
}

export function listValue(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => {
      if (item == null) return [];
      if (typeof item === 'string' || typeof item === 'number') return [String(item).trim()];
      if (typeof item === 'object') return [item.text ?? item.name ?? item.value ?? ''];
      return [];
    }).map(cleanText).filter(Boolean))];
  }
  if (typeof value === 'object') return listValue(value.value ?? value.text ?? value.name);
  return cleanText(value).split('、').map(cleanText).filter(Boolean);
}

export function projectHasBusinessActivity({
  sourceStages = [],
  invoiceStatus = '',
  collectionStatus = '',
  amounts = {},
  linkedReceivableCount = 0,
}) {
  const hasAmount = Object.values(amounts).some((value) => Number(value || 0) > 0);
  return sourceStages.some((stage) => stage && stage !== '预立项')
    || cleanText(invoiceStatus) !== '' && cleanText(invoiceStatus) !== '未开票'
    || cleanText(collectionStatus) !== '' && cleanText(collectionStatus) !== '未收款'
    || hasAmount
    || Number(linkedReceivableCount || 0) > 0;
}

export function deriveProjectStatus({
  sourceStages = [],
  currentStatus = '',
  invoiceStatus = '',
  collectionStatus = '',
  hasActivity = false,
}) {
  const stages = listValue(sourceStages);
  const status = cleanText(currentStatus);
  const invoice = cleanText(invoiceStatus);
  const collection = cleanText(collectionStatus);

  if (status === '暂停') return '暂停';
  if (collection === '已收齐') return '已完成';
  if (invoice === '已全部开票') return '结算中';
  if (stages.includes('预立项') && !stages.some((stage) => stage !== '预立项')) return '未开始';
  if (hasActivity || stages.includes('立项')) return '进行中';
  return status || '未开始';
}
