# apexcn-cli 命令行终端手册

这份面向在终端中直接执行命令的用户。所有示例默认已经完成安装和认证。

## 全局

```bash
apexcn --help
apexcn --version
apexcn help search
apexcn commands --json
apexcn --config /tmp/apexcn-config.json auth show --json
```

建议脚本和 AI agent 都加 `--json`，方便解析。自动化需要隔离配置文件时，可使用根选项 `--config <path>` 或环境变量 `APEXCN_CONFIG_PATH`。

AI agent 需要判断命令、别名、用途、风险分类、安全示例和可用选项时，优先使用 `apexcn commands --json`，不要解析 `--help` 文本。当前结构化 manifest 契约为 `schemaVersion === 1`；如果缺失或不支持，不要消费结构化的 `safety` 或 `examples` 字段，应升级 CLI 或请求用户确认。manifest 中的 `schema` 列出可用枚举值；`safety.effects` 描述命令影响，`safety.preview` 描述是否支持或要求预览，`safety.confirmation` 列出显式确认参数，`examples[].mode` 区分读取、预览和执行示例。

manifest 还包含 additive 的 `manifestVersion === 2` 字段：`capability`、`apiEffect`、`riskLevel`、`authRequired`、`supportsJson`、`supportsPreview`、`supportsDryRun`、`mcpExposure` 和 `jsonContract`。旧字段保持兼容。`jsonContract` 指向成功 schema、统一错误 schema 和实际契约测试；不支持 JSON 的命令返回 `null`。

网络不稳定时，可设置 `APEXCN_HTTP_TIMEOUT_MS` 为所有社区 API 请求提供默认超时；`doctor --timeout-ms` 会覆盖这个默认值。空值或非正整数会被忽略。

脚本需要解析失败原因时，优先在命令上加 `--json`；支持 JSON 的命令会把 Commander 参数解析、验证、配置、网络和 API 错误写成单行 JSON 到 stderr。也可设置 `APEXCN_ERROR_FORMAT=json` 强制结构化错误；默认仍输出人类可读文本。

## guide

本地策展的新手任务路径，不读取认证配置、不调用 API、不执行部署或社区写操作：

```bash
apexcn guide learning --json
apexcn guide compatibility --apex-version 24.2 --ords-version 24.4 --json
apexcn guide deployment --format text
apexcn guide security --json
apexcn guide performance --json
```

兼容性和部署视图会明确要求核对官方 Oracle 文档与目标环境，不把社区经验描述成官方认证结论。

## MCP

MCP 是可选 AI Agent 适配层，CLI 仍是主产品。默认只读：

```bash
apexcn mcp tools --json
apexcn mcp inspect --json
apexcn mcp serve --readonly
```

如需让 AI Agent 生成写操作预览，可使用 `apexcn mcp tools --allow-preview-write --json` 或 `apexcn mcp serve --allow-preview-write`。preview-only 工具不会执行真实写入，返回中必须包含 `willExecute: false`。真实写执行继续走 CLI workflow。

## auth

保存 API key：

```bash
# 最简单的默认 prod profile 配置；普通字母数字 key 无需引号
apexcn -apikey "YOUR_API_KEY"
apexcn -apikey xxxxxx

# 高安全需求：只保存环境变量名
apexcn auth set-token \
  --profile agent-env \
  --base-url https://oracleapex.cn/ords/api \
  --token-env APEXCN_API_KEY

# 高级 profile 配置
apexcn auth set-token \
  --profile agent-prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "$APEXCN_API_KEY"
```

安装脚本不接收或配置 API key；以上认证命令只在安装成功后的独立步骤执行。

`-apikey` 把 key 保存到权限为 `0600` 的默认 `prod` profile，不回显 key，也不调用社区 API。引号只用于保护 shell 特殊字符；命令行参数可能进入 shell 历史和短暂出现在进程列表中。`--token-env <name>` 只保存环境变量名，适合更高安全要求。同时传 `--token-env` 和 `--token` 时，运行时优先使用环境凭据，缺失或无效时回退到文件凭据；两个 backend 都没有可用 token 时，API 命令会在发起请求前 fail closed。token 必须由可用于 HTTP header 的可见 ASCII 字符组成，不能包含空白，也不能是 `你的_API_KEY`、`YOUR_API_KEY` 等示例占位符。`--base-url` 必须是绝对 `http` 或 `https` URL。
如果只想保存 profile 而不切换当前 profile，加 `--no-switch`。

查看当前 profile：

```bash
apexcn auth show
apexcn auth show --json
apexcn auth audit --json
apexcn auth list
apexcn auth list --json
apexcn auth use agent-prod
apexcn auth remove old-profile
```

`auth audit` 是纯本地配置审计，不调用 API。它会输出 `auth-audit`，检查 active profile、profile 指向、base URL、token、HTTP profile 和重复 base URL。完整 token 不会出现在输出中。

退出当前 profile：

```bash
apexcn auth logout
```

## me

查看当前账号：

```bash
apexcn me
apexcn me --json
apexcn me --json --redact
apexcn me --verbose --json
apexcn me --format text
```

`--redact` 会遮蔽账号邮箱，适合把 `me --json` 放进日志、审计或支持材料。

## doctor

检查安装、登录和 API 连通性：

```bash
apexcn doctor
apexcn doctor --json
apexcn doctor --format json
apexcn doctor --format text
apexcn doctor snapshot --json
apexcn doctor snapshot --output ./support-snapshot.json --json
apexcn doctor --check-ask "Oracle APEX 如何调用 REST API？" --json
apexcn doctor --timeout-ms 10000 --json
```

`doctor` 默认输出文本。`--format json` 输出压缩 JSON；`--json` 和 `--format pretty` 输出格式化 JSON。JSON 输出包含 CLI 版本、User-Agent、配置文件路径、Node.js 版本、平台和架构等诊断信息。默认只检查 profile、账号、板块和搜索；只有显式传 `--check-ask <question>` 时才会额外检查 RAG 问答接口。`--timeout-ms` 可为每个检查设置毫秒级请求超时。

`doctor snapshot` 是纯本地支持快照，不调用社区 API。它直读配置文件并输出 `kind: "doctor-snapshot"`、`schemaVersion: 1`、`diagnostics`、`environment`、`config`、`agentSkill` 和稳定 `checks[].code`。硬问题 code 包括 `config-unreadable`、`config-invalid-json`、`no-active-profile`、`missing-current-profile`、`invalid-base-url`、`invalid-timeout-env`；warning code 包括 `api-key-env-missing`、`missing-token`、`agent-skill-missing`。环境变量只输出是否存在或是否有效；token 只输出是否存在和脱敏长度，不输出完整值。`--output <file>` 会以仅当前用户可读写权限保存同一份脱敏快照。

## category

列出板块：

```bash
apexcn category list
apexcn category list --json
apexcn category list --format text
```

## stats

读取聚合统计接口。0.4.0-candidate 起支持日期窗口和 top 列表大小：

```bash
apexcn stats category --json
apexcn stats category --from 2026-07-01 --to 2026-07-05 --json
apexcn stats topic --json
apexcn stats topic --tag "ORDS" --from 2026-07-01 --top 10 --json
apexcn stats tag --format text
apexcn stats tag --from 2026-07-01 --top 20 --json
```

`stats category` 返回每个板块的话题数、回复数和精选话题数。`stats topic` 返回全局或精确 tag 过滤的话题统计，并在未指定 `--tag` 时包含 `tagCounts`。`stats tag` 返回精确 tag 使用次数。

## admin

读取公开管理员列表：

```bash
apexcn admin list --json
apexcn admin list --format text
```

`admin list` 只返回服务端标记为公开的管理员信息和公开联系方式，不包含私有联系信息。

## me activity

读取当前登录账号的聚合统计和活动列表：

```bash
apexcn me stats --json
apexcn me capabilities --json
apexcn me capabilities --require-capability personal-community favorite-topic-export --json
apexcn me notifications --json
apexcn me inbox --json
apexcn me rules --json
apexcn me privacy --json
apexcn me topics --page-size 10 --json
apexcn me replies --page-size 10 --cursor "<page.nextCursor>" --json
apexcn me favorites --format text
apexcn me subscriptions --json
```

`me` 默认递归脱敏 email、手机号、IP、地址和 secret-like 字段；只有显式 `me --include-private` 才显示服务端返回的私有账号字段。`me topics`、`me replies`、`me favorites` 和 `me subscriptions` 优先使用服务端返回的 opaque `page.nextCursor` 继续分页；兼容旧服务端时仍可使用 `offset/page.nextOffset`，但 `--cursor` 与 `--offset` 不能同时使用。

`me capabilities` 读取服务端 `contractVersion` 与能力矩阵，并增加 `clientCompatibility`。0.80.x 只接受已声明的 0.8、0.7、0.6 candidate 契约窗口；格式错误、更新或更旧的契约都 fail closed。当前 0.8 契约还必须公布完整支持窗口。`--require-capability <ids...>` 会在任一必需能力不可用时以非零状态退出。`me notifications`、`me inbox`、`me rules` 和 `me privacy` 只转发权威只读契约；能力缺失时保留服务端的 `available: false`、`status: "UNAVAILABLE"`、`unavailableReason` 和 `requestId`，不会生成空消息、规则或政策冒充真实数据。

## search

基础搜索：

```bash
apexcn search "Oracle APEX" --json
apexcn search "Oracle APEX" --format text
apexcn search "ORDS" --tags APEX,ORDS --has-useful-reply --source-type external --json
```

限制数量：

```bash
apexcn search "REST API" --page-size 5 --json
```

按板块搜索：

```bash
apexcn search "性能优化" --category-id 4 --json
```

列出话题并使用服务端筛选：

```bash
apexcn topic list --view unanswered --page-size 20 --json
apexcn topic list --source-domain example.com --sort updated --json
```

`search` 和 `topic list` 支持服务端过滤：`--tag`、`--tags`、`--author`、`--author-id`、`--source-domain`、`--original-url`、`--content-type`、`--source-type`、`--status`、`--view`、`--sort`、`--featured`、`--pinned`、`--locked`、`--unanswered`、`--has-useful-reply`、`--from/--to`、`--from-date/--to-date`、`--category-id`、`--page-size`、`--cursor`、`--offset`。优先使用 `page.nextCursor` 继续分页，`--offset` 仅用于兼容。

```bash
apexcn search "ORDS" --category-id 4 --page-size 10 --json
```

按更新时间范围搜索：

```bash
apexcn search "JSON" --from-date 2026-01-01 --to-date 2026-12-31 --json
apexcn search "ApexLang" --page-size 5 --cursor "next-cursor" --json
```

`--page-size` 支持 1 到 50。常见写法 `ApexLang`、`APEXLang`、`APEX Lang` 会归一化为 `ApexLang` 发起搜索；JSON 输出会在发生归一化时包含 `query.normalizedKeyword`。`--cursor` 使用服务端 `page.nextCursor` 读取下一页，是 0.2.0-candidate 起推荐的分页方式；`--offset` 保留为兼容参数。后端返回 `createdDate` 表示话题创建时间，`updatedDate` 表示最近更新时间。需要缩小范围时，优先使用 `--category-id`、`--from-date` 和 `--to-date`。

如果搜索结果为空，JSON 输出会包含 `emptyResult`，文本输出会提示放宽关键词、移除过滤条件，并建议尝试 `search`、`research` 或 `topic recent`。

## topic recent

读取最近更新的话题：

```bash
apexcn topic recent --json
apexcn topic recent --since-hours 48 --page-size 10 --json
apexcn topic recent --category-id 4 --from-date 2026-07-01 --to-date 2026-07-04 --cursor "next-cursor" --format text
```

`topic recent` 是只读命令，默认读取最近 48 小时更新的话题。它优先调用 0.2.0-candidate 的 `GET /api/v1/topics`，返回项应包含 `createdDate` 和 `updatedDate`；如果运行时服务端尚未 promotion 该接口，会自动降级为 search 通配查询并按 topic detail 尽量补齐 `createdDate`、`originalUrl`、`tags`、`viewCount` 等字段。JSON 输出包含 `kind: "topic-recent"`、`source`、`query`、`items`、`page`、`requestIds` 和 `errors`。如果 `page.hasMore` 为 `true`，继续使用 `page.nextCursor` 调用 `--cursor`。

## research

一次搜索并抓取前几条帖子，生成适合 AI agent 总结和引用的研究包：

```bash
apexcn research "REST API" --limit 3 --json
apexcn research "ORDS" --category-id 4 --from-date 2026-01-01 --format text
```

`--limit` 支持 1 到 10，默认 3。JSON 输出固定包含 `query`、`searchAttempts`、`items`、`topics`、`links`、`requestIds`、`provenance` 和 `errors`。原始自然语言短语无结果时，命令最多使用 3 个可解释的技术关键词做只读重试；`query.attemptedKeywords`、`query.selectedKeyword` 和 `searchAttempts` 保留每次查询及 requestId。`links` 会按 topic id 或 URL 去重，并在后端返回时保留 `createdDate`、`updatedDate` 和 `originalUrl`。单个帖子抓取失败时，命令仍输出已完成的研究包并把失败写入 `errors`，同时返回非零退出码。

## collection

构建可离线复用的多来源资料库：

```bash
apexcn collection build \
  --query "REST API" \
  --query "ORDS" \
  --topic-id 30549 \
  --limit 3 \
  --output-dir collection \
  --json

apexcn collection verify --dir collection --json
apexcn collection sync --dir collection --json
apexcn collection index --dir collection --incremental --json
```

`collection build` 与 `collection sync` 只发送 GET，不执行 API 写操作；当前 profile 的 base URL 与 collection 来源不一致时，sync 会在刷新前失败。collection manifest v2 为每个 topic 和整个 collection 保存 canonical content hash；requestId 与生成时间不影响这些 hash。`index --incremental` 会复用 canonical hash 未变化的索引记录。

可从当前认证用户的收藏只读导出直接构建资料库，并做确定性离线迁移：

```bash
apexcn collection favorites --output-dir favorites --json
apexcn collection export --dir favorites --output favorites.bundle.json --json
apexcn collection verify-bundle --bundle favorites.bundle.json --json
apexcn collection import --bundle favorites.bundle.json --output-dir restored --json
apexcn collection restore --bundle favorites.bundle.json --dir favorites --json
```

`collection favorites` 遍历服务端认证只读 cursor，保留完整正文、URL、topicId、收藏时间、更新时间和 provenance。import 要求目标目录为空；restore 只覆盖 bundle 管理的文件，不删除无关文件。

离线自动化不访问网络，也不能发送社区写请求：

```bash
apexcn collection automation plan --dir favorites --query "ORDS auth" --output plan.json --json
apexcn collection automation run --plan plan.json --output result.json --json
```

plan/run 不绑定具体调度器，可由用户选择的本地 scheduler 调用 `automation run`；相同 plan 与 content hash 的重复执行会抑制重复输出。

结果明确记录 `networkRequests: 0` 和 `unattendedWriteRequests: 0`；同一计划与同一 collection 内容重复执行时会抑制重复输出。

## draft

本地生成可审阅的问题草稿，不读取认证配置，不调用社区 API，也不会发布内容：

```bash
apexcn draft question \
  --title "APEX 中调用 REST API 返回 403" \
  --problem "页面进程调用 REST API 时返回 403。" \
  --environment "APEX 24.1 / ORDS 24" \
  --tried "确认 URL 可以从浏览器访问。" \
  --expected "返回 JSON 数据。" \
  --actual "返回 403。" \
  --json
```

JSON 契约固定为 `kind`、`schemaVersion`、`title`、`content`、`sections` 和 `references`。`content` 是完整 Markdown 正文；`sections` 固定包含 `problem`、`environment`、`tried`、`expected` 和 `actual`；空字段在 JSON 中保留为空字符串，在 Markdown 中显示为 `待补充`。

接入 `research` 研究包：

```bash
apexcn research "REST API" --limit 3 --json > research.json
apexcn draft question \
  --title "APEX 中调用 REST API 返回 403" \
  --problem "页面进程调用 REST API 时返回 403。" \
  --research-file research.json \
  --format text > question.md
apexcn topic create --category-id 4 --title "APEX 中调用 REST API 返回 403" --content-file question.md --preview
```

`--research-file <path>` 接受 `research --json` 输出，也可用 `--research-file -` 从 stdin 读取。引用会按 `url`、`originalUrl`、`id` 去重，并按 `links`、`items`、`topics` 的顺序提取 `id`、`title`、`url` 和 `originalUrl`。只有 `--format text` 输出适合作为 `topic create --content-file` 的 Markdown 正文；JSON 输出用于审查和脚本处理。

本地起草回复：

```bash
apexcn draft reply \
  --topic-id 30549 \
  --answer "建议先确认 Web Credential，再检查 ORDS 日志。" \
  --topic-file topic.json \
  --research-file research.json \
  --format text > reply.md
apexcn reply create 30549 --content-file reply.md --preview
```

`draft reply` 默认输出 JSON，固定包含 `kind: "reply-draft"`、`schemaVersion: 1`、`topicId`、`parentPostId`、`content`、`references` 和 `metadata`。未提供 `--parent-post-id` 时 JSON 中固定为 `null`。`--topic-id` 必填；如果 `--topic-file` 中的 `topic.id`、根 `id`、`topicId` 或 `threadId` 与 `--topic-id` 不一致，命令会拒绝。Markdown 固定包含 `## 简短回应`、`## 建议步骤`、`## 参考链接`；无引用时输出 `无参考链接。`，不会输出 `待补充`。`--tone concise|friendly|technical` 会产生固定不同的开头语，JSON 的 `metadata.tone` 也会记录该值。

需要长期保存时，给 `draft question` 或 `draft reply` 增加 `--save --json`。保存动作要求存在 active profile；普通草稿生成仍不读取认证配置。草稿 inventory 位于本地配置目录，profile 名只用于计算 SHA-256 隔离目录，草稿文件权限为 `0600`：

```bash
apexcn draft question --title "标题" --problem "现象" --save --json
apexcn draft list --json
apexcn draft restore <draft-id> --format text
apexcn draft export --output ./drafts.json --json
apexcn auth use another-profile
apexcn draft import --input ./drafts.json --json
apexcn draft delete <draft-id> --yes --json
```

`export/import` 是 profile 间迁移路径；导入时保留草稿 id、时间和全部内容字段，只把 owner 绑定到当前 profile。遇到同 id 默认拒绝，只有显式 `--replace` 才覆盖。导出文件已存在时默认拒绝，只有 `--force` 才替换。

## review

本地审查待发布话题，不读取认证配置，不调用社区 API，也不会发布内容。它用于 `draft question` 和 `topic create --preview` 之间：

```bash
apexcn review topic \
  --title "APEX 中调用 REST API 返回 403" \
  --content-file question.md \
  --category-id 4 \
  --tags "APEX,REST" \
  --json
```

也可以直接审查 inline Markdown：

```bash
apexcn review topic --title "APEX 中调用 REST API 返回 403" --content "## 问题..." --json
```

输入模式三选一：`--title` + `--content <markdown>`、`--title` + `--content-file <path|->`，或 `--draft-file <path|->`。`--draft-file` 只接受 v2 草稿 JSON：`kind === "question-draft"`、`schemaVersion === 1`、并包含字符串 `title` 和 `content`。

JSON 输出固定包含 `kind`、`schemaVersion`、`ok`、`issues`、`warnings`、`metrics`、`requestPlan` 和 `suggestedCommand`。`issues[].severity` 为 `issue`，会导致 `ok=false` 和非零退出码；`warnings[].severity` 为 `warning`，只提醒。硬性问题包括空标题、空正文、正文少于 80 个字符、仍含 `待补充`、以及疑似 `Authorization: Bearer ...`、`Bearer ...`、`APEXCN_API_KEY=`、`token=`、`password=`。如果命中疑似密钥，`requestPlan.body.content` 会脱敏。

`suggestedCommand` 只在输入来自可复用 Markdown 文件时生成。inline 内容、stdin 或 draft JSON 输入不会把内容直接拼进 shell 命令，也不会把 draft JSON 当作 `--content-file`；此时 `suggestedCommand` 为 `null`，需要先把 Markdown 正文保存到文件再执行 `topic create --content-file`。`review topic` 不替代 `topic create --preview`，只是在 API 预览前做本地质量和安全闸门。

回复也有独立的本地审查门禁，用于 `draft reply` 和 `reply create --dry-run` 之间：

```bash
apexcn review reply --topic-id 30549 --content-file reply.md --json
```

`review reply` 支持 `--content-file <path|->` 或 `--draft-file <path|->`。`--draft-file` 只接受 `kind === "reply-draft"`、`schemaVersion === 1` 的草稿 JSON；如果同时传入 `--topic-id` 或 `--parent-post-id` 且与草稿不一致，会在 `reply-review.issues[]` 中报告。输入缺失、输入冲突、非法 topic id、空回复、过短回复、占位符和疑似密钥都会输出稳定的 `reply-review` JSON，而不是发送 API 请求。只有普通 Markdown 文件输入会生成 `apexcn reply create <topic-id> --content-file <file> --dry-run --json` 的 `suggestedCommand`。

## workflow

本地生成可审计执行计划，不读取认证配置，不调用 API，也不会执行计划中的命令：

```bash
apexcn workflow plan \
  --goal ask-question \
  --keyword "REST API" \
  --title "APEX 中调用 REST API 返回 403" \
  --problem "页面进程调用 REST API 时返回 403。" \
  --category-id 4 \
  --output-dir work \
  --json
```

`--goal` 支持 `ask-question`、`reply`、`research-only`、`publish-topic`，以及 `topic-create/update/delete`、`reply-create/update/delete`。JSON 输出固定包含 `kind: "workflow-plan"`、`schemaVersion: 1`、`goal`、`steps`、`checkpoints`、`files` 和 `safetySummary`。CRUD 计划会明确列出 preview、hash-bound approval 和 execute；MCP 调用 plan 时永远不会执行这些步骤。

运行可恢复工作流：

```bash
apexcn workflow run \
  --goal ask-question \
  --keyword "REST API" \
  --title "APEX 中调用 REST API 返回 403" \
  --problem "页面进程调用 REST API 时返回 403。" \
  --category-id 4 \
  --output-dir run \
  --json

apexcn workflow approve --run-dir run --approved-by reviewer --note "preview reviewed" --json
apexcn workflow verify --run-dir run --write-report --json
apexcn workflow export --run-dir run --output workflow-bundle.json --json
apexcn workflow verify-bundle --bundle workflow-bundle.json --json
apexcn workflow run --resume run --execute --yes --json
```

默认运行生成 Markdown 草稿或读取内容文件副本，写入 `run.json`、`review.json` 和 `preview.json`，不会发送最终写请求。确认 `preview.json` 后，用 `workflow approve` 写入包含目标、完整请求、preview SHA-256 和 `expiresAt` 的 `approval.json`。只有 approval 的 runId、目标、请求、hash 和期限都有效时，`--resume <run-dir> --execute --yes` 才会执行最终写入，并写入 `execute.json`。401/429 修复后复用同一 run；timeout/5xx 结果不确定时也只能复用同一 run 和 operationKey；409 必须重新读取版本并创建、审核、批准新 workflow。

`workflow verify` 是纯本地校验命令，会输出 `workflow-verification` 报告，检查 artifact 文件 hash、approval 与 preview 是否匹配、completed run 的 execute request 是否等于已批准 preview request。`--write-report` 会写入 `verification.json`，但不会修改 `run.json`。

`workflow export` 是纯本地导出命令，会先运行同等 verification。默认只导出 `ok=true` 的工作流；需要归档失败证据时可加 `--allow-invalid`。普通输出文件会写入 `workflow-bundle`，stdout 返回导出摘要；`--output -` 会直接把完整 bundle 输出到 stdout。

`workflow verify-bundle` 是纯本地 bundle 校验命令，不需要原始 run 目录。它会校验 bundle schema、artifact 内容 hash/size、embedded verification 是否匹配 artifact，并从 bundle 内的 preview、approval、execute 内容重新复核审批和执行链。

计划只使用正文文件路径，不会内联长正文或密钥。只有显式加 `--include-execute` 才会加入 `workflow approve` 和最终 execute 步骤，两步都会标记 `requiresConfirmation: true`。

## topic / thread

`thread` 是 `topic` 的别名。

查看帖子：

```bash
apexcn topic view 30549 --json
apexcn thread view 30549 --json
apexcn topic view 30549 --format text
```

创建帖子，正文来自文件：

```bash
apexcn topic create \
  --category-id 4 \
  --title "APEX 中如何调用 REST API？" \
  --content-file ./post.md \
  --tags "APEX,ORDS,REST" \
  --preview
```

0.60.x 起，直接 topic/reply 命令只允许预览，不再执行真实写入。真实写入请使用 `workflow run --goal topic-create`：

```bash
apexcn workflow run \
  --goal topic-create \
  --category-id 4 \
  --title "APEX 中如何调用 REST API？" \
  --content-file ./post.md \
  --output-dir ./topic-create-run \
  --json
```

创建帖子，正文来自命令行参数：

```bash
apexcn topic create \
  --category-id 4 \
  --title "APEX REST API 示例" \
  --content "想请教一个 APEX 调用 REST API 的问题。" \
  --preview
```

创建帖子，正文来自 stdin：

```bash
printf '正文来自 stdin\n' | apexcn topic create --category-id 4 --title "stdin 示例" --content-file - --preview
```

正文来源三选一：`--content-file`、`--content` 或 stdin。不要同时传 `--content` 和 `--content-file`，CLI 会拒绝执行。`--content-file -` 会明确读取 stdin；如果文件名真的叫 `-`，请写成 `--content-file ./-`。

编辑帖子：

```bash
apexcn topic update 30549 --content "更新后的正文。" --preview
apexcn topic edit 30549 --title "更新后的标题" --content-file ./updated-post.md --preview
apexcn thread edit 30549 --tags "APEX,REST" --preview
```

删除帖子：

```bash
apexcn topic delete 30549 \
  --yes \
  --force \
  --confirm-title "完整标题" \
  --preview
```

## reply / post

`post` 是 `reply` 的别名。

创建回复：

```bash
apexcn reply create 30549 --content "这个方法可行。" --preview
apexcn reply create 30549 --content-file ./reply.md --preview
printf '正文来自 stdin\n' | apexcn reply create 30549 --content-file - --preview
```

创建楼中楼回复：

```bash
apexcn reply create 30549 --parent-post-id 201480 --content "补充说明。" --preview
```

编辑回复：

```bash
apexcn reply update 201480 --content "更新后的回复。" --preview
apexcn reply edit 201480 --content-file ./reply-updated.md --preview
apexcn post edit 201480 --content "使用 post 别名更新。" --preview
```

删除回复：

```bash
apexcn reply delete 201480 --yes --force --preview
apexcn post delete 201480 --yes --force --preview
```

## favorite

收藏帖子：

```bash
apexcn favorite add 30549 --json
```

取消收藏：

```bash
apexcn favorite remove 30549 --json
```

## subscription

订阅帖子：

```bash
apexcn subscription add 30549 --json
```

取消订阅：

```bash
apexcn subscription remove 30549 --json
```

## ask

使用社区内容问答：

```bash
apexcn ask "Oracle APEX 如何调用 REST API？" --json
apexcn ask "ORDS OAuth2 Bearer token 怎么生成？" --top-k 3 --json
apexcn ask "最近 ORDS API 有哪些更新？" --tag ORDS --from 2026-07-01 --to 2026-07-05 --top-k 5 --json
apexcn ask "Oracle APEX 如何调用 REST API？" --format text
```

带 `--category-id`、`--from/--to` 或 `--tag` 的 filtered ask 会按范围返回 scoped references、`confidence`、`limitations` 和 `filters`。在服务端契约变更前，不要把 filtered ask 当作完整 RAG 生成回答。

问答引用会尽量从后端的 topic id、`card_link`、`doc_id`、`url` 或 `threadUrl` 补全可点击的 `https://oracleapex.cn/t/<id>` 链接；原始后端链接会保留为 `originalUrl`。

## 常用组合

契约和 MCP 清单：

```bash
apexcn commands --json
apexcn commands --json-schema
apexcn mcp tools --json
apexcn mcp tools --json --allow-preview-write
apexcn mcp inspect --json
```

本地资料包 BM25 检索：

```bash
apexcn collection index --dir ./collection --json
apexcn collection query --dir ./collection "ORDS 认证失败" --top-k 5 --explain --json
apexcn collection stats --dir ./collection --json
```

workflow policy、diff 和 audit log：

```bash
apexcn workflow policy init --output apexcn-policy.json
apexcn workflow verify --run-dir ./run --policy apexcn-policy.json --json
apexcn workflow diff --run-dir ./run --json
apexcn workflow audit-log --run-dir ./run --format ndjson
apexcn workflow audit-log --run-dir ./run --format ndjson > audit.ndjson
apexcn workflow audit-log --run-dir ./run --verify-file audit.ndjson --json
```

默认 policy 对未配置命令一律拒绝，create/update 至少需要一名独立审批人，delete 至少需要两名，审计证据保留期为 90 天。所选 policy 要求双人审批时，在 `workflow approve` 中增加 `--second-approver <name>`。恢复执行命令必须传 `--policy <file>` 才会在任何 API 写入前强制执行该 policy。审计事件带 SHA-256 hash chain；`--verify-file` 会拒绝缺失、乱序、修改或额外事件。

只读真实环境验收。没有 `APEXCN_API_KEY` 时脚本会跳过；有 key 时会检查 `doctor`、`me`、`category list`、`search` 和 `ask`，写操作只做 `--preview`：

```bash
npm run test:e2e:readonly
```

搜索后查看第一条：

```bash
apexcn search "REST API" --page-size 5 --json
apexcn topic view 30354 --json
```

发帖前确认板块：

```bash
apexcn category list --json
apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --preview
```

删除前确认标题：

```bash
apexcn topic view 30549 --json
apexcn topic delete 30549 --yes --force --confirm-title "完整标题" --preview
```

## API 写操作 dry-run 分类

一键安装脚本不接收参数，也没有 dry-run。CLI API `--preview` / `--dry-run` 用于打印将要发送的社区 API 写请求但不联网执行，输出包含 `dryRun`、`preview` 和 `mode`，便于区分真实预览和 dry-run。CLI API 预览只覆盖 `topic create/update/edit/delete`、`reply create/update/edit/delete`、`favorite add/remove`、`subscription add/remove`，别名 `thread` 和 `post` 继承同样分类。`ask` 虽然使用 POST，但属于只读 RAG 问答，不纳入 API 写操作预览。预览下不需要预先执行 `category list` 或 `topic view`；创建话题仍必须显式传 `--category-id`，删除话题仍必须传 `--yes --force --confirm-title`。
