# 开票计划与统一明细验证结果

生成时间：2026-07-31T09:19:39.635Z

## 总览

- 验证结果：通过
- 项目开票计划表记录数：3
- 开票明细统一表记录数：171
- 旧项目补录记录数（只读检查）：290
- 源发票记录数：171
- 统一明细纳入统计开票金额：46220407.89
- 源发票抵消后纳入统计开票金额：46220407.89
- 统一明细纳入统计收款金额：21884283.31
- 源发票抵消后纳入统计收款金额：21884283.31

## 关键检查

- 通过：项目开票计划表存在。tbl6Pfmg7kb5d0hr
- 通过：开票明细统一表存在。tblDAXoj6GVAfSTe
- 通过：计划唯一键不为空。blank=0
- 通过：明细唯一键不为空。blank=0
- 通过：计划唯一键不重复。[]
- 通过：明细唯一键不重复。[]
- 通过：统一明细开票金额等于源发票抵消后金额。detail=46220407.889999986, source=46220407.88999999
- 通过：统一明细收款金额等于源发票抵消后金额。detail=21884283.31, source=21884283.310000002
- 通过：行政/内部项目不进入老板驾驶舱经营或走账分组。rows=0
- 通过：Hankook 空发票号使用默认显示值。bad=0, hankook=7

## 样例

### 金额异常待确认

```json
[]
```

### Hankook

```json
[
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E250102YIYI|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN1V1Z6QTlqMm1XODo0YjE4MThiZTY1NDlhZmY1NDRiMjNjM2UwMTdhYjRiODox",
    "项目编号": "E250102YIYI",
    "项目名称": "",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "计划外开票"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E250101ININ|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2ZDN5SmJpMzhzeTo2MjRlMTJiYTBiYzM4OTk4ZTU5ZTc4ZjViYTNmZDUzMjox",
    "项目编号": "E250101ININ",
    "项目名称": "",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "计划外开票"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260102ININ|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2ZFpOakgyZ2xOaTo5ZTRjNDYzMDhjODExNWMxMjU4NTU4Yzg2MDUzMDZlYzox",
    "项目编号": "E260102ININ",
    "项目名称": "",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "计划外开票"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260102ININ|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2bTFhc21GcUkxaTozNzNhNTY2YjJkMjU5NDdlODdkMTY2MjVjNTRjOGJkODox",
    "项目编号": "E260102ININ",
    "项目名称": "",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "计划外开票"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260101ININ|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2bWRITGs0cXhzejpmYjFiYTNkOGVkZWZmNjM3YjI0ZDJmZjkwOWNjM2MxYjox",
    "项目编号": "E260101ININ",
    "项目名称": "",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "计划外开票"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260102ININ|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2cWEwaFFtQnJXZjpkYjQyNjgxZGFlZWUyOTQwN2RhYTAxMGE5MmY3MzNlNTox",
    "项目编号": "E260102ININ",
    "项目名称": "",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "计划外开票"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260101ININ|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2cWEwaXZHWmloMDpkM2MzMmY1Mjc5M2YxNmEwOTNkMTUwYmI2NTgwMzIxYjox",
    "项目编号": "E260101ININ",
    "项目名称": "",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "计划外开票"
  }
]
```

## 失败项

```json
[]
```
