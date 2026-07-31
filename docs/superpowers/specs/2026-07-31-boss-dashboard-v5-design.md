# Boss Dashboard V5 Design

## Goal

Build a boss-facing Feishu dashboard that does not require local scripts for dashboard refresh. The dashboard should help the boss answer four questions quickly:

- What is the current business and cash position?
- What will be invoiced and collected soon?
- Which projects are overdue, and who is responsible?
- Is the dashboard data complete enough to trust?

## Sources Checked

- Feishu dashboard supports adding chart components such as line charts and other charts: https://www.feishu.cn/hc/zh-CN/articles/360049067678
- Feishu dashboard supports filtering data and slicer components: https://www.feishu.cn/hc/zh-CN/articles/493084579750-%E5%9C%A8%E4%BB%AA%E8%A1%A8%E7%9B%98%E4%B8%AD%E7%AD%9B%E9%80%89%E6%95%B0%E6%8D%AE and https://www.feishu.cn/hc/zh-CN/articles/660924361907-%E4%BD%BF%E7%94%A8%E5%88%87%E7%89%87%E5%99%A8%E7%BB%84%E4%BB%B6%E7%AD%9B%E9%80%89%E4%BB%AA%E8%A1%A8%E7%9B%98%E6%95%B0%E6%8D%AE
- Feishu dashboard components can use multiple source tables: https://www.feishu.cn/hc/zh-CN/articles/858919003989-%E4%BB%AA%E8%A1%A8%E7%9B%98%E7%BB%84%E4%BB%B6%E6%B7%BB%E5%8A%A0%E5%A4%9A%E4%B8%AA%E6%95%B0%E6%8D%AE%E6%BA%90%E8%A1%A8
- Feishu automation runs actions after configured triggers and conditions: https://www.feishu.cn/hc/zh-CN/articles/665088655709-%E4%BD%BF%E7%94%A8%E5%A4%9A%E7%BB%B4%E8%A1%A8%E6%A0%BC%E8%87%AA%E5%8A%A8%E5%8C%96%E6%B5%81%E7%A8%8B

## Global Rules

- `项目分类管理` remains manually maintained only in `项目总览表`.
- Dashboard includes `经营项目` and `走账项目`.
- Dashboard excludes `行政/内部项目`.
- Global company filter must affect all cards, charts, and lists.
- Use Feishu formulas, lookup fields, views, dashboard filters, and automation before local scripts.
- Do not write to `源_` tables.
- Do not touch `（旧项目）开票计划补录表` while manual backfill is active.

## Dashboard Structure

### Global Filters

The dashboard should keep the existing company filter and add compatible filters where useful:

- `选择公司`: 全部 / 集熠 / 冶堂 / 亦所
- `项目分类`: 总项目 / 经营项目 / 走账项目
- `时间范围`: 本月 / 下月 / 自定义

All dashboard source tables must carry a company field, either native or lookup/formula:

- `项目总览表.立项公司`
- `项目开票计划表.立项公司`
- `开票明细统一表.立项公司`
- `项目线索表.立项公司` or equivalent company field

### First Screen

Purpose: let the boss understand the current position and near-future cash movement within 30 seconds.

Cards:

- `总项目数`: count of `经营项目 + 走账项目`
- `线索项目数`: effective leads count, plus overdue follow-up leads if available
- `已开票金额`: sum of included invoice amount
- `已收款金额`: sum of included received amount
- `未收款金额`: `已开票金额 - 已收款金额`
- `风险项目数`: projects with overdue invoice, overdue payment, amount exception, or missing classification

Forecast cards:

- `未来7天预计开票`: plan rows where planned invoice date is within the next 7 days and un-invoiced amount remains
- `未来7天预计回款`: plan rows where expected payment date is within the next 7 days and unpaid amount remains
- `下月预计开票`: plan rows where planned invoice date is next month and un-invoiced amount remains
- `下月预计回款`: plan rows where expected payment date is next month and unpaid amount remains

Charts:

- Monthly line chart: `计划开票金额`, `实际开票金额`, `实际回款金额`, `未收款余额`
- Project structure chart: `经营项目`, `走账项目`, `线索项目`, `逾期项目`

### Second Screen

Purpose: make risks actionable by showing project, person, amount, date, and next action.

Lists:

- `逾期开票项目清单`
  - Project name
  - Company
  - Owner
  - Planned invoice date
  - Invoice overdue days
  - Un-invoiced amount

- `逾期回款项目清单`
  - Project name
  - Company
  - Owner
  - Expected payment date
  - Payment overdue days
  - Unpaid amount

- `Top 未收款项目`
  - Project name
  - Company
  - Owner
  - Invoiced amount
  - Received amount
  - Unpaid amount
  - Expected payment date

- `线索项目清单`
  - Lead name
  - Company
  - Owner
  - Expected amount
  - Lead status
  - Follow-up due date
  - Follow-up overdue days

- `数据可信度检查`
  - Missing classification projects
  - Unmatched invoices
  - Amount exception plans
  - Projects without invoice plan
  - Old-project backfill incomplete count

## Data Model

### Existing Tables To Use

- `项目总览表`: project classification, company, owner, project-level fields
- `项目线索表`: lead count, effective leads, overdue lead follow-up
- `项目开票计划表`: planned invoice and expected payment schedule
- `开票明细统一表`: actual invoice and received data
- `（旧项目）开票计划补录表`: read-only during manual backfill

### Fields Needed In `项目开票计划表`

Required or already present:

- `关联项目`
- `项目编号`
- `项目名称`
- `项目分类管理`
- `老板驾驶舱分组`
- `计划开票金额`
- `计划开票日期`
- `预计回款日期`
- `实际开票金额`
- `实际收款金额`
- `未开票金额`
- `未收款金额`
- `开票逾期天数`
- `回款逾期天数`
- `匹配状态`

Add or verify:

- `立项公司`: lookup from `关联项目`
- `当前项目负责人`: lookup from `关联项目`
- `未来7天预计开票金额`: formula
- `未来7天预计回款金额`: formula
- `下月预计开票金额`: formula
- `下月预计回款金额`: formula
- `开票月份`: formula/date bucket
- `回款月份`: formula/date bucket

### Fields Needed In `开票明细统一表`

Required or already present:

- `关联项目`
- `项目编号`
- `项目名称`
- `项目分类管理`
- `老板驾驶舱分组`
- `开票金额`
- `收款金额`
- `欠款金额`
- `开票日期`
- `收款日期`
- `是否纳入统计`
- `匹配状态`
- `抵消状态`

Add or verify:

- `立项公司`: lookup from `关联项目`
- `当前项目负责人`: lookup from `关联项目`
- `开票月份`: formula/date bucket
- `回款月份`: formula/date bucket
- `有效开票金额`: formula, zero when not included
- `有效收款金额`: formula, zero when not included

### Optional Monthly Summary Table

Preferred first attempt: use dashboard chart grouping by month directly from `项目开票计划表` and `开票明细统一表`.

If Feishu chart configuration cannot produce the four-line monthly trend cleanly, add `老板驾驶舱_月度趋势表` maintained by Feishu automation:

- `月份`
- `立项公司`
- `项目分类`
- `计划开票金额`
- `实际开票金额`
- `实际回款金额`
- `未收款余额`

## Automation Strategy

### No Local Script For Dashboard Refresh

Dashboard cards, charts, and lists should bind directly to Feishu tables and views. When underlying table records or formulas change, the dashboard reflects the current table state through Feishu.

### Feishu Automation

Use Feishu automation only where records need to be copied or summarized:

- Source invoice tables -> `开票明细统一表`
- Approved establishment invoice plan rows -> `项目开票计划表`
- Optional monthly trend summary -> `老板驾驶舱_月度趋势表`

### Manual UI Work Still Required

Current available MCP tools can create Bitable tables, fields, records, and views. They do not expose a dashboard-component editing API. Therefore the dashboard layout and components should be rebuilt manually in Feishu UI using the spec:

- Add cards
- Add line chart
- Add table components
- Add slicer/company filter
- Bind each component to the specified source view/table

## Recommended Dashboard Components

### Cards

- Total project count
- Lead project count
- Invoiced amount
- Received amount
- Unpaid amount
- Risk project count
- Next 7 days expected invoice
- Next 7 days expected payment
- Next month expected invoice
- Next month expected payment

### Charts

- Monthly line chart: planned invoice vs actual invoice vs actual payment vs unpaid balance
- Project classification structure: operating vs pass-through vs overdue/risk

### Tables

- Overdue invoice projects
- Overdue payment projects
- Top unpaid projects
- Lead project list
- Data confidence exceptions

## Implementation Sequence

1. Verify all needed fields exist or can be created as formulas/lookups.
2. Build Feishu views for each dashboard component.
3. Rebuild the dashboard manually from those views.
4. Configure global company slicer/filter.
5. Configure Feishu automation for source-to-target updates.
6. Hide or retire script-generated `老板驾驶舱关键数据表` after the pure Feishu dashboard is verified.
7. Keep `verify:invoice` as an optional audit command only, not as a dashboard refresh step.

## Open Decisions

- Whether the monthly line chart can be built directly from source tables or needs `老板驾驶舱_月度趋势表`.
- Which lead field represents expected lead amount in `项目线索表`.
- Which lead field represents follow-up due date and overdue status.
- Whether `下周` should be a first-screen card or only a filter/detail view.

## Acceptance Criteria

- Changing `项目总览表.项目分类管理` automatically changes dashboard grouping without running local scripts.
- Company filter affects every dashboard card, chart, and list.
- Administrative/internal projects do not appear in dashboard totals.
- Dashboard shows operating projects, pass-through projects, total projects, lead projects, overdue invoice projects, and overdue payment projects.
- Dashboard includes monthly trend for planned invoice, actual invoice, actual payment, and unpaid balance.
- Overdue invoice and overdue payment lists show project, company, owner, date, overdue days, and amount.
- Dashboard can be used without running `npm run sync:invoice`.
