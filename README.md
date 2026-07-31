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
npm run setup:invoice-model
npm run verify:invoice
```

For a computer where the repository already exists:

```bash
cd /path/to/ze-feishu-project
git pull origin main
npm install
npm test
```

To create or repair the second-stage invoice model structure:

```bash
npm run setup:invoice-model
```

This is idempotent: it creates missing fields/tables/views and skips existing ones.

To refresh Feishu invoice data:

```bash
npm run sync:invoice
npm run verify:invoice
```

People collaborators, role members, and fine-grained permissions are maintained manually in Feishu advanced permissions. This repository no longer syncs or verifies role membership from system personnel tables.

Project status, daily views, overdue dashboards, sync logs, local control pages, and permission automation have been retired from the local scripts. Maintain those directly in Feishu.

`（旧项目）开票计划补录表` is currently maintained manually in Feishu. Local scripts must not create, update, prune, or restructure its records.

The second-stage invoice model uses:

- `项目总览表.项目分类管理`: manual source of truth for project classification. Values are `经营项目`, `行政/内部项目`, and `走账项目`.
- `项目开票计划表`: generated from approved `源_立项申请` invoice plan rows for new projects. Plan key is `项目编号-计划期次`.
- `开票明细统一表`: generated from the three `源_开票明细` tables. Invoice key uses source body plus invoice number; Hankook blank invoice numbers display as `Hankook 001`.

Classification is carried into the new invoice tables through `关联项目` and formula fields. Do not make scripts write project classification or boss-dashboard grouping as manual values.

Current matching rules:

- A source invoice is matched to the earliest unfinished plan period for the same project.
- Amount mismatches are marked `金额异常待确认`; excess amount is not rolled into the next period.
- Positive and negative invoice pairs with equal absolute amount cancel out and are excluded from statistics.
- `行政/内部项目` is excluded from boss-dashboard grouping; `经营项目` and `走账项目` are separated into their own overview groups.

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
- Do not write `项目分类管理` outside `项目总览表`; downstream tables should reference it through `关联项目`.
- Keep old Feishu invoice/progress tables untouched until the second-stage data is approved.

## Current Invoice Tables

- `项目开票计划表`
- `开票明细统一表`
- `（旧项目）开票计划补录表`

Daily operating views:

- `项目进度表` -> `日常任务`
- `（旧项目）开票计划补录表` -> `日常补录`
- `项目开票计划表` -> `待匹配计划`
- `项目开票计划表` -> `金额异常待确认`
- `项目开票计划表` -> `开票逾期`
- `项目开票计划表` -> `回款逾期`
- `开票明细统一表` -> `待匹配发票`
- `开票明细统一表` -> `红冲待确认`

Latest validation report:

- `docs/trial-results/2026-07-31-invoice-model-verification.md`
