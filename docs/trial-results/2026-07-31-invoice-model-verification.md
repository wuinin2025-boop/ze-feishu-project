# 开票计划与统一明细验证结果

生成时间：2026-09-10T09:23:04.687Z

## 总览

- 验证结果：通过
- 项目开票计划表记录数：269
- 开票明细统一表记录数：214
- 旧项目补录记录数（只读检查）：266
- 源发票记录数：214
- 统一明细纳入统计开票金额：55997762.25
- 源发票抵消后纳入统计开票金额：55997762.25
- 统一明细纳入统计收款金额：34756329.75
- 源发票抵消后纳入统计收款金额：34756329.75

## 关键检查

- 通过：项目开票计划表存在。tbl6Pfmg7kb5d0hr
- 通过：开票明细统一表存在。tblDAXoj6GVAfSTe
- 通过：计划唯一键不为空。blank=0
- 通过：明细唯一键不为空。blank=0
- 通过：计划唯一键不重复。[]
- 通过：明细唯一键不重复。[]
- 通过：统一明细开票金额等于源发票抵消后金额。detail=55997762.249999985, source=55997762.24999999
- 通过：统一明细收款金额等于源发票抵消后金额。detail=34756329.75, source=34756329.75
- 通过：统一明细不存在源表已删除记录。[]
- 通过：行政/内部项目不进入老板驾驶舱经营或走账分组。rows=0
- 通过：Hankook 空发票号使用默认显示值。bad=0, hankook=9

## 样例

### 金额异常待确认

```json
[
  {
    "计划唯一键": "YS260522YJ-1",
    "明细唯一键": "",
    "项目编号": "YS260522YJ",
    "项目名称": "别克至境之夜",
    "客户名称": "",
    "发票编号显示值": "",
    "计划开票金额": 2146050,
    "实际开票金额": 2395600,
    "匹配状态": "金额异常待确认"
  }
]
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
    "明细唯一键": "集熠开票明细|E260102Inin|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2ZFpOakgyZ2xOaTpjMTY2NDg2ZmNhNDQyY2QzNDkxYzg0YjY5ZWNjNzQ1Mzox",
    "项目编号": "E260102Inin",
    "项目名称": "2026年韩泰PR服务项目",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "自动匹配"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260102Inin|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2cWEwaFFtQnJXZjowZTBlYzNiMzRhOGRiMWQwNWNkYWNmZWQ0ZjI1NzQ0Njox",
    "项目编号": "E260102Inin",
    "项目名称": "2026年韩泰PR服务项目",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "自动匹配"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260101Inin|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2cWEwaXZHWmloMDplMGFkOGQ0NDc0NTc4ZGUyMjdiNDI3YTUzNWNjODA4Yjox",
    "项目编号": "E260101Inin",
    "项目名称": "2026年韩泰SNS服务项目",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "自动匹配"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260102Inin|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2bTFhc21GcUkxaTplNDA4MjU0M2ViZWE1YWRmYTA0NDE0NTQwMWMwMmY3NTox",
    "项目编号": "E260102Inin",
    "项目名称": "2026年韩泰PR服务项目",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "自动匹配"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260101Inin|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2bWRITGs0cXhzejo4NjA1YmIwNmMxNTVmNTIzNzAzOTcxMTQ3YmQzYjMwNzox",
    "项目编号": "E260101Inin",
    "项目名称": "2026年韩泰SNS服务项目",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "自动匹配"
  },
  {
    "计划唯一键": "",
    "明细唯一键": "集熠开票明细|E260102Inin|Hankook 001|NzY2MzEyMjY0Njc4MzAzNjYwNDpyZWN2dGJEU3U3NHFoNzo2NDlkZmVmZTMwNzgxNDBlYzBjY2ViMjM2ZjEyMWM5NTox",
    "项目编号": "E260102Inin",
    "项目名称": "2026年韩泰PR服务项目",
    "客户名称": "Hankook & Company Co., Ltd",
    "发票编号显示值": "Hankook 001",
    "匹配状态": "自动匹配"
  }
]
```

## 失败项

```json
[]
```
