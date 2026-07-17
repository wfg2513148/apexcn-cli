# 0.40.x 迁移说明

0.40.x 是 roadmap 0.4“个人工作台与能力协商”的 release line。它保持现有搜索、RAG、内容 preview 和 workflow 命令不变，新增个人能力协商、隐私安全输出和 profile 隔离的本地草稿 inventory。

## 升级

使用公开 latest 安装入口升级：

```bash
curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh | bash
apexcn --version
apexcn doctor --json
```

升级后版本应为 `0.40.x`。现有 `~/.apexcn/config.json` 和 auth profiles 无需迁移。

## 默认隐私输出变化

`apexcn me` 及个人列表、统计现在默认递归脱敏 email、手机号、IP、地址和 secret-like 字段。确实需要查看服务端返回的私有账号字段时，必须显式运行：

```bash
apexcn me --include-private --json
```

即使使用 `--include-private`，token、API key、cookie 和 password 等 secret-like 字段仍会被替换为 `[redacted]`。

## 个人列表 cursor

`me topics/replies/favorites/subscriptions` 优先使用服务端返回的 opaque `page.nextCursor`：

```bash
apexcn me topics --page-size 10 --json
apexcn me topics --page-size 10 --cursor "<page.nextCursor>" --json
```

旧的 `--offset` 仍保留用于兼容旧服务端，但不能与 `--cursor` 同时使用。

## 服务端能力协商

先读取真实能力矩阵，再调用个人扩展能力：

```bash
apexcn me capabilities --json
apexcn me notifications --json
apexcn me inbox --json
apexcn me rules --json
apexcn me privacy --json
```

服务端没有权威数据时，CLI 会保留 `available: false`、`status: "UNAVAILABLE"`、`unavailableReason` 和 `requestId`，不会生成伪造的空列表或正文。

## 本地草稿 inventory

普通 `draft question/reply` 仍可在没有 active profile 时纯本地生成。只有显式 `--save` 才写入当前 profile 的 inventory：

```bash
apexcn draft question --title "标题" --problem "现象" --save --json
apexcn draft list --json
apexcn draft restore <draft-id> --format text
```

草稿按 profile 名的 SHA-256 标识隔离，文件权限为 `0600`。profile 或机器迁移使用 export/import：

```bash
apexcn draft export --output ./drafts.json --json
apexcn auth use target-profile
apexcn draft import --input ./drafts.json --json
```

导入遇到同 id 默认拒绝；仅显式 `--replace` 才覆盖。删除草稿必须显式 `--yes`。

## 安全边界

- MCP execute-write 继续不可用。
- 通知、规则、隐私等缺失能力不会由 CLI 伪造。
- 草稿 inventory 不包含 token 或原始 profile 名。
- 收藏和订阅的 preview 仍不发送真实写请求；执行需要用户明确批准。
