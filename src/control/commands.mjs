const ACTIONS = {
  'dry-run': {
    label: '先演练，不写飞书',
    description: '完整跑一遍流程，但所有写入步骤都加 --dry-run。',
    command: ['sync:all', '--', '--dry-run'],
    danger: false,
  },
  'sync-all': {
    label: '一键同步全部',
    description: '同步默认流程：开票、校验、项目状态、权限、视图。不生成独立逾期回款明细表。',
    command: ['sync:all'],
    danger: true,
  },
  invoice: {
    label: '只同步开票回款',
    description: '同步开票回款，并检查开票数据。',
    command: ['sync:all', '--', '--only=invoice,verify-invoice'],
    danger: true,
  },
  permissions: {
    label: '只同步人员权限',
    description: '同步人员权限，并检查关键权限。',
    command: ['sync:all', '--', '--only=permissions,verify-permissions'],
    danger: true,
  },
  views: {
    label: '只整理日常视图',
    description: '整理日常视图和逾期视图字段。',
    command: ['sync:all', '--', '--only=views'],
    danger: true,
  },
  list: {
    label: '查看可用步骤',
    description: '列出 sync:all 支持的所有步骤。',
    command: ['sync:all', '--', '--list'],
    danger: false,
  },
};

export function commandForAction(action) {
  const spec = ACTIONS[action];
  if (!spec) throw new Error(`Unknown control action: ${action}`);
  return [...spec.command];
}

export function actionList() {
  return Object.entries(ACTIONS).map(([id, spec]) => ({
    id,
    label: spec.label,
    description: spec.description,
    danger: spec.danger,
  }));
}
