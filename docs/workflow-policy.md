# Workflow Policy

workflow policy 把本地发布工作流的安全约束写成可审计规则。当前支持 JSON policy；YAML 是后续增强。

## 当前命令

```bash
apexcn workflow policy init --output apexcn-policy.json
apexcn workflow verify --run-dir ./run --policy apexcn-policy.json --json
apexcn workflow diff --run-dir ./run --json
apexcn workflow audit-log --run-dir ./run --format ndjson
```

## Policy Schema

```json
{
  "schemaVersion": 1,
  "defaults": {
    "requirePreview": true,
    "requireApproval": true,
    "approvalExpiresInMinutes": 120
  },
  "commands": {
    "topic.create": {
      "allowed": true,
      "requireReview": true,
      "minContentLength": 80
    },
    "topic.delete": {
      "allowed": true,
      "requireExactTitle": true,
      "requireTwoReviewers": true
    },
    "reply.delete": {
      "allowed": true,
      "requireExactTitle": false
    }
  },
  "mcp": {
    "allowExecute": false
  }
}
```

`mcp.allowExecute` 必须保持 `false`。MCP 不支持真实 execute-write。

## Verify

`workflow verify --policy` 会检查：

- runId 是否一致。
- preview request hash 是否与 approval 匹配。
- approval 是否过期。
- command 是否被 policy 允许。
- destructive 命令是否具备确认字段。
- artifact 是否包含未脱敏 secret。
- 双人审批要求是否满足。

## Diff

`workflow diff --run-dir` 输出 draft/request 差异、approval-bound hash、current hash 和 `executionAllowed`。hash 不一致时执行应被阻断。

## Audit Log

`workflow audit-log --format ndjson` 每行输出一个可解析 JSON 事件，包含 `schemaVersion`、`time`、`runId`、`event`、`command`、`requestHash`、`actor`、`result` 和 `reason`。审计日志不得包含 API key、Authorization、Cookie 或 password。
