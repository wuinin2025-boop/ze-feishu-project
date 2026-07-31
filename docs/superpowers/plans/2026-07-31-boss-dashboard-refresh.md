# Boss Dashboard Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh boss-facing operating metrics after `项目总览表.项目分类管理` is maintained manually.

**Architecture:** Keep project classification as a manual field only on `项目总览表`. `sync:invoice` aggregates the new invoice model into project-level financial fields and a small boss summary table with two rows: `经营项目总览` and `走账项目总览`. Feishu dashboards can then bind to `项目总览表` and `老板驾驶舱关键数据表`; administrative/internal projects are excluded from the summary table.

**Tech Stack:** Node.js ESM, Feishu MCP Bitable tools, `node:test`.

## Global Constraints

- Do not write any `源_` table.
- Do not create, update, prune, restructure, or migrate `（旧项目）开票计划补录表`.
- Do not change Feishu advanced permissions.
- `项目分类管理` remains manually maintained only in `项目总览表`.
- Boss dashboard includes `经营项目` and `走账项目`; it excludes `行政/内部项目`.
- Existing `项目总览表` formula fields are not written by scripts.

---

### Task 1: Dashboard Aggregation Rules

**Files:**
- Modify: `src/rules/invoice-progress-rules.mjs`
- Modify: `test/invoice-progress-rules.test.mjs`

**Interfaces:**
- Consumes: project overview rows, matched plan rows, matched invoice rows.
- Produces: `buildProjectOverviewMetricRows`, `buildBossDashboardRows`.

- [ ] **Step 1: Add tests for category exclusion and summary metrics**

Run: `npm test`
Expected: tests pass after implementation.

### Task 2: Structure

**Files:**
- Modify: `src/config.mjs`
- Modify: `src/feishu/ensure-invoice-model.mjs`

**Interfaces:**
- Consumes: Feishu MCP table/field/view tools.
- Produces: idempotent creation of `老板驾驶舱关键数据表`.

- [ ] **Step 1: Add target table name and fields**

Create `老板驾驶舱关键数据表` with fields for project count, amounts, completion rates, overdue/risk counts, next dates, and sync time.

### Task 3: Sync

**Files:**
- Modify: `src/feishu/sync-invoice-progress.mjs`
- Modify: `src/feishu/verify-invoice-progress.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: `项目总览表`, `项目开票计划表`, `开票明细统一表`.
- Produces: project overview financial refresh and two boss summary rows.

- [ ] **Step 1: Update project overview fields**

Write only non-formula summary fields: `已开票金额`, `已收款金额`, plan amounts/dates when plan rows exist, overdue amounts, and status warning fields.

- [ ] **Step 2: Upsert dashboard summary rows**

Rows: `经营项目总览`, `走账项目总览`.

- [ ] **Step 3: Verify**

Run: `npm test`, `npm run setup:invoice-model`, `npm run sync:invoice`, `npm run verify:invoice`.
