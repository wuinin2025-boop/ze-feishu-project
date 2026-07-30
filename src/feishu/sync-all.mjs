#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NODE = process.execPath;

export const STEPS = [
  {
    id: 'check',
    label: '基础检查',
    description: '确认本地代码测试通过。',
    command: [NODE, ['--test']],
    verify: true,
  },
  {
    id: 'invoice',
    label: '同步开票回款',
    description: '从源立项、源开票明细、旧项目补录生成开票进度和发票归集。',
    command: [NODE, ['src/feishu/sync-invoice-progress.mjs']],
  },
  {
    id: 'verify-invoice',
    label: '检查开票数据',
    description: '检查开票进度、发票归集、旧项目补录是否对得上。',
    command: [NODE, ['src/feishu/verify-invoice-progress.mjs']],
    verify: true,
  },
  {
    id: 'project-status',
    label: '刷新项目状态',
    description: '按收款、开票、立项和业务活动自动更新项目状态。',
    command: [NODE, ['src/feishu/sync-project-status.mjs']],
  },
  {
    id: 'boss-dashboard',
    label: '刷新老板看板',
    description: '生成独立的逾期回款项目明细表。默认不同步，仅在明确选择时运行。',
    command: [NODE, ['src/feishu/sync-boss-dashboard.mjs']],
    default: false,
  },
  {
    id: 'permissions',
    label: '同步人员权限',
    description: '按人员身份、项目负责人、项目成员和负责人交接表刷新飞书高级权限。',
    command: [NODE, ['src/feishu/sync-permissions.mjs']],
  },
  {
    id: 'verify-permissions',
    label: '检查人员权限',
    description: '检查管理员、项目负责人、普通员工的关键权限是否符合当前脚本。',
    command: [NODE, ['src/feishu/verify-permissions.mjs']],
    verify: true,
  },
  {
    id: 'views',
    label: '整理日常视图',
    description: '隐藏同步字段和权限辅助字段，让日常填写界面简单一点。',
    command: [NODE, ['src/feishu/sync-views.mjs']],
  },
];

function parseOptions(argv) {
  const args = new Set(argv);
  const onlyArg = argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg
    ? new Set(onlyArg.slice('--only='.length).split(',').map((item) => item.trim()).filter(Boolean))
    : undefined;
  return {
    args,
    dryRun: args.has('--dry-run'),
    noVerify: args.has('--no-verify'),
    continueOnError: args.has('--continue-on-error'),
    only,
  };
}

export function selectedSteps(argv = process.argv.slice(2)) {
  const { noVerify, only } = parseOptions(argv);
  if (!only) return STEPS.filter((step) => step.default !== false && !(noVerify && step.verify));
  return STEPS.filter((step) => only.has(step.id) || only.has(step.label));
}

export function stepIds(steps) {
  return steps.map((step) => step.id);
}

function printStepList() {
  console.log('可运行步骤：');
  for (const step of STEPS) {
    console.log(`- ${step.id}: ${step.label}。${step.description}`);
  }
  console.log('');
  console.log('示例：');
  console.log('npm run sync:all');
  console.log('npm run sync:all -- --dry-run');
  console.log('npm run sync:all -- --only=invoice,project-status');
  console.log('npm run sync:all -- --only=boss-dashboard');
}

function runStep(step, { dryRun }) {
  const [command, baseArgs] = step.command;
  const commandArgs = [...baseArgs];
  if (dryRun && !step.verify && !commandArgs.includes('--dry-run')) commandArgs.push('--dry-run');

  return new Promise((resolve) => {
    const startedAt = Date.now();
    console.log('');
    console.log(`==== ${step.label} ====`);
    console.log(step.description);
    console.log(`运行命令：${[path.basename(command), ...commandArgs].join(' ')}`);

    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code, signal) => {
      resolve({
        id: step.id,
        label: step.label,
        code,
        signal,
        ok: code === 0,
        duration_ms: Date.now() - startedAt,
      });
    });
  });
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  if (options.args.has('--list')) {
    printStepList();
    return 0;
  }

  const steps = selectedSteps(argv);
  if (!steps.length) {
    printStepList();
    throw new Error('没有匹配到要运行的步骤，请检查 --only 参数。');
  }

  const startedAt = Date.now();
  const results = [];
  console.log(JSON.stringify({
    dry_run: options.dryRun,
    no_verify: options.noVerify,
    continue_on_error: options.continueOnError,
    steps: steps.map((step) => ({ id: step.id, label: step.label })),
  }, null, 2));

  for (const step of steps) {
    const result = await runStep(step, options);
    results.push(result);
    if (!result.ok && !options.continueOnError) break;
  }

  const failed = results.filter((result) => !result.ok);
  console.log('');
  console.log('==== 总结 ====');
  console.log(JSON.stringify({
    dry_run: options.dryRun,
    ok: failed.length === 0 && results.length === steps.length,
    total_duration_ms: Date.now() - startedAt,
    completed: results.length,
    planned: steps.length,
    failed: failed.map((result) => ({
      id: result.id,
      label: result.label,
      code: result.code,
      signal: result.signal,
    })),
    results,
  }, null, 2));

  return failed.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const code = await runCli();
  if (code) process.exit(code);
}
