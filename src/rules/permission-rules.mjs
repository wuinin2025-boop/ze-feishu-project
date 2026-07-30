const ROLE_CHAIN = {
  管理员: ['admin', 'manager', 'employee'],
  项目负责人: ['manager', 'employee'],
  普通员工: ['employee'],
};

const ROLE_NAME_BY_KEY = {
  admin: '管理员',
  manager: '项目负责人',
  employee: '普通员工',
};

const ROLE_KEYS = Object.keys(ROLE_NAME_BY_KEY);

export function uniquePeople(...groups) {
  const byId = new Map();
  for (const person of groups.flat()) {
    if (person?.id && !byId.has(person.id)) byId.set(person.id, { id: person.id });
  }
  return [...byId.values()];
}

export function buildPersonRecordRule(fields, { otherPermission = 0 } = {}) {
  if (!fields.length) throw new Error('Record rule requires at least one person field');
  return {
    conditions: fields.map((field) => ({
      field_name: field.field_name,
      operator: 'contains',
      value: [],
    })),
    conjunction: 'or',
    other_perm: otherPermission,
  };
}

export function buildFieldPermissions(fields, { hidden = [], editable = [] } = {}) {
  const hiddenSet = new Set(hidden);
  const editableSet = new Set(editable);
  return Object.fromEntries(fields.flatMap((field) => {
    const name = field.field_name;
    if (hiddenSet.has(name)) return [[name, 0]];
    if (editableSet.has(name)) return [[name, 3]];
    return [[name, 1]];
  }));
}

export function desiredRoleMemberships(rows) {
  const result = {
    admin: new Set(),
    manager: new Set(),
    employee: new Set(),
  };

  for (const row of rows) {
    if (row.employmentStatus !== '在职') continue;
    const roles = ROLE_CHAIN[row.identity];
    if (!row.userId || !roles) continue;
    for (const role of roles) result[role].add(row.userId);
  }
  return result;
}

export function derivePermissionRoleStatus({
  employmentStatus,
  identity,
  userId,
  roleMemberships,
  syncFailed = false,
}) {
  if (syncFailed) return '同步失败';
  if (!employmentStatus || !identity || !userId) return '待同步';

  const identityRoles = ROLE_CHAIN[identity];
  if (!identityRoles) return '待同步';

  let expectedRoles;
  if (employmentStatus === '在职') expectedRoles = new Set(identityRoles);
  else if (employmentStatus === '离职') expectedRoles = new Set();
  else return '待同步';

  const matches = ROLE_KEYS.every((role) => (
    Boolean(roleMemberships?.[ROLE_NAME_BY_KEY[role]]?.has(userId)) === expectedRoles.has(role)
  ));
  return matches ? '已同步' : '待同步';
}

export function personEligibility({ employmentStatus, identity, userId }) {
  if (!userId) return { eligible: false, reason: '人员缺少飞书用户' };
  if (employmentStatus !== '在职') return { eligible: false, reason: '人员非在职' };
  if (!['管理员', '项目负责人'].includes(identity)) return { eligible: false, reason: '人员身份无负责人权限' };
  return { eligible: true, reason: '有效负责人' };
}

export function departedManagerHandoff({ managers = [], handoffs = [], peopleById = new Map() }) {
  const departedManagers = managers.filter((person) => {
    const row = peopleById.get(person.id);
    return row?.employmentStatus === '离职';
  });
  if (!departedManagers.length) return { action: 'none', newManagers: managers, reason: '当前负责人未离职' };

  const validHandoffs = uniquePeople(handoffs).filter((person) => (
    personEligibility({ ...(peopleById.get(person.id) || {}), userId: person.id }).eligible
  ));
  if (!validHandoffs.length) {
    return {
      action: 'needs_handoff',
      newManagers: managers.filter((person) => !departedManagers.some((left) => left.id === person.id)),
      reason: '负责人离职且没有有效交接协同人',
    };
  }
  return {
    action: 'replace_with_handoff',
    newManagers: validHandoffs,
    reason: '负责人离职，自动交接给有效交接协同人',
  };
}

export function projectManagerPeople({ managers = [], handoffs = [] } = {}) {
  return uniquePeople(managers, handoffs);
}
