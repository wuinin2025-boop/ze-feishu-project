# Invoice Plan Detail Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old invoice progress trial model with a maintainable `项目开票计划表` + `开票明细统一表` model while keeping `（旧项目）开票计划补录表` untouched.

**Architecture:** Feishu `源_` tables remain read-only. The local scripts ensure the target table structure, sync approved new-project plan rows and invoice details into the two new tables, and run complex matching/verification that Feishu formulas should not own. Project category is maintained only on `项目总览表` and carried into downstream tables through `关联项目` fields; formula/lookup fields can be added in Feishu UI where native references are preferred.

**Tech Stack:** Node.js ESM, Feishu MCP Bitable tools, `node:test`.

## Global Constraints

- Never write to `源_` tables.
- Never create, update, prune, restructure, or migrate `（旧项目）开票计划补录表` while manual backfill is in progress.
- Keep Feishu advanced permissions as the source of truth for collaborators and role members.
- `项目总览表` may only receive the approved `项目分类管理` field in this stage.
- Boss dashboard classification is derived from `项目分类管理`: include `经营项目` and `走账项目`, exclude `行政/内部项目`, surface blank classification as `项目分类待确认`.
- Plan unique key is `项目编号 + "-" + 计划期次`.
- Amount mismatches are assigned to the earliest unfinished period and marked `金额异常待确认`; do not roll excess amount to later periods.
- `+金额` and `-金额` pairs cancel out and are excluded from statistics.
- `Hankook & Company Co., Ltd` may have no invoice number; display `Hankook 001` and match by `项目编号`.

---

### Task 1: Invoice Model Rules

**Files:**
- Modify: `src/rules/invoice-progress-rules.mjs`
- Modify: `test/invoice-progress-rules.test.mjs`

**Interfaces:**
- Consumes: normalized project plan rows and invoice rows.
- Produces: `buildPlanUniqueKey`, `buildInvoiceDetailKey`, `normalizeInvoiceNo`, `matchInvoicesToPlans`, `classifyBossDashboardGroup`.

- [ ] **Step 1: Add failing tests**

```js
assert.equal(buildPlanUniqueKey({ projectNo: 'P1', period: 2 }), 'P1-2');
assert.equal(normalizeInvoiceNo({ customerName: 'Hankook & Company Co., Ltd', invoiceNo: '' }).displayInvoiceNo, 'Hankook 001');
assert.equal(classifyBossDashboardGroup('行政/内部项目'), '不纳入');
assert.equal(classifyBossDashboardGroup('走账项目'), '走账项目总览');
```

- [ ] **Step 2: Implement rule helpers**

Add stable key generation, Hankook display-number handling, red offset exclusion, overdue day calculation, and earliest-unfinished-period matching.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all `node:test` tests pass.

### Task 2: Feishu Structure Setup

**Files:**
- Modify: `src/config.mjs`
- Create: `src/feishu/ensure-invoice-model.mjs`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: Feishu MCP tools `bitable_v1_appTable_create`, `bitable_v1_appTableField_create`, `bitable_v1_appTableField_list`, `bitable_v1_appTableView_create`.
- Produces: `npm run setup:invoice-model`.

- [ ] **Step 1: Add target table names**

Add `invoicePlan: '项目开票计划表'` and `invoiceDetail: '开票明细统一表'`. Keep legacy names separate for read-only verification where needed.

- [ ] **Step 2: Add idempotent table/field creation**

Create missing target tables, add scalar fields, add `关联项目` single-link fields, and add `项目分类管理` to `项目总览表` if missing. Do not touch `（旧项目）开票计划补录表`.

- [ ] **Step 3: Add views**

Create simple grid views for `全部计划`, `待匹配计划`, `金额异常待确认`, `开票逾期`, `回款逾期`, `全部明细`, `待匹配发票`, `红冲待确认`, and `重复明细唯一键` when missing.

- [ ] **Step 4: Verify dry behavior**

Run: `npm run setup:invoice-model -- --dry-run`
Expected: report lists planned structural changes without writes.

### Task 3: Sync New Tables

**Files:**
- Modify: `src/feishu/sync-invoice-progress.mjs`
- Modify: `src/feishu/verify-invoice-progress.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: `项目总览表`, `源_立项申请`, three `源_开票明细` tables.
- Produces: rows in `项目开票计划表` and `开票明细统一表`.

- [ ] **Step 1: Update sync inputs**

Read approved source establishment rows and source invoice detail rows. Read `项目总览表` for `关联项目` record IDs and `项目分类管理`.

- [ ] **Step 2: Write new targets only**

Upsert by `计划唯一键` into `项目开票计划表` and by `明细唯一键` into `开票明细统一表`. Do not upsert `项目开票进度表`, `开票明细归集表`, or `（旧项目）开票计划补录表`.

- [ ] **Step 3: Update verification**

Check new tables exist, no blank titles, no duplicate keys, source invoice amount equals included unified amount after red offsets, administrative/internal projects are excluded from boss-dashboard grouping, and old supplement rows are not written.

- [ ] **Step 4: Run verification**

Run: `npm test`, `npm run sync:invoice -- --dry-run`, `npm run verify:invoice`.
Expected: tests pass, dry run reports only new target tables, verification passes after setup and sync.
