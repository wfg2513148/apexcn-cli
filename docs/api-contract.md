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
- `commands[].jsonContract.successSchemaId/errorSchemaId/testFile`

这些字段是 additive change，不删除旧字段。

`apexcn commands --json-schema` 输出 command manifest 的 draft-07 JSON Schema。该命令用于 AI agent、CI 和文档一致性检查，不改变 `commands --json` 输出。

`apexcn mcp tools --json-schema` 输出 MCP tool manifest schema。

## Runtime Schema

初版 schema 位于 `src/schemas/`，覆盖：

- `src/schemas/common.ts`: shared runtime assertions
- `src/schemas/error.ts`: stable error envelope
- `src/schemas/guide.ts`: curated novice guide
- `src/schemas/command-manifest.ts`: command manifest and JSON Schema export
- `src/schemas/search.ts`: search response
- `src/schemas/topic.ts`: topic response
- `src/schemas/ask.ts`: ask response
- `src/schemas/research.ts`: research bundle
- `src/schemas/doctor.ts`: doctor snapshot
- `src/schemas/workflow.ts`: workflow plan / preview
- `src/schemas/collection.ts`: collection manifest / query result
- `src/schemas/mcp.ts`: MCP tool manifest
- `src/schemas/index.ts`: schema exports

策略：宽进严出。服务端额外字段允许存在，关键字段必须可验证。

每个 `supportsJson: true` 的公开命令都必须在 manifest 中提供非空 `jsonContract`，并指向已存在的契约测试文件。不支持 JSON 的命令必须返回 `jsonContract: null`，避免能力声明与真实选项不一致。

## Error Envelope

核心错误对象：

```json
{
  "ok": false,
  "error": {
    "type": "http",
    "code": "AUTH_REQUIRED",
    "message": "Unauthorized",
    "status": 401,
    "requestId": "req-1",
    "remediation": {
      "code": "AUTH_TOKEN_REQUIRED",
      "message": "The server requires a valid API token.",
      "actions": ["Run `apexcn auth show --json` to confirm the active profile and baseUrl."]
    }
  }
}
```

CLI 对 401、403、404、409、429、5xx、network 和 timeout 使用稳定 `code`，并提供可执行的 `remediation.actions`。错误对象不得包含 API key、Authorization、Cookie 或 password。

## Contract Tests

contract tests 位于 `test/contract/`。当前覆盖 command manifest、schema export、search ok/empty、topic ok、ask ok、error envelope 和 API contract 等稳定形状。
