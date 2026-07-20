# Workflow Policy

workflow policy 把本地发布工作流的安全约束写成可审计规则。当前支持 JSON policy；YAML 是后续增强。

## 当前命令

```bash
apexcn workflow policy init --output apexcn-policy.json
apexcn workflow policy init --json
apexcn workflow verify --run-dir ./run --policy apexcn-policy.json --json
apexcn workflow diff --run-dir ./run --json
apexcn workflow audit-log --run-dir ./run --format ndjson
apexcn workflow audit-log --run-dir ./run --format ndjson > audit.ndjson
apexcn workflow audit-log --run-dir ./run --verify-file audit.ndjson --json
```

## Policy Schema

```json
{
  "schemaVersion": 1,
  "defaults": {
    "requirePreview": true,
    "requireApproval": true,
    "approvalExpiresInMinutes": 120,
    "auditRetentionDays": 90
  },
  "commands": {
    "topic.create": {
      "allowed": true,
      "minimumApprovers": 1,
      "requireReview": true,
      "minContentLength": 80
    },
    "topic.delete": {
      "allowed": true,
      "minimumApprovers": 2,
      "requireExactTitle": true
    },
    "reply.delete": {
      "allowed": true,
      "minimumApprovers": 2,
      "requireExactTitle": false
    }
  },
  "mcp": {
    "allowExecute": false
  }
}
```

`mcp.allowExecute` 必须保持 `false`。MCP 不支持真实 execute-write。

`approval.json` 记录 `target`、完整 `request`、`expiresAt` 和审批人。执行时使用 artifact 中的期限；policy 的 `approvalExpiresInMinutes` 是本地 policy verify 的最大审批年龄。需要双人审批时，使用 `workflow approve --approved-by <first> --second-approver <second>`；两人必须不同。未在 `commands` 中配置的命令默认拒绝。

## Verify

`workflow verify --policy` 会检查：

- runId 是否一致。
- preview 的 target 和完整 request hash 是否与 approval 匹配。
- approval 是否过期。
- command 是否被 policy 允许。
- destructive 请求中的确认字段、对象版本和批准 hash 是否一致。
- artifact 是否包含未脱敏 secret。
- `minimumApprovers` 指定的独立审批人数是否满足。
- run 是否仍在 `auditRetentionDays` 窗口内。

## Diff

`workflow diff --run-dir` 输出 draft/request 差异、approval-bound hash、current hash 和 `executionAllowed`。hash 不一致时执行应被阻断。

## Audit Log

`workflow audit-log` 按 plan、preview、approve、可选 execute、verify 的顺序输出事件。每个事件包含 `previousHash` 和 `eventHash`，形成 SHA-256 链。`--verify-file <file>` 接受 JSON 数组或 NDJSON，并与当前 workflow 重建结果逐项比较；事件缺失、乱序、内容修改、hash 修改或附加事件都会失败。审计日志不得包含 API key、Authorization、Cookie 或 password。
