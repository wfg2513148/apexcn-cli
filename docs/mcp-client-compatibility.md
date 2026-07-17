# MCP Client Compatibility

当前 MCP 适配层是本地 stdio server。CLI 仍是主产品；MCP 只为 AI Agent 暴露结构化工具。

## 验证矩阵

| 客户端 | 版本 | 平台 | 日期 | 状态 | 真实结果 |
|---|---:|---|---|---|---|
| VS Code Agent | 1.129.0 | macOS 26.5.2 arm64 | 2026-07-18 | verified | UI 发现 10 个工具；真实调用 `apexcn_workflow_plan` 返回 `research-only` / `api-read` |

0.50.x 只分发和支持 VS Code Agent 接入。Cursor 与 Claude Desktop 不属于本版本分发矩阵，不能据此文档声称兼容。

VS Code 原始截图与哈希记录在
[`reports/mcp/client-evidence/m050-client-evidence.json`](../reports/mcp/client-evidence/m050-client-evidence.json)。
SDK smoke、100-call soak 和启动性能属于本地协议资格化，不能替代真实 UI。

## VS Code Agent

Status: verified distribution target with version and date in the matrix.

```json
{
  "servers": {
    "apexcn-readonly": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/apexcn-cli/dist/index.js", "mcp", "serve", "--readonly"]
    }
  }
}
```

验证时，`MCP: List Servers` 显示 server 为 `Running`，Agent 的 Configure
Tools UI 展示全部 10 个 readonly tools。实际调用仍保留客户端自己的确认门禁。

## 安全边界

- `apexcn mcp serve` 默认等同 `--readonly`。
- `--allow-preview-write` 只暴露 preview-only 工具，返回 `willExecute: false`。
- `--allow-execute-write` 不支持；真实写操作继续走 CLI workflow。
- doctor snapshot 和错误输出必须脱敏。

## 手工 Smoke Test

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | apexcn mcp serve --readonly
```

如果客户端找不到工具，先执行：

```bash
apexcn mcp tools --json
apexcn mcp inspect --json
```

确认 `command` 路径在客户端进程的 `PATH` 中。GUI 客户端优先配置绝对路径。
