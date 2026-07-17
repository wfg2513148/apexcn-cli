# 0.50.x 迁移说明

0.50.x 是 roadmap 0.5“AI Agent 只读适配层”的 release line。CLI 命令与现有配置保持兼容；新增稳定的本地 stdio MCP readonly 接入、共用 core 服务和真实客户端兼容记录。

## 升级

```bash
curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh | bash
apexcn --version
apexcn doctor --json
apexcn mcp tools --json
```

升级后版本应为 `0.50.x`。现有 `~/.apexcn/config.json`、auth profiles、草稿和 collection 数据无需迁移。

## Readonly 工具

`apexcn mcp serve --readonly` 暴露 10 个只读工具：

- 管理员、分类、主题列表、最近主题与主题详情；
- 搜索、RAG 问答与 research bundle；
- 脱敏的 doctor snapshot；
- 只生成计划、不执行写入的 workflow plan。

readonly exposure 直接来自 CLI command registry。CLI 和 MCP 复用 HTTP client、core service、policy、redaction、doctor snapshot 与 workflow plan builder。

## stdio 协议

- 支持 MCP 协议版本 `2024-11-05`、`2025-03-26`、`2025-06-18`。
- stdio 每行一个 JSON-RPC 2.0 消息。
- 工具 schema 默认拒绝未知字段，并校验 required、类型和枚举。
- 通知不产生响应；未知方法返回标准 JSON-RPC 错误。
- 最终工具响应、错误和 stderr 都经过 secret redaction。

## 客户端配置

客户端必须使用绝对可执行路径，避免 GUI 进程缺少 shell `PATH`：

```json
{
  "command": "/opt/homebrew/bin/node",
  "args": ["/absolute/path/to/apexcn-cli/dist/index.js", "mcp", "serve", "--readonly"]
}
```

真实验证过的客户端版本、操作系统、日期和证据见 [mcp-client-compatibility.md](mcp-client-compatibility.md)。没有完成真实 UI 的客户端不会标记为 verified。

## 安全边界

- `apexcn mcp serve` 默认等同 `--readonly`。
- `--allow-execute-write` 始终拒绝，MCP 不提供真实 execute-write。
- preview-only 工具只有显式 `--allow-preview-write` 才暴露，并始终返回 `willExecute: false`。
- MCP 不绕过 CLI policy，也不会 shell out 调用 `apexcn`。
- 真实发帖、回帖、删除、收藏和订阅继续使用 CLI workflow 与明确审批。
