# ze-feishu-project

Clean implementation for the Feishu project center.

## Continue on a New Computer

```bash
git clone https://github.com/wuinin2025-boop/ze-feishu-project.git
cd ze-feishu-project
npm install
npm test
npm run verify:invoice
```

To actually refresh Feishu trial data:

```bash
npm run sync:invoice
npm run verify:invoice
```

To refresh the simplified daily views used by non-technical users:

```bash
npm run sync:views
```

Prerequisites:

- Node.js 20+.
- Codex/Feishu MCP is configured on the new computer and can access the target Feishu base.
- The target Feishu base is editable; all `源_` tables remain read-only.

## Safety Rules

- Never write to tables whose name starts with `源_`.
- Do not run old `feishu-xmxt0716` receivable sync scripts.
- Build and validate `项目开票进度表_试运行` before production cutover.
- Keep old Feishu tables untouched until trial data is approved.

## Current Trial Tables

- `项目开票进度表_试运行`
- `开票明细归集表`
- `（旧项目）开票计划补录表`
- `同步日志`

Daily operating views:

- `项目进度表` -> `日常任务`
- `（旧项目）开票计划补录表` -> `日常补录`
- `项目开票进度表` -> `日常开票进度`

Latest validation report:

- `docs/trial-results/2026-07-30-invoice-progress-verification.md`
