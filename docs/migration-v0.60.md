# 0.60.x 迁移说明

0.60.x 是 roadmap 0.6“可审计内容操作”的 release line。它不代表 0.5 已通过验收；0.5 的 MCP 客户端兼容缺口仍按原状态保留。

## 最重要的行为变化

`topic create/update/delete` 和 `reply create/update/delete` 的直接命令从 0.60.0 起只允许 `--preview` 或 `--dry-run`。不带预览参数时，CLI 会拒绝请求，并提示使用 workflow。这样可避免绕过正文审核、hash-bound approval、目标绑定、审批期限和幂等恢复。

真实写入使用三步流程：

```bash
apexcn workflow run \
  --goal topic-create \
  --category-id 8 \
  --title "标题" \
  --content-file ./topic.md \
  --output-dir ./run \
  --json

apexcn workflow approve \
  --run-dir ./run \
  --approved-by reviewer \
  --expires-in-minutes 120 \
  --json

apexcn workflow run \
  --resume ./run \
  --execute \
  --yes \
  --json
```

## 支持的写入目标

`workflow run --goal` 支持：

- `topic-create`：需要 `--category-id`、`--title`、`--content-file`
- `topic-update`：需要 `--topic-id`、`--if-version`，以及正文、标题或分类变更
- `topic-delete`：需要 `--topic-id`、`--if-version`、`--confirm-title`
- `reply-create`：需要 `--topic-id`、`--content-file`
- `reply-update`：需要 `--reply-id`、`--if-version`、`--content-file`
- `reply-delete`：需要 `--reply-id`、`--if-version`，且 `--confirm-id` 必须与回复 ID 完全一致

原有 `ask-question` 和 `reply` 工作流继续可用，分别用于研究后提问和基于帖子上下文起草回复。

## 审批与恢复

- `preview.json` 绑定 profile、base URL、HTTP 方法、路径、业务正文、`operationKey`、`payloadHash` 和版本。
- `approval.json` 保存相同请求和目标、preview hash、审批人及 `expiresAt`。
- 执行前会重新检查目标、请求、hash 和期限；正文变化、过期审批或目标变化都会被拒绝。
- 401 修复凭据后使用同一 run 重试；429 等待服务端窗口后使用同一 run 重试。
- timeout 或 5xx 的执行结果视为不确定，只能用同一 run 重试，以复用原 `operationKey`。
- 409 表示版本或幂等冲突，必须重新读取对象并创建、审核、批准新的 workflow。
- 已完成 run 或已有 `execute.json` 的 run 会拒绝重复执行。

## 正文与密钥审核

topic/reply create 和 update 在生成 API preview 前读取正文副本并执行本地审核。空正文、`待补充` 占位符和疑似 token、Authorization header、密码会阻断流程；疑似密钥不会保留在 workflow 状态或被拒绝的正文副本中。

## MCP 边界

MCP 保持本地 stdio、默认 readonly。启用 preview-write 后，工具仍只返回 `willExecute: false`，不会发送写请求。topic/reply update preview 使用真实 ORDS 合约的 `POST` 方法。不存在 MCP execute-write，也不能通过 MCP 批准或执行 workflow。

## 隔离写测试

0.60.x 的真实写验证仅允许在明确批准的隔离 dev 测试面，复用已有最小权限测试账号。不得把验证命令指向生产社区，验证结束后必须确认主题、回复和幂等记录残留为零。
