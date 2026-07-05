# API and CLI Contract

## CLI Manifest

`apexcn commands --json` 保持旧结构：

- `schemaVersion: 1`
- `version`
- `schema`
- `commands[].path/aliases/description/options/safety/examples`

本次追加：

- `manifestVersion: 2`
- `product`
- `generatedAt`
- `commands[].id`
- `commands[].capability`
- `commands[].apiEffect`
- `commands[].riskLevel`
- `commands[].authRequired`
- `commands[].supportsJson`
- `commands[].supportsPreview`
- `commands[].supportsDryRun`
- `commands[].mcpExposure`

这些字段是 additive change，不删除旧字段。

`apexcn commands --json-schema` 输出 command manifest 的 draft-07 JSON Schema。该命令用于 AI agent、CI 和文档一致性检查，不改变 `commands --json` 输出。

`apexcn mcp tools --json-schema` 输出 MCP tool manifest schema。

## Runtime Schema

初版 schema 位于 `src/schemas/`，覆盖：

- command manifest
- search response
- topic response
- ask response
- stable error envelope
- research bundle
- doctor snapshot
- MCP tool manifest
- workflow plan / preview
- collection manifest / query result

策略：宽进严出。服务端额外字段允许存在，关键字段必须可验证。

## Error Envelope

核心错误对象：

```json
{
  "ok": false,
  "error": {
    "code": "HTTP_401",
    "message": "Unauthorized",
    "status": 401,
    "requestId": "req-1",
    "retryable": false
  }
}
```

错误对象不得包含 API key、Authorization、Cookie 或 password。

## Contract Tests

contract tests 位于 `test/contract/`。当前覆盖 command manifest、schema export、search ok/empty、topic ok、ask ok、error envelope 和 API contract 等稳定形状。
