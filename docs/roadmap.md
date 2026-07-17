# apexcn-cli Roadmap

> `roadmap.json` 是机器可读的唯一真相源。本文件由 `npm run roadmap:render` 生成。

## 产品定位

`apexcn-cli` 是 APEX 中文社区的本地 AI Agent 操作层、社区知识 CLI 和可审计内容工作流引擎。CLI 是主产品，MCP 是本地 stdio 薄适配层，真实写操作由 CLI workflow approval 管控。

主要用户：由终端或 AI Agent 协助、需要使用 APEX 中文社区知识与内容工作流的 Oracle APEX 开发者。

核心任务：
- `JOB-DISCOVER`: 可靠发现、检索、判断并引用社区知识
- `JOB-PERSONAL`: 安全管理 profile、个人社区状态和本地草稿资产
- `JOB-WRITE`: 通过可预览、可审批、可恢复、可审计的流程完成内容变更
- `JOB-AGENT`: 让 AI Agent 通过受限的本地适配层复用 CLI 核心能力

## 执行规则

- 每个主会话开始时必须读取 `roadmap.json` 与 `issues.json`。
- 只为当前里程碑生成即时执行计划，不预制后续里程碑实施计划。
- 每个里程碑必须启动一个独立 Codex 目标模式，直至全部验收、独立复验、问题清零和发版闭环完成。
- 每轮验证必须在固定测试项目中新建独立小白任务线程；主会话按当前里程碑和实际风险动态下发结构化测试范围。
- 固定基线套件与动态里程碑/逆向探索套件分开执行和计分，旧线程只作为历史证据。
- `issues.json` 只接收独立 validator 线程实际观察且证据完整的问题；规划缺口进入 `readinessRisks`。
- 同一时间最多一个里程碑为 `in_progress`。
- 修复后的问题从活动 `issues.json` 删除，首次失败证据保留在验证历史。
- 完成里程碑后必须归纳增强能力、意外问题、根因、规避措施和下一阶段预期。
- 发布验证和上下文压缩完成后，自动批准完成审查并激活下一个里程碑，无需再次等待用户确认。
- 每次目标模式小版本完成后必须 bump patch、通过本地门禁、提交、推送、打 tag，并直接创建 GitHub Release。
- 发版提交以 `[skip ci]` 结尾；不得触发 GitHub Actions，正常发版使用 `gh release create`。
- 发布验证后必须生成不超过 12 KiB 的 `reports/iteration-context.json`，并结束当前目标。

## 验证路由

| Role | Project | Thread policy | Model | Reasoning |
|---|---|---|---|---|
| Validator | /Users/kwang/Downloads/Works/66.Projects/apexcn-cli-test | `fresh-task-per-validation-round` | `gpt-5.6-luna` | `high` |
| ORDS API | /Users/kwang/apexcn-forums | `019f2888-ef40-7b20-9af7-e4495f3a1091` | `gpt-5.6-terra` | `high` |

真实 API 验证可在 `dev@oci` 创建最小权限专用 API key；不得写入仓库、日志、fixture 或证据包，也不得用于生产社区写操作。

所有 CLI 回写场景必须同时保留后端/API 证据和 Codex 侧边栏真实浏览器视觉证据。浏览器复核标题、正文、格式、可见状态、用户可访问性与截图；不得只验证数据库。复用既有专用测试账号，不得逐轮新建。

## 里程碑总览

| Stage | Release line | Theme | Status | Active issues | Activation | Completion review |
|---|---|---|---|---:|---|---|
| `0.2` | `0.20.x` | 可信赖的 CLI 基础 | `completed` | 0 | `approved` | `approved` |
| `0.3` | `0.30.x` | 社区知识检索 | `completed` | 0 | `approved` | `approved` |
| `0.4` | `0.40.x` | 个人工作台与能力协商 | `in_progress` | 3 | `approved` | `pending` |
| `0.5` | `0.50.x` | AI Agent 只读适配层 | `planned` | 0 | `waiting` | `not_due` |
| `0.6` | `0.60.x` | 可审计内容操作 | `planned` | 0 | `waiting` | `not_due` |
| `0.7` | `0.70.x` | 本地知识资产与只读自动化 | `planned` | 1 | `waiting` | `not_due` |
| `0.8` | `0.80.x` | 组织治理与生命周期资格化 | `planned` | 0 | `waiting` | `not_due` |
| `0.9` | `0.90.x` | GA 候选版本 | `planned` | 0 | `waiting` | `not_due` |

## 0.2 / 0.20.x: 可信赖的 CLI 基础

让首次使用者无需理解内部实现即可完成安装、认证、命令发现、故障诊断和核心只读任务。

**用户结果：** 首次用户能够安装、认证、发现命令、诊断问题并完成核心只读任务。

**阶段非目标：** 实时检索质量优化；个人工作台；真实内容写入

### 能力

| ID | Capability | Status | User value |
|---|---|---|---|
| `M020-CAP-INSTALL` | 无版本号安装与发布可信链 | `validated` | 用户始终安装最新稳定版本，并能验证下载资产完整性。 |
| `M020-CAP-CONTRACT` | 稳定命令与 JSON 契约 | `validated` | 终端、脚本和 Agent 能依赖一致的命令清单、schema、退出码和错误结构。 |
| `M020-CAP-AUTH` | 认证、profile 与诊断 | `validated` | 用户能安全配置身份并获得不泄密的可执行诊断。 |
| `M020-CAP-UX` | 可执行的新手反馈 | `validated` | 空结果、权限、限流、超时和服务错误都给出下一步操作。 |
| `M020-CAP-FEEDBACK` | 独立黑盒反馈闭环 | `validated` | 产品结论由独立项目中的自然语言黑盒验证支撑。 |

### 核心验收

| ID | Status | Metric | Target | Measurement |
|---|---|---|---|---|
| `M020-AC-001` | `pass` | 公开命令全部进入 command registry。 | `>= 100 percent` | compare executable public commands with command registry descriptors |
| `M020-AC-002` | `pass` | 公开 JSON 命令全部有契约测试。 | `>= 100 percent` | map public JSON commands to schema and contract tests |
| `M020-AC-003` | `pass` | 401/403/404/409/429/5xx/network/timeout 均产生稳定且可执行的反馈。 | `= 8 cases` | black-box error matrix |
| `M020-AC-004` | `pass` | CLI、JSON、doctor、MCP、workflow、日志和 fixture 中无密钥泄露。 | `= 0 findings` | automated redaction tests and artifact scan |
| `M020-AC-005` | `pass` | macOS/Linux 安装测试和 PowerShell 静态门禁通过。 | `= 2 gates` | installer integration and PowerShell static checks |
| `M020-AC-006` | `pass` | 至少执行 60 个 L0/L1 自然语言首次尝试任务。 | `>= 60 tasks` | fresh independent validator report with frozen baseline suite and dynamically assigned milestone suite |
| `M020-AC-007` | `pass` | L0/L1 自然语言任务首次成功率至少 95%。 | `>= 95 percent` | fresh independent validator report with frozen baseline suite and dynamically assigned milestone suite |
| `M020-AC-008` | `pass` | 当前里程碑不存在活动 P0/P1 问题。 | `= 0 issues` | issues.json entries scoped to milestone 0.2 |
| `M020-AC-009` | `pass` | command registry、JSON schema、capability matrix、MCP manifest 和用户文档漂移为零。 | `= 0 findings` | generated consistency inventory |

### 活动问题

无。

### 人工交接门禁

- Activation: `approved`
- Completion review: `approved`
- 完成后必须总结：增强能力、未预估问题、根因、规避措施、下一阶段目标、量化预期和主要风险。
- 发布验证和上下文压缩完成后，自动批准完成审查并启动下一里程碑。

## 0.3 / 0.30.x: 社区知识检索

让用户可靠发现、检索、总结并引用当前社区知识。

**用户结果：** 用户能够基于真实社区数据检索、引用、拒答并判断答案来源。

**阶段非目标：** 个人数据管理；内容写入；本地大规模 collection

### 能力

| ID | Capability | Status | User value |
|---|---|---|---|
| `M030-CAP-RETRIEVAL` | 统一检索模型 | `validated` | 搜索、过滤、cursor、最近主题和主题详情行为一致。 |
| `M030-CAP-RAG` | 可追溯 ask 与 research | `validated` | 答案具备真实引用、新鲜度、过滤条件和来源。 |
| `M030-CAP-EVAL` | 真实只读检索评测 | `validated` | 质量结论来自 dev@oci 真实只读 API，而非仅 fixture 完整性。 |
| `M030-CAP-CONFIDENCE` | 低置信拒答与缩小范围 | `validated` | 资料不足时不编造答案，并给出可执行的收窄建议。 |

### 核心验收

| ID | Status | Metric | Target | Measurement |
|---|---|---|---|---|
| `M030-AC-001` | `pass` | 中文真实检索评测问题不少于 50 条。 | `>= 50 questions` | versioned live-read evaluation dataset |
| `M030-AC-002` | `pass` | Top-5 期望引用命中率至少 85%。 | `>= 85 percent` | dev@oci readonly retrieval evaluation |
| `M030-AC-003` | `pass` | 引用覆盖率至少 90%。 | `>= 90 percent` | answer-to-reference support mapping |
| `M030-AC-004` | `pass` | 至少 10 个不可回答问题全部正确说明限制或拒答。 | `= 100 percent` | independent low-confidence scenario set |
| `M030-AC-005` | `pass` | 连续 5 页 cursor 分页无重复和丢失。 | `= 0 records` | five-page live API traversal |
| `M030-AC-006` | `pass` | search P95 不超过 5 秒。 | `<= 5 seconds` | recorded dev@oci benchmark |
| `M030-AC-007` | `pass` | ask/research P95 不超过 15 秒。 | `<= 15 seconds` | recorded dev@oci benchmark |
| `M030-AC-008` | `pass` | 至少 40 个独立自然语言检索任务首次成功率不低于 90%。 | `>= 90 percent` | fixed independent validator report with at least 40 tasks |
| `M030-AC-009` | `pass` | 所有结果包含真实 URL、可用 requestId 和来源信息。 | `= 100 percent` | sampled public JSON result contract |

### 活动问题

无。

### 人工交接门禁

- Activation: `approved`
- Completion review: `approved`
- 完成后必须总结：增强能力、未预估问题、根因、规避措施、下一阶段目标、量化预期和主要风险。
- 发布验证和上下文压缩完成后，自动批准完成审查并启动下一里程碑。

## 0.4 / 0.40.x: 个人工作台与能力协商

让认证用户安全查看个人社区状态、管理 profile 隔离的本地草稿，并准确识别服务端能力边界。

**用户结果：** 用户能够在多个 profile 间安全管理个人数据和草稿，且不会收到伪造的服务端能力结果。

**阶段非目标：** 内容发布 workflow；favorites-to-collection；collection 规模化

### 能力

| ID | Capability | Status | User value |
|---|---|---|---|
| `M040-CAP-PERSONAL` | 统一个人数据面 | `implemented` | 用户能统一查看 profile、主题、回复、收藏、订阅和统计。 |
| `M040-CAP-INBOX` | 通知、收件箱与规则 | `implemented` | 服务端提供契约时，用户可从 CLI 获取通知、规则和隐私信息。 |
| `M040-CAP-DRAFTS` | profile 隔离的本地草稿资产 | `implemented` | 用户可保存、列出、恢复、迁移和删除本地草稿，且 profile 之间不会串数据。 |
| `M040-CAP-PRIVACY` | profile 隔离与隐私输出 | `implemented` | 多个身份不会串用凭据、缓存、输出或动作。 |
| `M040-CAP-PREVIEW` | 个人动作预览 | `implemented` | 可逆动作在执行前展示真实请求。 |

### 核心验收

| ID | Status | Metric | Target | Measurement |
|---|---|---|---|---|
| `M040-AC-001` | `pending` | 个人列表分页无重复或丢失。 | `= 0 records` | live readonly traversal for each personal list |
| `M040-AC-002` | `pending` | 三个 profile 在凭据、缓存、输出和动作上完全隔离。 | `= 0 failures` | three-profile black-box matrix |
| `M040-AC-003` | `pending` | 隐私和敏感字段泄露为零。 | `= 0 findings` | output and artifact scan |
| `M040-AC-005` | `pending` | 服务端缺失能力全部明确返回 unavailable，不生成虚假数据。 | `= 100 percent` | server capability negotiation scenarios |
| `M040-AC-006` | `pending` | 至少 30 个个人工作台自然语言任务首次成功率不低于 95%。 | `>= 95 percent` | fixed validator report with at least 30 tasks |
| `M040-AC-007` | `pending` | 所有可逆动作 preview 与最终批准请求一致。 | `= 100 percent` | preview and approved request comparison |
| `M040-AC-008` | `pending` | 至少 50 个草稿的保存、列出、恢复、导出和迁移字段保真率为 100%。 | `= 100 percent` | profile-separated draft round-trip fixture |
| `M040-AC-009` | `pending` | 三个 profile 交错管理草稿时串数据和越权访问为零。 | `= 0 failures` | three-profile draft isolation matrix |

### 活动问题

| ID | Priority | Owner | Status | Title |
|---|---|---|---|---|
| `ISSUE-040-001` | `P1` | `server` | `open` | Expose notifications, rules, and privacy contracts |
| `ISSUE-040-003` | `P2` | `cli` | `open` | Decide local draft inventory storage |
| `ISSUE-040-004` | `P1` | `cli` | `open` | Stabilize no-profile JSON error envelope |

### 人工交接门禁

- Activation: `approved`
- Completion review: `pending`
- 完成后必须总结：增强能力、未预估问题、根因、规避措施、下一阶段目标、量化预期和主要风险。
- 发布验证和上下文压缩完成后，自动批准完成审查并启动下一里程碑。

## 0.5 / 0.50.x: AI Agent 只读适配层

让 AI 客户端通过稳定、安全的本地 stdio 适配层复用 CLI 只读核心能力。

**用户结果：** AI 客户端能够发现并稳定完成社区只读任务，且不产生任何真实写请求。

**阶段非目标：** preview-only 写工具资格化；MCP execute-write；远端 HTTP MCP Server

### 能力

| ID | Capability | Status | User value |
|---|---|---|---|
| `M050-CAP-POLICY` | MCP readonly 安全策略 | `partial` | Agent 可读取社区能力，但不能产生或执行真实写请求。 |
| `M050-CAP-CORE` | CLI/MCP 共用核心服务 | `partial` | CLI 和 Agent 得到相同请求、安全和错误语义。 |
| `M050-CAP-CLIENTS` | 真实 MCP 客户端兼容 | `not_started` | 用户知道哪些客户端版本经过真实连接验证。 |
| `M050-CAP-PROTOCOL` | 稳定 stdio 协议 | `partial` | MCP 启动、发现、调用和错误在连续运行中保持稳定。 |

### 核心验收

| ID | Status | Metric | Target | Measurement |
|---|---|---|---|---|
| `M050-AC-001` | `pending` | 计划暴露的 readonly 命令全部映射到共用 core 的 MCP 工具。 | `= 100 percent` | command and tool registry plus service dependency inspection |
| `M050-AC-002` | `pending` | readonly 模式真实写请求为零。 | `= 0 requests` | readonly MCP network observation and call trace |
| `M050-AC-003` | `pending` | command registry、shared core 与 MCP readonly exposure matrix 漂移为零。 | `= 0 findings` | registry core service and MCP manifest consistency gate |
| `M050-AC-004` | `pending` | Claude Desktop、Cursor 和 VS Code Agent 均有带版本和日期的真实验证证据。 | `= 3 clients` | real client compatibility records |
| `M050-AC-005` | `pending` | 连续 100 次 JSON-RPC 调用无协议失败。 | `= 0 failures` | 100-call stdio soak |
| `M050-AC-006` | `pending` | 至少 40 个 Agent 自然语言任务首次成功率不低于 95%。 | `>= 95 percent` | fixed validator report with at least 40 tasks |
| `M050-AC-007` | `pending` | MCP 启动 P95 不超过 2 秒。 | `<= 2 seconds` | recorded local startup benchmark |
| `M050-AC-008` | `pending` | MCP 输出和错误中的密钥泄露为零。 | `= 0 findings` | MCP response and error scan |

### 活动问题

无。

### 人工交接门禁

- Activation: `waiting`
- Completion review: `not_due`
- 完成后必须总结：增强能力、未预估问题、根因、规避措施、下一阶段目标、量化预期和主要风险。
- 发布验证和上下文压缩完成后，自动批准完成审查并启动下一里程碑。

## 0.6 / 0.60.x: 可审计内容操作

让授权用户通过可恢复、hash-bound、可审计的 CLI workflow 执行内容变更，同时 Agent 只能生成 preview。

**用户结果：** 授权用户能够安全完成内容变更，并从最终页面确认写入结果；Agent 无法绕过 workflow。

**阶段非目标：** 无人确认的生产写入；MCP execute-write；远端托管写服务

### 能力

| ID | Capability | Status | User value |
|---|---|---|---|
| `M060-CAP-CRUD` | 主题与回复 CRUD | `partial` | 用户可通过稳定命令管理主题和回复。 |
| `M060-CAP-REVIEW` | 草稿与审核门禁 | `partial` | 正文质量、隐私和密钥问题在 API preview 前被发现。 |
| `M060-CAP-WORKFLOW` | hash-bound workflow | `partial` | preview、approval 和 execute 绑定同一请求并可恢复审计。 |
| `M060-CAP-TEST-ENV` | 隔离写测试环境 | `not_started` | 真实写流程可验证且不污染生产社区或遗留测试资源。 |
| `M060-CAP-VISUAL` | 回写页面视觉验收 | `not_started` | 用户在真实页面看到的内容、格式、状态和权限与写请求一致。 |
| `M060-CAP-AGENT-PREVIEW` | Agent preview-only 写工具 | `partial` | Agent 可生成受策略约束的写预览，但不能执行写操作。 |

### 核心验收

| ID | Status | Metric | Target | Measurement |
|---|---|---|---|---|
| `M060-AC-001` | `pending` | 至少 20 个完整写 workflow 首次尝试样本通过。 | `>= 20 workflows` | isolated dev@oci validator run |
| `M060-AC-002` | `pending` | 成功执行的 preview、approval 和 execute 请求 hash 100% 一致。 | `= 100 percent` | workflow artifact hash comparison |
| `M060-AC-003` | `pending` | 缺确认、过期审批、正文变化和权限不足全部阻断。 | `= 100 percent` | negative workflow matrix |
| `M060-AC-004` | `pending` | delete 确认绕过为零。 | `= 0 bypasses` | delete preview approval and execute attack scenarios |
| `M060-AC-005` | `pending` | resume 和 retry 不产生重复写入。 | `= 0 writes` | idempotence and resume scenarios |
| `M060-AC-006` | `pending` | 401/409/429/timeout 恢复不产生不确定重复写。 | `= 0 writes` | fault-injected isolated workflow runs |
| `M060-AC-007` | `pending` | workflow、审核和测试证据中无密钥泄露。 | `= 0 findings` | artifact and log secret scan |
| `M060-AC-008` | `pending` | 隔离测试资源残留为零。 | `= 0 resources` | post-run isolated environment inventory |
| `M060-AC-009` | `pending` | 当前里程碑不存在活动 P0/P1 问题。 | `= 0 issues` | issues.json entries scoped to milestone 0.5 |
| `M060-AC-010` | `pending` | 20 个隔离写 workflow 全部具备同一对象的后端证据与 Codex 真实浏览器视觉证据。 | `= 100 percent` | dual evidence validator report |
| `M060-AC-011` | `pending` | 全部 preview-only MCP 工具返回 willExecute=false 且真实写请求为零。 | `= 0 bypasses` | preview tool call and network trace |

### 活动问题

无。

### 人工交接门禁

- Activation: `waiting`
- Completion review: `not_due`
- 完成后必须总结：增强能力、未预估问题、根因、规避措施、下一阶段目标、量化预期和主要风险。
- 发布验证和上下文压缩完成后，自动批准完成审查并启动下一里程碑。

## 0.7 / 0.70.x: 本地知识资产与只读自动化

让用户构建可复现的本地知识资产，并在没有无人值守写入的前提下自动化只读知识流程。

**用户结果：** 用户能够把社区资料和收藏构建为可复现、可验证、可离线检索的知识资产。

**阶段非目标：** 无人值守写入；强制使用 SQLite 或向量数据库；云端知识库托管

### 能力

| ID | Capability | Status | User value |
|---|---|---|---|
| `M070-CAP-INCREMENTAL` | 增量 collection | `partial` | 大规模资料更新时无需重复完整构建，并能发现重复、遗漏和陈旧数据。 |
| `M070-CAP-OFFLINE` | 可复现离线知识包 | `partial` | 资料可离线检索、导出、验证、导入和恢复。 |
| `M070-CAP-AUTOMATION` | 可重复的只读任务 | `not_started` | 用户可计划摘要和资料任务，同时保持真实写操作需要人工批准。 |
| `M070-CAP-FAVORITES` | 收藏转本地知识资产 | `not_started` | 用户可将收藏主题一键转换为保留来源的本地 collection。 |

### 核心验收

| ID | Status | Metric | Target | Measurement |
|---|---|---|---|---|
| `M070-AC-001` | `pending` | 10,000 文档在记录的参考环境中 5 分钟内完成索引。 | `<= 5 minutes` | recorded 10000-document benchmark |
| `M070-AC-002` | `pending` | 10,000 文档索引查询 P95 不超过 500ms。 | `<= 500 milliseconds` | recorded local benchmark |
| `M070-AC-003` | `pending` | 1% 文档变化的增量索引耗时不超过完整索引的 20%。 | `<= 20 percent` | paired full and incremental benchmark |
| `M070-AC-004` | `pending` | 本地基准 Top-10 期望引用命中率至少 90%。 | `>= 90 percent` | versioned local corpus evaluation |
| `M070-AC-005` | `pending` | 同步后重复和缺失文档为零。 | `= 0 documents` | source manifest and index comparison |
| `M070-AC-006` | `pending` | 相同 canonical 输入生成相同内容 hash。 | `= 0 mismatches` | repeated canonical build comparison |
| `M070-AC-007` | `pending` | export/verify/import/restore 保留全部文档和 provenance。 | `= 100 percent` | round-trip manifest comparison |
| `M070-AC-008` | `pending` | 至少 50 个离线自然语言任务首次成功率不低于 95%。 | `>= 95 percent` | fixed validator report with at least 50 tasks |
| `M070-AC-009` | `pending` | 离线模式网络请求和自动化无人值守写请求均为零。 | `= 0 requests` | network and write-call observation |
| `M070-AC-010` | `pending` | 收藏转 collection 时正文、URL、topicId 和 provenance 保真率为 100%。 | `= 100 percent` | favorite export and collection manifest comparison |

### 活动问题

| ID | Priority | Owner | Status | Title |
|---|---|---|---|---|
| `ISSUE-070-002` | `P1` | `cross_repo` | `open` | Add favorites-to-collection flow |

### 人工交接门禁

- Activation: `waiting`
- Completion review: `not_due`
- 完成后必须总结：增强能力、未预估问题、根因、规避措施、下一阶段目标、量化预期和主要风险。
- 发布验证和上下文压缩完成后，自动批准完成审查并启动下一里程碑。

## 0.8 / 0.80.x: 组织治理与生命周期资格化

让团队在支持的平台上治理策略、凭据、兼容性、审计、支持和生命周期操作。

**用户结果：** 团队能够治理策略、凭据、兼容性、审计和支持平台生命周期，而不引入新的产品主线。

**阶段非目标：** 新增独立用户功能族；强制 native keychain 依赖；远端策略控制平面

### 能力

| ID | Capability | Status | User value |
|---|---|---|---|
| `M080-CAP-POLICY` | 策略与防篡改审计 | `partial` | 团队能统一允许、拒绝、审批并验证内容操作。 |
| `M080-CAP-COMPAT` | 服务端能力协商 | `not_started` | CLI 能识别兼容 API 能力并准确报告缺口。 |
| `M080-CAP-LIFECYCLE` | 凭据与跨平台生命周期 | `partial` | 安装、升级、回滚、卸载和支持诊断在支持的平台上一致可控。 |
| `M080-CAP-ROUTING` | 跨仓库根因路由 | `partial` | ORDS API 缺口先在服务端修复，CLI 不再用不可靠补丁掩盖。 |

### 核心验收

| ID | Status | Metric | Target | Measurement |
|---|---|---|---|---|
| `M080-AC-001` | `pending` | 策略 allow/deny 矩阵判断准确率 100%。 | `= 100 percent` | versioned policy matrix |
| `M080-AC-002` | `pending` | 必需审计事件完整率和篡改检出率均为 100%。 | `= 100 percent` | audit event matrix and tamper injection |
| `M080-AC-003` | `pending` | 当前及前两个受支持 API 契约全部通过兼容测试。 | `= 3 versions` | server and CLI compatibility suite |
| `M080-AC-004` | `pending` | 支持的 macOS、Linux、Windows 环境全部通过安装、升级、回滚和卸载。 | `= 3 platforms` | platform runner lifecycle suites |
| `M080-AC-005` | `pending` | 10,000 个脱敏和 secret fuzz 样本泄露为零。 | `= 0 findings` | 10000-case deterministic fuzz corpus |
| `M080-AC-006` | `pending` | 种子化 CLI/server/cross_repo/test_environment/external 问题归属和路由准确率 100%。 | `= 100 percent` | seeded ownership and routing matrix |
| `M080-AC-007` | `pending` | 7 天只读 soak 成功率至少 99.5%，失败均有可执行诊断。 | `>= 99.5 percent` | seven-day recorded soak |
| `M080-AC-008` | `pending` | 全部受支持 credential store 及不可用 fallback 场景通过且不泄露 token。 | `= 100 percent` | credential backend and fallback matrix |

### 活动问题

无。

### 人工交接门禁

- Activation: `waiting`
- Completion review: `not_due`
- 完成后必须总结：增强能力、未预估问题、根因、规避措施、下一阶段目标、量化预期和主要风险。
- 发布验证和上下文压缩完成后，自动批准完成审查并启动下一里程碑。

## 0.9 / 0.90.x: GA 候选版本

冻结受支持公开面，并证明后续 GA 决策所需的发布、升级、安全、可靠性、恢复和文档成熟度。

**用户结果：** 维护者能够基于冻结证据判断产品是否达到 GA，而不是继续补新功能。

**阶段非目标：** 新增公开命令族；扩大 MCP 写权限；引入未资格化的存储或传输层

### 能力

| ID | Capability | Status | User value |
|---|---|---|---|
| `M090-CAP-FREEZE` | 公开契约冻结 | `not_started` | CLI、JSON、MCP、workflow 和 API 兼容面具有明确稳定承诺。 |
| `M090-CAP-RECOVERY` | 迁移、弃用与恢复 | `not_started` | 用户可从受支持版本升级，并在失败时可靠回滚和恢复。 |
| `M090-CAP-SUPPLY` | 发布供应链证据 | `not_started` | 每个发布资产都能验证 checksum、SBOM 和来源证明。 |
| `M090-CAP-QUALIFICATION` | 独立资格验证 | `not_started` | GA 候选结论由跨角色黑盒、真实客户端、隔离写测试和安全审查共同支撑。 |

### 核心验收

| ID | Status | Metric | Target | Measurement |
|---|---|---|---|---|
| `M090-AC-001` | `pending` | 活动 P0/P1 问题为零。 | `= 0 issues` | all active issues.json entries |
| `M090-AC-002` | `pending` | 至少 200 个跨角色自然语言任务首次成功率不低于 97%。 | `>= 97 percent` | fixed validator report with at least 200 tasks |
| `M090-AC-003` | `pending` | 公开命令 contract 和场景覆盖率 100%。 | `= 100 percent` | registry schema and scenario inventory |
| `M090-AC-004` | `pending` | 所有受支持 roadmap release line 升级至 0.90.x 的路径全部通过。 | `= 100 percent` | versioned upgrade matrix |
| `M090-AC-005` | `pending` | 所有 release assets 的 checksum、SBOM 和 provenance 全部验证通过。 | `= 100 percent` | release asset verification |
| `M090-AC-006` | `pending` | 当前支持版本的三个 MCP 客户端全部重新验证。 | `= 3 clients` | dated real-client compatibility run |
| `M090-AC-007` | `pending` | 隔离写 workflow 测试全部通过且残留资源为零。 | `= 100 percent` | dev@oci isolated write suite and cleanup inventory |
| `M090-AC-008` | `pending` | 30 天资格 soak 达到文档化可靠性目标。 | `= 30 days` | continuous qualification report |
| `M090-AC-009` | `pending` | 独立安全审查无未解决 critical/high 问题。 | `= 0 findings` | independent security review report |
| `M090-AC-010` | `pending` | 文档化恢复和回滚场景全部通过。 | `= 100 percent` | recovery and rollback exercise matrix |
| `M090-AC-011` | `pending` | 0.9 的 blocking readiness unknown 全部在激活前关闭并具备证据。 | `= 0 risks` | readiness risk register |

### 活动问题

无。

### 人工交接门禁

- Activation: `waiting`
- Completion review: `not_due`
- 完成后必须总结：增强能力、未预估问题、根因、规避措施、下一阶段目标、量化预期和主要风险。
- 发布验证和上下文压缩完成后，自动批准完成审查并启动下一里程碑。

## 全局完成门禁

- `GLOBAL-GATE-CORE` (automatic/all): 当前里程碑全部 core acceptance criteria 为 pass
- `GLOBAL-GATE-ISSUES` (automatic/all): 阻塞当前里程碑的活动 P0/P1 issue 为零
- `GLOBAL-GATE-DEPENDENCIES` (automatic/all): 当前里程碑 requiredAt=completion 的 dependency 全部 ready 且证据完整
- `GLOBAL-GATE-CONSISTENCY` (automatic/all): command registry、schema、capability matrix、MCP manifest 和用户文档漂移为零
- `GLOBAL-GATE-LOCAL` (automatic/all): build、test、check:release、check:roadmap 和适用专项门禁通过
- `GLOBAL-GATE-INDEPENDENT` (manual/all): 新建的小白 validator 任务线程按当前里程碑动态场景完成复验且无未解决 blocking finding
- `GLOBAL-GATE-VISUAL-WRITE` (manual/write-back): 全部回写场景具备后端与真实浏览器视觉双证据
- `GLOBAL-GATE-RELEASE` (automatic/all): 最新目标模式迭代已发布并生成受限大小的 context handoff

## 依赖与就绪风险

- 结构化依赖：13 项；未就绪：9 项。
- 就绪风险：12 项；开放：11 项。

## 非目标

- 不自动升级到 `1.0.0`。
- 不开放 MCP execute-write 或远端 HTTP MCP Server。
- 不在自动化测试中执行生产社区写操作。
- 不用 CLI 补丁掩盖 ORDS REST API 能力缺口。
- 不把离线 RAG fixture 指标描述成真实在线答案质量。
