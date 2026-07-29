# Clean Feishu Invoice Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean `项目开票进度表_试运行` without carrying forward old `feishu-xmxt0716` receivable logic.

**Architecture:** Treat `feishu-xmxt0716` as read-only archive only. Implement new code in the clean `ze-feishu-project` repository. Start with a trial table and verification report; do not rename, clear, or delete old Feishu tables until the user approves trial results.

**Tech Stack:** Node.js ESM, Node built-in `node:test`, Feishu Open Platform Bitable APIs, a small local admin runner added only after trial data is correct.

## Global Constraints

- Do not reuse or run old `feishu-xmxt0716/scripts/sync-receivables.mjs`.
- Do not modify any Feishu table whose name starts with `源_`.
- Do not clear old `开票回款总览` records during trial.
- Build only `项目开票进度表_试运行` first.
- One progress row represents one planned or actual invoice node.
- If actual invoices are split more times than the original plan, generate more current execution rows automatically from invoice details.
- Actual invoice date comes from invoice detail `开票日期`.
- Payment date and payment amount come from invoice detail `收款日期` and `收款额`.
- Old project initialization is allowed, but uncertain rows must be marked `待人工补充` or `待人工确认`.
- Real permission member changes are Phase 2, after the trial invoice table passes.

---

## File Structure

- Create `README.md`: project purpose, safe-run rules, and source read-only warning.
- Create `docs/superpowers/specs/2026-07-30-feishu-invoice-progress-redesign.md`: approved design spec already committed remotely.
- Create `docs/superpowers/plans/2026-07-30-clean-feishu-invoice-progress.md`: this clean implementation plan.
- Create `src/config.mjs`: Feishu app token, table IDs, cutoff application number, target table names.
- Create `src/rules/invoice-progress-rules.mjs`: pure business rules.
- Create `test/invoice-progress-rules.test.mjs`: tests for business rules.
- Create `src/feishu/client.mjs`: small Feishu API wrapper.
- Create `src/feishu/schema.mjs`: create trial target tables, fields, and views.
- Create `src/feishu/sync-invoice-progress.mjs`: generate and upsert trial progress rows.
- Create `src/feishu/verify-invoice-progress.mjs`: produce verification report.
- Create `docs/trial-results/`: saved verification outputs after trial runs.

## Task 1: Bootstrap Clean Repo

**Files:**
- Create: `/Users/inin/Desktop/in/ze-feishu-project/README.md`
- Create: `/Users/inin/Desktop/in/ze-feishu-project/package.json`

**Interfaces:**
- Produces: a runnable clean Node project that does not depend on `feishu-xmxt0716`.

- [ ] **Step 1: Create `README.md`**

```md
# ze-feishu-project

Clean implementation for the Feishu project center.

## Safety Rules

- Never write to tables whose name starts with `源_`.
- Do not run old `feishu-xmxt0716` receivable sync scripts.
- Build and validate `项目开票进度表_试运行` before production cutover.
- Keep old Feishu tables untouched until trial data is approved.
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "ze-feishu-project",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test",
    "schema:invoice": "node src/feishu/schema.mjs",
    "sync:invoice": "node src/feishu/sync-invoice-progress.mjs",
    "verify:invoice": "node src/feishu/verify-invoice-progress.mjs"
  }
}
```

- [ ] **Step 3: Run baseline test command**

Run: `cd /Users/inin/Desktop/in/ze-feishu-project && npm test`

Expected: Node reports no tests found or zero tests run; no project errors.

## Task 2: Write Pure Business Rules First

**Files:**
- Create: `/Users/inin/Desktop/in/ze-feishu-project/src/config.mjs`
- Create: `/Users/inin/Desktop/in/ze-feishu-project/src/rules/invoice-progress-rules.mjs`
- Create: `/Users/inin/Desktop/in/ze-feishu-project/test/invoice-progress-rules.test.mjs`

**Interfaces:**
- Produces: `classifyApplication`, `deriveInvoiceStatus`, `derivePaymentStatus`, `buildOldProjectNodes`, `buildSplitInvoiceNodes`.

- [ ] **Step 1: Create failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOldProjectNodes,
  buildSplitInvoiceNodes,
  classifyApplication,
  deriveInvoiceStatus,
  derivePaymentStatus,
} from '../src/rules/invoice-progress-rules.mjs';

test('cutoff rules are explicit', () => {
  assert.equal(classifyApplication('202607270005'), 'old');
  assert.equal(classifyApplication('202607270006'), 'excluded-test');
  assert.equal(classifyApplication('202607270008'), 'excluded-test');
  assert.equal(classifyApplication('202607270009'), 'new');
});

test('invoice status supports upcoming and overdue reminders', () => {
  const today = Date.UTC(2026, 6, 30);
  assert.equal(deriveInvoiceStatus({ planDate: Date.UTC(2026, 7, 5), planAmount: 100, actualInvoiceAmount: 0, today }), '即将到期开票');
  assert.equal(deriveInvoiceStatus({ planDate: Date.UTC(2026, 6, 29), planAmount: 100, actualInvoiceAmount: 0, today }), '开票逾期');
  assert.equal(deriveInvoiceStatus({ planDate: Date.UTC(2026, 8, 1), planAmount: 100, actualInvoiceAmount: 0, today }), '未到期');
  assert.equal(deriveInvoiceStatus({ planDate: Date.UTC(2026, 6, 1), planAmount: 100, actualInvoiceAmount: 100, today }), '已开票');
});

test('payment status uses invoice detail received amount', () => {
  const today = Date.UTC(2026, 6, 30);
  assert.equal(derivePaymentStatus({ actualInvoiceAmount: 0, receivedAmount: 0, expectedPaymentDate: Date.UTC(2026, 6, 1), today }), '待开票');
  assert.equal(derivePaymentStatus({ actualInvoiceAmount: 100, receivedAmount: 100, expectedPaymentDate: Date.UTC(2026, 6, 1), today }), '已回款');
  assert.equal(derivePaymentStatus({ actualInvoiceAmount: 100, receivedAmount: 20, expectedPaymentDate: Date.UTC(2026, 6, 1), today }), '回款逾期');
});

test('old project with invoices adds a remaining final plan row', () => {
  const rows = buildOldProjectNodes({ projectNo: 'HT2026', approvedAmount: 1000 }, [
    { invoiceNo: 'F1', invoiceDate: 10, invoiceAmount: 200, receivedAmount: 200 },
    { invoiceNo: 'F2', invoiceDate: 20, invoiceAmount: 300, receivedAmount: 0 },
  ]);
  assert.deepEqual(rows.map((row) => row.currentPlanAmount), [200, 300, 500]);
  assert.deepEqual(rows.map((row) => row.generationStatus), ['根据历史发票自动生成', '根据历史发票自动生成', '待人工确认']);
});

test('actual split invoices create actual invoice count rows', () => {
  const rows = buildSplitInvoiceNodes([
    { originalPeriod: 1, originalPlanAmount: 300, originalPlanCount: 2 },
    { originalPeriod: 2, originalPlanAmount: 700, originalPlanCount: 2 },
  ], [
    { invoiceNo: 'F1', invoiceDate: 10, invoiceAmount: 200, receivedAmount: 200 },
    { invoiceNo: 'F2', invoiceDate: 20, invoiceAmount: 300, receivedAmount: 300 },
    { invoiceNo: 'F3', invoiceDate: 30, invoiceAmount: 500, receivedAmount: 0 },
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.currentPlanAmount), [200, 300, 500]);
  assert.deepEqual(rows.map((row) => row.currentPlanCount), [3, 3, 3]);
  assert.equal(rows[0].diffStatus, '实际拆分开票');
});
```

- [ ] **Step 2: Implement config**

```js
export const APP_TOKEN = 'UBbJbhoEQaYjmMsT43jcyjLWnnf';
export const CUTOFF_APPLICATION_NO = '202607270009';
export const EXCLUDED_TEST_APPLICATION_NOS = new Set(['202607270006', '202607270007', '202607270008']);

export const SOURCE_TABLES = {
  establishment: 'tblQzxPCsapUDyux',
  invoices: [
    { name: '集熠开票明细', id: 'tblgI0GGkDgjxxDr' },
    { name: '冶堂开票明细', id: 'tblD5TDKOcWKKfUC' },
    { name: '亦所开票明细', id: 'tbl6g0gLMUlKOVxF' }
  ]
};

export const TARGET_TABLE_NAMES = {
  invoiceProgressTrial: '项目开票进度表_试运行',
  invoiceCollection: '开票明细归集表',
  oldProjectPlan: '（旧项目）开票计划补录表',
  syncLog: '同步日志'
};
```

- [ ] **Step 3: Implement rules**

Create only deterministic pure functions. Do not import Feishu clients in this file. Required behavior:

- `classifyApplication` returns `old`, `new`, or `excluded-test`.
- `deriveInvoiceStatus` returns `待人工补充`, `已开票`, `部分开票`, `即将到期开票`, `开票逾期`, or `未到期`.
- `derivePaymentStatus` returns `待开票`, `已回款`, `回款逾期`, `部分回款`, `待回款`, or `待补预计回款日期`.
- `buildOldProjectNodes` sorts invoices by `invoiceDate`, creates one row per actual invoice, and adds a final remaining row when `approvedAmount - invoicedTotal > 0`.
- `buildSplitInvoiceNodes` returns actual invoice count rows when invoices exceed plan rows.

- [ ] **Step 4: Run tests**

Run: `cd /Users/inin/Desktop/in/ze-feishu-project && npm test`

Expected: all tests pass.

## Task 3: Create Trial Feishu Schema

**Files:**
- Create: `/Users/inin/Desktop/in/ze-feishu-project/src/feishu/client.mjs`
- Create: `/Users/inin/Desktop/in/ze-feishu-project/src/feishu/schema.mjs`

**Interfaces:**
- Consumes: `APP_TOKEN`, `TARGET_TABLE_NAMES`.
- Produces: target-only trial tables and views.

- [ ] **Step 1: Implement Feishu client wrapper**

Use the same MCP connection pattern as the old archive, but copy only the minimum helper functions into the clean repo:

- `connectFeishu(toolNames)`
- `callJson(client, name, args)`
- `searchAll(client, appToken, tableId, fieldNames)`
- `textValue(value)`
- `numberValue(value)`
- `timestampValue(value)`

- [ ] **Step 2: Implement schema script**

`schema.mjs` must:

- List target Base tables.
- Ensure tables named in `TARGET_TABLE_NAMES`.
- Ensure fields for `项目开票进度表_试运行`: project info, counts, periods, plan dates, actual invoice fields, payment fields, status fields, remarks, source key, last sync time.
- Ensure views: `待人工补充旧项目`, `金额异常待核对`, `实际拆分开票`, `即将到期开票`, `开票逾期`, `回款逾期`.
- Refuse to create or update anything with a table name starting `源_`.

- [ ] **Step 3: Dry run schema**

Run: `cd /Users/inin/Desktop/in/ze-feishu-project && node src/feishu/schema.mjs --dry-run`

Expected: report lists only target tables to create or verify.

- [ ] **Step 4: Apply schema**

Run: `cd /Users/inin/Desktop/in/ze-feishu-project && npm run schema:invoice`

Expected: target trial tables and views exist; no source table changed.

## Task 4: Sync Trial Data

**Files:**
- Create: `/Users/inin/Desktop/in/ze-feishu-project/src/feishu/sync-invoice-progress.mjs`

**Interfaces:**
- Consumes: source table IDs, pure rules, created target table names.
- Produces: trial progress rows.

- [ ] **Step 1: Implement dry-run first**

`sync-invoice-progress.mjs --dry-run` must read source tables and print:

- establishment record count
- invoice record count
- old project node count
- new project node count
- actual split node count
- manual-confirmation row count

It must not write records in dry-run.

- [ ] **Step 2: Implement guarded upsert**

Use a stable `源记录键`:

- Actual invoice row: `项目编号|当前执行期次|发票号码`
- Plan-only row: `项目编号|当前执行期次|计划`

Before any write, call:

```js
function assertTargetTableName(tableName) {
  if (tableName.startsWith('源_')) {
    throw new Error(`Refusing to write source table: ${tableName}`);
  }
}
```

- [ ] **Step 3: Run dry-run**

Run: `cd /Users/inin/Desktop/in/ze-feishu-project && node src/feishu/sync-invoice-progress.mjs --dry-run`

Expected: counts print; no target row count changes.

- [ ] **Step 4: Run trial sync**

Run: `cd /Users/inin/Desktop/in/ze-feishu-project && npm run sync:invoice`

Expected: records created or updated only in `项目开票进度表_试运行`, `开票明细归集表`, `（旧项目）开票计划补录表`, and `同步日志`.

## Task 5: Verify Trial Data Before Any Cutover

**Files:**
- Create: `/Users/inin/Desktop/in/ze-feishu-project/src/feishu/verify-invoice-progress.mjs`
- Create: `/Users/inin/Desktop/in/ze-feishu-project/docs/trial-results/2026-07-30-invoice-progress-verification.md`

**Interfaces:**
- Consumes: trial table records.
- Produces: pass/fail report and manual-confirmation list.

- [ ] **Step 1: Implement verifier**

Verify:

- `202607270009` is treated as new project.
- `202607270006` to `202607270008` are excluded from formal new-project logic.
- Every progress row has `项目编号`, `当前执行期次`, and `源记录键`.
- Actual split rows show `立项开票总次数` different from `当前开票总次数`.
- `回款金额` equals source invoice detail received amount.
- Rows with missing plan information are marked `待人工补充`.

- [ ] **Step 2: Run verifier**

Run: `cd /Users/inin/Desktop/in/ze-feishu-project && npm run verify:invoice`

Expected: JSON report with either `pass: true` or specific records requiring manual confirmation.

- [ ] **Step 3: Save trial result**

Write the verification summary to `docs/trial-results/2026-07-30-invoice-progress-verification.md`. Include sample rows for `2026韩泰轮胎专项费用`, `202607270009`, and `202607270012` if present.

## Task 6: User Review Gate

**Files:**
- No code changes.

**Interfaces:**
- Consumes: trial table and verification doc.
- Produces: explicit approval or requested corrections.

- [ ] **Step 1: Stop and ask user to review**

Ask the user to inspect `项目开票进度表_试运行` and the verification report.

- [ ] **Step 2: Do not cut over without approval**

Do not rename `项目开票进度表_试运行`, do not delete old `开票回款总览`, and do not enable production permission sync until the user explicitly approves.

## Phase 2 After Trial Approval

After Task 6 is approved, write a separate short plan for:

- real advanced-permission member sync
- departed employee immediate access removal
- admin web page with buttons for sync, verify, and permission sync
- final cutover from trial table to `项目开票进度表`

Keeping Phase 2 separate is intentional: it prevents permission changes from being mixed with invoice-data validation.

## Self-Review

- This plan no longer depends on old `feishu-xmxt0716` scripts.
- The old directory is treated as archive only.
- The first deliverable is only a trial table and verification report.
- Permission changes are separated into Phase 2 to reduce risk.
- There are no steps that write to `源_` tables.
