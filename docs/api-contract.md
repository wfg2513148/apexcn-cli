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

## Runtime Schema

初版 schema 位于 `src/schemas/`，覆盖：

- command manifest
- search response
- topic response
- ask response
- stable error envelope

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

contract tests 位于 `test/contract/`。当前覆盖 command manifest、search ok/empty、topic ok、ask ok、error 401/429 等稳定形状。
