# MCP Client Compatibility

当前 MCP 适配层是本地 stdio server。CLI 仍是主产品；MCP 只为 AI Agent 暴露结构化工具。

当前验证状态：

- verified: `node dist/index.js mcp serve --readonly` 本地 stdio JSON-RPC smoke test。
- not verified: Claude Desktop、Cursor、VS Code Agent 的真实客户端 UI 连接。
- not supported: 远端 HTTP MCP Server、MCP execute-write。

## Claude Desktop

Status: not verified template.

Readonly:

```json
{
  "mcpServers": {
    "apexcn": {
      "command": "apexcn",
      "args": ["mcp", "serve", "--readonly"]
    }
  }
}
```

Preview-only 写工具:

```json
{
  "mcpServers": {
    "apexcn": {
      "command": "apexcn",
      "args": ["mcp", "serve", "--allow-preview-write"]
    }
  }
}
```

## Cursor / VS Code Agent

使用同样的 stdio 配置：

Status: not verified template.

```json
{
  "servers": {
    "apexcn": {
      "command": "apexcn",
      "args": ["mcp", "serve", "--readonly"]
    }
  }
}
```

## 安全边界

- `apexcn mcp serve` 默认等同 `--readonly`。
- `--allow-preview-write` 只暴露 preview-only 工具，返回 `willExecute: false`。
- `--allow-execute-write` 不支持；真实写操作继续走 CLI workflow。
- doctor snapshot 和错误输出必须脱敏。

## 手工 Smoke Test

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | apexcn mcp serve --readonly
```

如果客户端找不到工具，先执行：

```bash
apexcn mcp tools --json
apexcn mcp inspect --json
```

确认 `command` 路径在客户端进程的 `PATH` 中。
