export function mergeUsers(...groups) {
  const usersById = new Map();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const user of group) {
      const id = String(user?.id || '').trim();
      if (!id || usersById.has(id)) continue;
      usersById.set(id, {
        id,
        ...(user?.name ? { name: String(user.name).trim() } : {}),
      });
    }
  }
  return [...usersById.values()];
}

export function writableUsers(users) {
  return mergeUsers(users).map(({ id }) => ({ id }));
}

export function buildProjectParticipants({ manager, planners, designers, executors }) {
  const managerIds = new Set(mergeUsers(manager).map((user) => user.id));
  return mergeUsers(planners, designers, executors)
    .filter((user) => !managerIds.has(user.id));
}

function resolveManager(rows, source) {
  const people = mergeUsers(...rows.map((row) => row?.manager));
  if (people.length <= 1) return { manager: people, conflict: null };
  return {
    manager: [],
    conflict: {
      source,
      people: people.map((person) => person.name || person.id),
    },
  };
}

export function resolveProjectPeople({ establishmentRows = [], ledgerRows = [] }) {
  const establishment = resolveManager(establishmentRows, '源_立项申请');
  const managerResult = establishment.manager.length || establishment.conflict
    ? establishment
    : resolveManager(ledgerRows, '源_项目台账');
  const participants = mergeUsers(...establishmentRows.map((row) => row?.participants));
  const managerIds = new Set(managerResult.manager.map((user) => user.id));
  return {
    manager: managerResult.manager,
    participants: participants.filter((user) => !managerIds.has(user.id)),
    conflict: managerResult.conflict,
  };
}
