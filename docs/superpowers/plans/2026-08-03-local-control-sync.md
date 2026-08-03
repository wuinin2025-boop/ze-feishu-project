# 本地网页同步控制台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用本地网页按钮替代复杂飞书自动化公式，统一刷新项目总览、项目开票计划和开票明细统一表。

**Architecture:** 飞书自带同步只负责更新 9 张 `源_` 表；本地脚本读取源表和人工维护表，写入业务目标表。`（旧项目）开票计划补录表` 和所有 `源_` 表只读，`项目分类管理` 只在 `项目总览表` 人工维护。

**Tech Stack:** Node.js 20、飞书 MCP、多维表格 OpenAPI、Node 内置 HTTP 服务。

## Global Constraints

- 不写任何 `源_` 表。
- 不写 `（旧项目）开票计划补录表`。
- 不覆盖 `项目分类管理`。
- `项目阶段` 由脚本根据项目情况自动写入，不由人工维护。
- `行政/内部项目` 不进入老板驾驶舱金额统计。
- 经营项目和走账项目分开展示。

---

### Task 1: 同步脚本收口

**Files:**
- Modify: `src/config.mjs`
- Modify: `src/feishu/sync-invoice-progress.mjs`
- Modify: `src/rules/invoice-progress-rules.mjs`
- Test: `test/invoice-progress-rules.test.mjs`

**Interfaces:**
- Consumes: 9 张 `源_` 表、`（旧项目）开票计划补录表`、`供应商付款`
- Produces: `项目总览表`、`项目开票计划表`、`开票明细统一表`

- [x] 增加三张项目台账和 `供应商付款` 配置。
- [x] 读取 `（旧项目）开票计划补录表`，只写入 `项目开票计划表`。
- [x] 根据开票、回款、付款、结算自动计算 `项目阶段`。
- [x] 继续保护 `源_` 表和旧项目补录表。

### Task 2: 本地网页控制台

**Files:**
- Create: `src/control-server.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `npm run sync:invoice`、`npm run verify:invoice`、`npm run setup:invoice-model`
- Produces: 本地网页 `http://localhost:3000`

- [x] 增加 `npm run control`。
- [x] 页面提供“同步项目和开票数据”“试算不写入”“只核对”“检查表结构”。
- [x] 展示新增、更新、红冲、未匹配、金额异常、核对结果。

### Task 3: 中文交接文档

**Files:**
- Modify: `README.md`
- Modify: `docs/feishu-automation-setup.md`

**Interfaces:**
- Consumes: 当前业务口径
- Produces: 新电脑和交接说明

- [x] 更新 README。
- [x] 更新飞书自动化说明，标注复杂同步改由本地控制台完成。
- [ ] 运行测试和核对。
