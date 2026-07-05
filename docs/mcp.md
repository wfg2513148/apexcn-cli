# MCP Adapter

MCP 是 `apexcn-cli` 的薄适配层，不是主产品。CLI 继续作为人工、脚本和 workflow 的主入口；MCP 只为 AI Agent 提供结构化工具。

## 原则

- 第一版仅支持本地 stdio。
- 第一版默认 readonly。
- 写操作第一阶段 blocked，第二阶段 preview-only。
- 真实 execute-write 不进入第一版。
- MCP tools 必须复用 core service 和安全策略。
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
| `apexcn_search` | 搜索帖子 | low |
| `apexcn_topic_view` | 查看帖子 | low |
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
| `apexcn_reply_delete_preview` | 只生成 preview request |
| `apexcn_favorite_add_preview` | 只生成 preview request |
| `apexcn_favorite_remove_preview` | 只生成 preview request |
| `apexcn_subscription_add_preview` | 只生成 preview request |
| `apexcn_subscription_remove_preview` | 只生成 preview request |

preview 返回必须包含 `willExecute: false`。真实发布、删除、收藏、订阅仍走 CLI workflow。

## Client Compatibility

配置示例、手工 JSON-RPC smoke test 和常见排查见 [mcp-client-compatibility.md](mcp-client-compatibility.md)。当前仅支持本地 stdio，不提供远端 HTTP MCP Server。
