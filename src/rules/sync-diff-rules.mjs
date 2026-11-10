const LAST_SYNC_FIELD = '最近同步时间';
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

function isEmptyFieldValue(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isDefaultableFieldValue(value, placeholders = []) {
  if (isEmptyFieldValue(value)) return true;
  const current = comparableFieldValue(value);
  return placeholders.some((placeholder) => comparableFieldValue(placeholder) === current);
}

export function changedUpdateFields(existingFields, nextFields, options = {}) {
  const createOnlyFields = new Set(options.createOnlyFields || []);
  const fillEmptyFields = new Set(options.fillEmptyFields || []);
  const fillDefaultFields = options.fillDefaultFields || {};
  const ignoredDiffFields = new Set(options.ignoredDiffFields || []);
  const fields = cleanUpdateFieldsWithClears(nextFields, options.clearableFields || []);
  for (const fieldName of createOnlyFields) delete fields[fieldName];
  for (const fieldName of fillEmptyFields) {
    if (!isEmptyFieldValue(existingFields?.[fieldName])) delete fields[fieldName];
  }
  for (const [fieldName, placeholders] of Object.entries(fillDefaultFields)) {
    if (!isDefaultableFieldValue(existingFields?.[fieldName], placeholders)) delete fields[fieldName];
  }
  const changedEntries = Object.entries(fields)
    .filter(([fieldName, value]) => (
      !TIME_ONLY_FIELDS.has(fieldName)
      && !ignoredDiffFields.has(fieldName)
      && (
        (options.distinguishEmptyFields?.includes(fieldName)
          && isEmptyFieldValue(existingFields?.[fieldName]) !== isEmptyFieldValue(value))
        || fieldChanged(existingFields, fieldName, value)
      )
    ));
  if (!changedEntries.length) {
    return {};
  }
  const changed = Object.fromEntries(changedEntries);
  for (const fieldName of ignoredDiffFields) {
    if (Object.hasOwn(fields, fieldName) && fieldChanged(existingFields, fieldName, fields[fieldName])) {
      changed[fieldName] = fields[fieldName];
    }
  }
  if (Object.hasOwn(fields, LAST_SYNC_FIELD)) changed[LAST_SYNC_FIELD] = fields[LAST_SYNC_FIELD];
  if (Object.hasOwn(fields, '源更新时间')) changed['源更新时间'] = fields['源更新时间'];
  return changed;
}

export function staleOrDuplicateRecordIds(existingRecords, currentKeys, keyField) {
  const desiredKeys = new Set(currentKeys.filter(Boolean));
  const groups = new Map();
  const stale = [];

  for (const record of existingRecords) {
    const key = comparableFieldValue(record.fields?.[keyField]);
    if (!key || !desiredKeys.has(key)) {
      stale.push(record.record_id);
      continue;
    }
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length > 1) stale.push(...group.slice(0, -1).map((record) => record.record_id));
  }

  return [...new Set(stale)];
}
