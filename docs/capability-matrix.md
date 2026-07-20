# Capability Matrix

| Command | Capability | API Effect | Auth Required | Supports JSON | Supports Preview | Supports Dry Run | MCP Exposure | Risk Level | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| `auth set-token` | auth | no-network | no | no | no | yes | blocked | high | 保存 file token，或只保存 env 变量名并配置 env→file fallback。 |
| `auth show` | auth | no-network | no | yes | no | no | none | medium | 只输出脱敏 token。 |
| `auth audit` | auth | no-network | no | yes | no | no | none | medium | 本地认证审计。 |
| `auth list/use/remove/logout` | auth | no-network | no | mixed | no | mixed | blocked | medium | 本地 profile 管理。 |
| `doctor` | diagnostic | api-read | yes | yes | no | no | none | medium | 会做只读 API 检查。 |
| `doctor snapshot` | diagnostic | no-network | no | yes | no | no | readonly | medium | MCP 返回脱敏本地快照。 |
| `admin list` | read | api-read | yes | yes | no | no | none | low | 管理员公开列表。 |
| `category list` | read | api-read | yes | yes | no | no | readonly | low | 分类列表。 |
| `search` | read | api-read | yes | yes | no | no | readonly | low | 搜索帖子。 |
| `ask` | read | api-read | yes | yes | no | no | readonly | medium | RAG 问答。 |
| `research` | read | api-read | yes | yes | no | no | readonly | medium | 研究包。 |
| `topic list/recent/view` | read | api-read | yes | yes | no | no | readonly | low | topic 只读能力。 |
| `topic create/update` | write | no write in direct command | yes | yes | yes | yes | preview-only | high | 直接命令只生成 preview；真实写入必须使用 hash-bound workflow。 |
| `topic delete` | write | no write in direct command | yes | yes | yes | yes | preview-only | destructive | 直接命令只预览；workflow 绑定标题、版本和审批。 |
| `reply create/update` | write | no write in direct command | yes | yes | yes | yes | preview-only | high | 直接命令只生成 preview；真实写入必须使用 hash-bound workflow。 |
| `reply delete` | write | no write in direct command | yes | yes | yes | yes | preview-only | destructive | 直接命令只预览；workflow 绑定回复 ID、版本和审批。 |
| `favorite add/remove` | write | api-write | yes | yes | yes | yes | preview-only | medium | MCP 只生成 preview。 |
| `subscription add/remove` | write | api-write | yes | yes | yes | yes | preview-only | medium | MCP 只生成 preview。 |
| `me profile/topics/replies/favorites/subscriptions/stats` | read | api-read | yes | yes | no | no | none | low | 个人数据只读；默认隐私脱敏，列表支持 opaque cursor。 |
| `me capabilities/notifications/inbox/rules/privacy` | read | api-read | yes | yes | no | no | none | low | 能力协商；缺失能力保留 truthful unavailable。 |
| `stats category/topic/tag` | read | api-read | yes | yes | no | no | none | low | 聚合统计。 |
| `draft question/reply` | local | no-network | no | yes | no | no | none | low | 纯生成无需 profile；`--save` 要求 active profile。 |
| `draft list/restore/export/import/delete` | local | no-network | no | yes | no | no | none | mixed | 要求 active profile 的隔离 inventory；delete 要求 `--yes`。 |
| `guide learning/compatibility/deployment/security/performance` | local | no-network | no | yes | no | no | none | low | 本地策展任务路径，不冒充官方兼容性认证。 |
| `review topic/reply` | local | no-network | no | yes | no | no | none | low | 本地发布前审核。 |
| `collection build/sync/favorites` | read | api-read | yes | yes | no | no | none | medium | GET-only 构建、增量刷新和收藏导入。 |
| `collection verify/export/verify-bundle/import/restore` | local | no-network | no | yes | no | no | none | low | canonical hash 校验与确定性 bundle 往返。 |
| `collection index/query/stats` | local | no-network | no | yes | no | no | none | low | BM25 本地检索、解释、增量索引和统计。 |
| `collection automation plan/run` | local | no-network | no | yes | no | no | none | low | 离线只读计划，零网络、零无人值守写请求、重复抑制。 |
| `workflow plan` | workflow | no-network | no | yes | no | no | readonly | medium | MCP 可生成 plan，不执行。 |
| `workflow run` | workflow | preview or approved api-write | yes | yes | required | no | blocked | high | 支持 topic/reply create/update/delete；仅 `--resume --execute --yes` 且审批有效时写入。 |
| `workflow approve/verify/export/verify-bundle` | workflow | no-network | no | yes | no | no | none | medium | 本地审计与验证。 |
| `workflow policy init/diff/audit-log` | workflow | no-network | no | yes | no | no | none | medium | policy 模板、hash diff、NDJSON audit log。 |
| `commands --json/--json-schema` | local | no-network | no | yes | no | no | none | low | CLI manifest 与 schema export。 |
| `mcp tools/inspect` | local | no-network | no | yes | no | no | none | low | MCP manifest、schema 和策略。 |
| `mcp serve` | local | no-network | no | no | no | no | none | medium | stdio server，默认 readonly。 |
