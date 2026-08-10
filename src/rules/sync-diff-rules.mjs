const LAST_SYNC_FIELD = '最后同步时间';
const TIME_ONLY_FIELDS = new Set([LAST_SYNC_FIELD, '源更新时间']);

function cleanUpdateFieldsWithClears(row, clearableFields = []) {
  const clearable = new Set(clearableFields);
  return Object.fromEntries(Object.entries(row).filter(([fieldName, value]) => (
    value !== undefined
    && (
      clearable.has(fieldName)
      || (
        value !== ''
        && (!Array.isArray(value) || value.length > 0)
      )
    )
  )));
}

function comparableFieldValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return Number(value.toFixed(6));
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (item == null) return [];
        if (typeof item === 'string' || typeof item === 'number') return [String(item).trim()];
        if (typeof item === 'object') {
          if (Array.isArray(item.link_record_ids)) return item.link_record_ids;
          if (Array.isArray(item.record_ids)) return item.record_ids;
          return [item.record_id ?? item.id ?? item.text ?? item.name ?? item.value ?? ''];
        }
        return [];
      })
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean)
      .sort()
      .join('|');
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.link_record_ids)) return comparableFieldValue(value.link_record_ids);
    if (Array.isArray(value.record_ids)) return comparableFieldValue(value.record_ids);
    return comparableFieldValue(value.record_id ?? value.id ?? value.text ?? value.name ?? value.value ?? '');
  }
  return String(value).trim();
}

function fieldChanged(existingFields, fieldName, nextValue) {
  const current = comparableFieldValue(existingFields?.[fieldName]);
  const next = comparableFieldValue(nextValue);
  if (typeof current === 'number' || typeof next === 'number') {
    return Math.abs(Number(current || 0) - Number(next || 0)) >= 0.005;
  }
  return current !== next;
}

export function changedUpdateFields(existingFields, nextFields, options = {}) {
  const clearUnchangedLastSync = options.clearUnchangedLastSync !== false;
  const createOnlyFields = new Set(options.createOnlyFields || []);
  const fields = cleanUpdateFieldsWithClears(nextFields, options.clearableFields || []);
  for (const fieldName of createOnlyFields) delete fields[fieldName];
  const changedEntries = Object.entries(fields)
    .filter(([fieldName, value]) => !TIME_ONLY_FIELDS.has(fieldName) && fieldChanged(existingFields, fieldName, value));
  if (!changedEntries.length) {
    if (
      clearUnchangedLastSync
      && Object.hasOwn(fields, LAST_SYNC_FIELD)
      && comparableFieldValue(existingFields?.[LAST_SYNC_FIELD])
    ) {
      return { [LAST_SYNC_FIELD]: null };
    }
    return {};
  }
  const changed = Object.fromEntries(changedEntries);
  if (Object.hasOwn(fields, LAST_SYNC_FIELD)) changed[LAST_SYNC_FIELD] = fields[LAST_SYNC_FIELD];
  if (Object.hasOwn(fields, '源更新时间')) changed['源更新时间'] = fields['源更新时间'];
  return changed;
}
