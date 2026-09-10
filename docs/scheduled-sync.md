# 定时刷新说明

## 当前规则

线上服务器已经配置自动刷新：

- 每天 09:00 执行一次。
- 每天 17:00 执行一次。
- 时间按服务器时区 `Asia/Shanghai`，也就是北京时间。
- 如果飞书接口临时失败，间隔 5 分钟自动重试，最多连续重试 3 次。
- 平时仍然可以登录线上控制台手动刷新。

线上控制台：

```text
https://wuininyyy2026.xyz/ze_feishu02/
```

## 自动刷新会做什么

定时任务执行的是：

```bash
npm run sync:invoice
npm run verify:invoice
```

也就是先同步，再核对。

同步范围包括：

- `项目总览表`
- `项目开票计划表`
- `开票明细统一表`
- `项目供应商成本表`
- `项目进度表` 中缺失的经营项目默认任务

核对范围包括：

- 开票计划表是否存在。
- 开票明细统一表是否存在。
- 计划唯一键是否为空或重复。
- 明细唯一键是否为空或重复。
- 统一明细金额是否和源发票抵消后金额一致。
- 统一明细是否存在源表已删除记录。
- 行政/内部项目是否被排除在老板驾驶舱经营或走账分组之外。
- Hankook 空发票号是否使用默认显示值。

## 服务器配置

服务器上使用 systemd timer 管理定时任务。

定时器：

```text
ze-feishu-sync.timer
```

执行服务：

```text
ze-feishu-sync.service
```

服务实际执行命令：

```bash
/usr/bin/flock -n /tmp/ze-feishu-sync.lock /bin/bash -lc '/usr/bin/npm run sync:invoice && /usr/bin/npm run verify:invoice'
```

这里使用 `flock` 是为了防止重复执行。如果上一次同步还没结束，下一次不会并发写入飞书。

## 查看状态

查看下一次执行时间：

```bash
systemctl list-timers --all ze-feishu-sync.timer
```

查看最近执行结果：

```bash
systemctl status ze-feishu-sync.service --no-pager -l
```

查看详细日志：

```bash
journalctl -u ze-feishu-sync.service -n 200 --no-pager
```

手动执行一次服务器定时任务：

```bash
systemctl start ze-feishu-sync.service
```

## 手动刷新

如果需要立即刷新，不必等到 09:00 或 17:00。

方式一：打开线上控制台，点击：

```text
同步项目、开票和供应商数据
```

方式二：在服务器或本地命令行执行：

```bash
npm run sync:invoice
npm run verify:invoice
```

## 注意事项

- `源_` 表仍然由飞书自带同步或外部系统更新。
- 自动刷新只负责把源表变化同步到目标业务表。
- 自动刷新不会写入任何 `源_` 表。
- 自动刷新不会写入 `（旧项目）开票计划补录表`。
- 如果 `verify:invoice` 失败，说明同步后仍有业务数据不一致或异常，需要查看日志和飞书异常视图。
- 如果飞书 MCP 配置、应用权限或服务器网络临时异常，定时任务会按 5 分钟间隔自动重试；连续 3 次失败后停止，等待人工处理或下一次定时执行。
- `当前项目负责人`和`项目参与人员`只在目标为空时补齐；已有人工维护值不会被覆盖或追加。
- `项目分类管理`始终由人工维护，同步脚本不写入。
- `最近同步时间`只在业务内容真实变化时更新；无变化不会每天刷新日期。
