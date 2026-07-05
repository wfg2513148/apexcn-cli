# Workflow Policy

workflow policy 的目标是把本地发布工作流的安全约束写成可审计规则。当前版本保留设计文档和后续实现目标。

## 建议策略

```json
{
  "version": 1,
  "defaults": {
    "requirePreview": true,
    "requireApproval": true,
    "approvalExpiresIn": "2h"
  },
  "commands": {
    "topic.create": { "allowed": true, "requireReview": true, "minContentLength": 80 },
    "topic.delete": { "allowed": true, "requireExactTitle": true, "requireTwoReviewers": true },
    "reply.delete": { "allowed": true, "requireTwoReviewers": false }
  },
  "mcp": {
    "allowExecuteWrite": false,
    "allowPreviewWrite": true
  }
}
```

## 后续命令

- `apexcn workflow policy init`
- `apexcn workflow verify --policy apexcn-policy.json`
- `apexcn workflow diff --run-dir ./run --json`
- `apexcn workflow audit-log --run-dir ./run --format ndjson`
