# MCP Adapter

MCP 是 `apexcn-cli` 的薄适配层，不是主产品。CLI 继续作为人工、脚本和 workflow 的主入口；MCP 只为 AI Agent 提供结构化工具。

## 0.50.x / 0.60.x 稳定边界

- 仅支持本地 stdio，不开放网络 MCP transport。
- server 默认 readonly；execute-write 始终不可用。
- readonly tools 与 CLI 复用 HTTP client、core service、policy、redaction 和 workflow/doctor builder。
- command registry 是 readonly exposure 的唯一来源，registry、tool manifest 和 handler 必须双向零漂移。
- 工具参数拒绝未知字段、错误类型和非法枚举；最终响应和错误再次递归脱敏。
- MCP tools 不得 shell out 调用 `apexcn` 自身。

## 命令

```bash
apexcn mcp tools --json
apexcn mcp tools --json-schema
apexcn mcp inspect --json
apexcn mcp serve --readonly
apexcn mcp serve --allow-preview-write
```

`apexcn mcp serve` 默认等同 readonly。`--allow-execute-write` 会直接失败。

stdio 使用每行一个 JSON-RPC 2.0 消息。server 支持 `2024-11-05`、`2025-03-26` 和
`2025-06-18` 协议版本，接受 `initialize`、`ping`、`tools/list`、`tools/call`，
并且不会为通知消息写回响应。

## 默认策略

```json
{
  "mode": "readonly",
  "transport": "stdio",
  "allowPreviewWrite": false,
  "allowExecuteWrite": false
}
```

## Readonly Tools

| MCP Tool | 对应能力 | 风险 |
|---|---|---|
| `apexcn_admin_list` | 查看公开管理员 | low |
| `apexcn_search` | 搜索帖子 | low |
| `apexcn_topic_view` | 查看帖子 | low |
| `apexcn_topic_list` | 按条件列出帖子 | low |
| `apexcn_topic_recent` | 最近帖子 | low |
| `apexcn_category_list` | 分类列表 | low |
| `apexcn_ask` | RAG 问答 | medium |
| `apexcn_research` | 研究包 | medium |
| `apexcn_doctor_snapshot` | 本地诊断快照 | medium，需要脱敏 |
| `apexcn_workflow_plan` | 生成 workflow plan，不执行写入 | medium |

## Preview-Only Tools

只有 `--allow-preview-write` 时才暴露：

| MCP Tool | 行为 |
|---|---|
| `apexcn_topic_create_preview` | 只生成 preview request |
| `apexcn_topic_update_preview` | 只生成 preview request |
| `apexcn_topic_delete_preview` | 只生成 preview request，要求 `confirmTitle` |
| `apexcn_reply_create_preview` | 只生成 preview request |
| `apexcn_reply_update_preview` | 只生成 preview request |
| `apexcn_reply_delete_preview` | 只生成 preview request，要求 `confirmId` 与 `replyId` 完全一致 |
| `apexcn_favorite_add_preview` | 只生成 preview request |
| `apexcn_favorite_remove_preview` | 只生成 preview request |
| `apexcn_subscription_add_preview` | 只生成 preview request |
| `apexcn_subscription_remove_preview` | 只生成 preview request |

preview 返回必须包含 `willExecute: false`，且工具调用期间写请求数必须为零。topic/reply update preview 使用 ORDS 已验证的 `POST` 合约。真实 topic/reply 创建、修改、删除只能走 CLI hash-bound workflow；MCP 没有 approve 或 execute-write 能力。

## Client Compatibility

配置示例、手工 JSON-RPC smoke test 和常见排查见 [mcp-client-compatibility.md](mcp-client-compatibility.md)。当前仅支持本地 stdio，不提供远端 HTTP MCP Server。

## 本地资格化

```bash
npm run build
npm run qualify:mcp
```

资格化使用官方 `@modelcontextprotocol/sdk` v1 client，记录 20 次冷启动、100 次连续
readonly 调用、工具清单、协议失败、P95 启动时间和 secret 扫描结果。报告写入
`reports/mcp/m050-local-qualification.json`；真实客户端 UI 结果单独记录，不能用 SDK
报告替代。
