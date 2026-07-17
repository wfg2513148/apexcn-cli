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

`research` 的 additive contract 包含 `searchAttempts[]`。原始自然语言短语无结果时，每次有限查询扩展都记录 `keyword`、`resultCount` 和 `requestId`；最终采用的关键词写入 `query.selectedKeyword`，完整候选顺序写入 `query.attemptedKeywords`。这些 requestId 同时汇总到顶层 `provenance.requestIds`。

每个 `supportsJson: true` 的公开命令都必须在 manifest 中提供非空 `jsonContract`，并指向已存在的契约测试文件。不支持 JSON 的命令必须返回 `jsonContract: null`，避免能力声明与真实选项不一致。

个人工作台输出默认应用两层过滤：secret-like 字段递归替换为 `[redacted]`；email、手机号、IP、地址等私有字段默认掩码或替换。只有 `me --include-private` 可显式显示服务端返回的私有账号字段，secret-like 字段仍不会透传。

`me capabilities` 对应 `/api/v1/capabilities`。通知、收件箱、规则和隐私端点若无权威数据，成功响应仍必须明确包含 `available: false`、`status: "UNAVAILABLE"`、`unavailableReason` 和 `requestId`。CLI 不把 truthful unavailable 改写为伪造的空数组或正文。

本地草稿 inventory 使用 `stored-draft` v1 包装原有 `question-draft` 或 `reply-draft`。`draft-inventory-export` v1 包含 `sourceProfileId`、`exportedAt` 和 `drafts[]`；profile 标识是 profile 名的 SHA-256，不包含 profile 名或 token。导入保留 draft id、时间戳和 payload 字段，只将 `ownerProfileId` 绑定到当前 active profile。

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
