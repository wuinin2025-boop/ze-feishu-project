# 开票计划与统一明细验证结果

生成时间：2026-11-10T03:24:43.244Z

## 总览

- 验证结果：通过
- 项目开票计划表记录数：275
- 开票明细统一表记录数：282
- 旧项目补录记录数（只读检查）：266
- 源发票记录数：282
- 统一明细纳入统计开票金额：64032426.48
- 源发票抵消后纳入统计开票金额：64032426.48
- 统一明细纳入统计收款金额：49233929.36
- 源发票抵消后纳入统计收款金额：49233929.36

## 关键检查

- 通过：项目开票计划表存在。tbl6Pfmg7kb5d0hr
- 通过：开票明细统一表存在。tblDAXoj6GVAfSTe
- 通过：计划唯一键不为空。blank=0
- 通过：明细唯一键不为空。blank=0
- 通过：计划唯一键不重复。[]
- 通过：明细唯一键不重复。[]
- 通过：源发票编号不重复。[]
- 通过：统一明细开票金额等于源发票抵消后金额。detail=64032426.47999998, source=64032426.47999999
- 通过：统一明细收款金额等于源发票抵消后金额。detail=49233929.35999999, source=49233929.36
- 通过：统一明细不存在源表已删除记录。[]
- 通过：行政/内部项目不进入老板驾驶舱经营或走账分组。rows=0
- 通过：Hankook 空发票号使用默认显示值。bad=0, hankook=13

## 样例

### 金额异常待确认

```json
[
  {
    "计划唯一键": "E260311YIYI-1",
    "明细唯一键": "",
    "项目编号": "E260311YIYI",
    "项目名称": "2026年度极石汽车官方账号运营",
    "客户名称": "",
    "发票编号显示值": "",
    "计划开票金额": 131779.2,
    "实际开票金额": 287154,
    "匹配状态": "金额异常待确认"
  },
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
  },
  {
    "计划唯一键": "W260623LS-1",
    "明细唯一键": "",
    "项目编号": "W260623LS",
    "项目名称": "极石海外用车指南视频拍摄制作5-6月",
    "客户名称": "",
    "发票编号显示值": "",
    "计划开票金额": 92300,
    "实际开票金额": 97838,
    "匹配状态": "金额异常待确认"
  },
  {
    "计划唯一键": "E260313YJ-4",
    "明细唯一键": "",
    "项目编号": "E260313YJ",
    "项目名称": "凯迪拉克F1票务运营",
    "客户名称": "",
    "发票编号显示值": "",
    "计划开票金额": 35500,
    "实际开票金额": 58853.82,
    "匹配状态": "金额异常待确认"
  },
  {
    "计划唯一键": "W20251022LS-3",
    "明细唯一键": "",
    "项目编号": "W20251022LS",
    "项目名称": "问界2025线上社群运营项目",
    "客户名称": "",
    "发票编号显示值": "",
    "计划开票金额": 477523.72,
    "实际开票金额": 480897.07,
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
