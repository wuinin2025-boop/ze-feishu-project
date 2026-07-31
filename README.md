# ze-feishu-project

Clean implementation for the Feishu project center.

## Continue on a New Computer

Before running the scripts, install Node.js 20+, sign in to Codex, and authorize the Feishu MCP connection for the target base.

For a completely new computer:

```bash
git clone https://github.com/wuinin2025-boop/ze-feishu-project.git
cd ze-feishu-project
npm install
npm test
npm run verify:invoice
```

For a computer where the repository already exists:

```bash
cd /path/to/ze-feishu-project
git pull origin main
npm install
npm test
```

To actually refresh Feishu trial data:

```bash
npm run sync:invoice
npm run verify:invoice
```

People collaborators, role members, and fine-grained permissions are maintained manually in Feishu advanced permissions. This repository no longer syncs or verifies role membership from system personnel tables.

Project status, daily views, overdue dashboards, sync logs, local control pages, and permission automation have been retired from the local scripts. Maintain those directly in Feishu.

`（旧项目）开票计划补录表` is currently maintained manually in Feishu. Local scripts must not create, update, prune, or restructure its records.

Prerequisites:

- Node.js 20+.
- Codex/Feishu MCP is configured on the new computer and can access the target Feishu base.
- The target Feishu base is editable; all `源_` tables remain read-only.

## Safety Rules

- Never write to tables whose name starts with `源_`.
- Do not run old `feishu-xmxt0716` receivable sync scripts.
- Do not run old permission automation scripts; Feishu advanced permissions are the source of truth for collaborators and role members.
- Do not run old project-status, views, boss-dashboard, sync-log, or local-control automation scripts.
- Do not let local scripts write `（旧项目）开票计划补录表`; it is under manual backfill.
- Build and validate `项目开票进度表_试运行` before production cutover.
- Keep old Feishu tables untouched until trial data is approved.

## Current Trial Tables

- `项目开票进度表_试运行`
- `开票明细归集表`
- `（旧项目）开票计划补录表`

Daily operating views:

- `项目进度表` -> `日常任务`
- `（旧项目）开票计划补录表` -> `日常补录`
- `项目开票进度表` -> `日常开票进度`
- `项目开票进度表` -> `开票逾期`
- `项目开票进度表` -> `回款逾期`

Latest validation report:

- `docs/trial-results/2026-07-30-invoice-progress-verification.md`
