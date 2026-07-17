# 可复用的 CLI 测试反馈闭环

本文定义一套适用于 CLI、服务端 API 和 AI Agent 协同开发的测试反馈机制。复制到其他工程后，只需替换仓库路径、测试项目、Codex 任务、模型、版本路线和验收指标。

## 1. 目标

这套机制解决以下问题：

- 开发会话既实现又验收，容易遗漏真实用户问题。
- 单元测试通过，但自然语言调用、安装、帮助信息和异常反馈仍不可用。
- CLI 为服务端 API 缺口增加临时补丁，形成错误的职责边界。
- 回写只检查数据库，不检查用户在页面上实际看到的内容。
- 已修复问题长期留在活动列表，后续会话无法识别真实剩余工作。
- 长会话提前生成大量实施计划，后续计划与实际代码和问题脱节。
- 版本完成后未发布、未交接，下一轮缺少可信起点。

最终闭环：

```text
roadmap 里程碑
→ 主会话即时规划与实现
→ 本地质量门禁
→ 独立测试项目黑盒验证
→ issues.json 结构化反馈
→ CLI / 服务端责任判定
→ 修复与重新验证
→ 里程碑人工确认
→ patch 发版
→ 紧凑上下文交接
→ 下一轮
```

## 2. 角色与隔离

至少设置三个角色，不能由同一会话同时承担。

| 角色 | 职责 | 禁止事项 |
|---|---|---|
| 主实现会话 | 读取 roadmap 和活动问题，制定当前迭代计划，实现并修复 | 不得自行宣告独立黑盒验收通过 |
| 独立验证会话 | 使用已发布或待验收 CLI，从自然语言和新手视角测试 | 不读取实现细节后替实现找理由 |
| 服务端会话 | 修复服务端 API、权限、分页、过滤、错误契约等缺口 | 不把服务端缺口推回 CLI 做永久兼容补丁 |

推荐配置模板：

```json
{
  "builder": {
    "repository": "<CLI_REPOSITORY>"
  },
  "validator": {
    "project": "<INDEPENDENT_TEST_PROJECT>",
    "threadId": "<VALIDATOR_CODEX_THREAD>",
    "model": "<VALIDATOR_MODEL>",
    "reasoningEffort": "high"
  },
  "server": {
    "repository": "<SERVER_REPOSITORY>",
    "threadId": "<SERVER_CODEX_THREAD>",
    "model": "<SERVER_MODEL>",
    "reasoningEffort": "high"
  }
}
```

每轮委派前必须确认：

1. 目标 Codex 任务 ID 正确。
2. 工作目录正确。
3. 模型和思考强度正确。
4. 被测 commit、tag 或安装包版本明确。
5. 安装包或证据文件 checksum 已记录。
6. 测试环境与生产环境隔离。

## 3. 机器可读真相源

仓库至少维护：

```text
roadmap.json
issues.json
AGENTS.md
docs/roadmap.md
issues.md
```

规则：

- `roadmap.json` 是里程碑、能力、验收指标和测试路由的唯一真相源。
- `issues.json` 只保存仍然活动的问题。
- `docs/roadmap.md` 和 `issues.md` 由 JSON 生成，不手工维护两份状态。
- `AGENTS.md` 固化会话启动、验证、发布和交接协议。
- 使用仓库脚本检查 JSON 结构、文档同步和门禁状态。

## 4. Roadmap 设计

每个里程碑必须与前后阶段有明显差异，不能只更换版本号。

里程碑至少包含：

```json
{
  "id": "0.3",
  "releaseLine": "0.30.x",
  "title": "检索质量阶段",
  "objective": "让用户可以稳定找到并判断社区资料",
  "status": "planned",
  "capabilities": [],
  "acceptanceCriteria": [],
  "validatorScenarios": [],
  "evidence": [],
  "activationGate": {
    "previousMilestoneId": "0.2",
    "status": "waiting"
  },
  "completionReview": {
    "status": "not_due"
  }
}
```

能力项必须说明：

- 用户价值。
- 本阶段范围。
- 明确非目标。
- 对应验收条件。
- 对应独立验证场景。
- 所需证据。

验收条件必须可测量：

```json
{
  "id": "M030-AC-SEARCH-01",
  "gate": "core",
  "description": "自然语言检索场景首次成功率",
  "metric": "first_attempt_success_rate",
  "comparator": "gte",
  "target": 0.9,
  "unit": "ratio",
  "measurementMethod": "独立验证项目运行固定场景集",
  "status": "pending",
  "evidenceIds": []
}
```

禁止使用“基本可用”“体验较好”“问题不多”等不可验收表达。

## 5. 即时规划

主会话每次启动按以下顺序读取：

1. 上一轮紧凑交接文件。
2. `roadmap.json`。
3. `issues.json`。
4. 当前代码、测试、git 状态和发布状态。

只为当前里程碑生成实施计划。不得提前为后续全部里程碑生成详细计划，因为：

- 服务端 API 会变化。
- 黑盒测试会发现未预估问题。
- 当前实现会改变后续最优方案。
- 提前计划容易把假设固化为错误任务。

同一时间最多一个里程碑处于 `in_progress`。

## 6. 黑盒测试标准

独立验证必须使用真实自然语言驱动 CLI，而不只是调用内部函数。

至少覆盖：

- 新手安装和首次运行。
- `--help`、缺参数、错误参数和命令发现。
- 自然语言搜索、查看、问答和连续追问。
- 空结果、分页、过滤、权限不足、限流和服务端异常。
- JSON 输出、stderr、exit code 和 request ID。
- preview、dry-run、审批和破坏性命令确认。
- 网络超时和重试提示。
- 跨平台安装脚本。
- 文档示例是否能直接运行。

每个场景记录：

```json
{
  "scenarioId": "NOVICE-SEARCH-001",
  "intent": "查找最近的 ORDS 认证问题",
  "naturalLanguageInput": "帮我找最近关于 ORDS 401 的帖子",
  "firstAttempt": {
    "passed": false,
    "command": "...",
    "exitCode": 2,
    "stdoutSummary": "...",
    "stderrSummary": "..."
  },
  "finalAttempt": {
    "passed": true
  },
  "evidence": []
}
```

首次失败必须保留。后续重试成功不能覆盖第一次失败，否则会隐藏发现性、帮助信息和默认行为问题。

## 7. 回写场景的双层验收

发帖、回帖、编辑、删除、收藏、订阅等回写场景，必须同时具有两层证据：

### 7.1 后端证据

- API 返回和 request ID。
- 数据库或只读 API 查询确认。
- 状态、作者、时间和对象 ID。
- preview 与执行请求 hash 一致。

### 7.2 用户页面视觉证据

必须在 Codex 侧边栏真实浏览器中打开最终页面，并启用视觉识别，从终端用户角度检查：

- 标题是否正确。
- 正文是否完整。
- Markdown、代码块、链接、图片、换行和特殊字符是否正确渲染。
- 作者、时间、分类、标签和状态是否正确。
- 内容是否真实可见，而非只写入数据库。
- 页面是否出现截断、乱码、转义错误、重复内容或权限提示。
- 编辑或删除后的页面状态是否符合预期。
- 保存页面截图作为证据。

数据库写入成功不能替代页面验收。视觉验收失败时，即使 API 返回成功，该场景仍判定失败。

### 7.3 测试账号

- 复用已有专用测试账号，不得每轮重新创建。
- 账号使用最小权限。
- 只有账号失效或权限不足时才维护或替换。
- 凭据不得写入仓库、日志、截图、fixture、issue 或交接文件。
- 测试内容应使用明确前缀和可追踪 ID，便于清理。
- 生产社区默认禁止自动写入。

## 8. 问题分类与跨仓库路由

收到 `issues.json` 后，先判断责任边界。

| 类型 | 处理位置 | 示例 |
|---|---|---|
| CLI | CLI 仓库 | 参数解析、错误文案、JSON 契约、安装、缓存 |
| Server | 服务端仓库 | 缺少过滤接口、分页错误、权限模型、错误状态码 |
| Cross-repo | 先服务端后 CLI | 新 API 契约加 CLI 命令和文档 |
| Test environment | 测试项目或环境 | 账号失效、DNS、证书、浏览器会话 |
| External | 记录并隔离 | GitHub、npm 或第三方服务异常 |

路由原则：

1. 不能由 CLI 独立正确解决的能力，先发送到固定服务端会话。
2. 服务端提供契约、测试和发布证据后，CLI 再适配。
3. 不允许客户端抓取全部数据后本地过滤来伪装服务端能力。
4. 不允许吞掉服务端错误并返回看似成功的结果。
5. 跨仓库问题必须记录双方 commit、接口版本和验证证据。

## 9. issues.json 生命周期

活动问题建议结构：

```json
{
  "id": "CLI-020-007",
  "milestoneId": "0.2",
  "priority": "P1",
  "owner": "cli",
  "status": "open",
  "title": "安装失败时缺少可执行建议",
  "description": "...",
  "acceptanceCriterionIds": ["M020-AC-INSTALL-01"],
  "blockingMilestones": ["0.2"]
}
```

状态只允许：

```text
open
in_progress
blocked
```

问题修复并通过独立复验后，立即从活动 `issues.json` 删除。关闭记录、首次失败、修复 commit 和复验结果进入独立验证历史，不在活动列表中长期保留。

## 10. 修复闭环

每个问题执行：

```text
复现
→ 定位根因
→ 判断 CLI / Server / Cross-repo
→ 增加失败测试
→ 最小修复
→ 局部测试
→ 全量质量门禁
→ 独立自然语言复验
→ 回写场景页面视觉复核
→ 删除活动 issue
```

不能通过以下方式“修复”：

- 删除失败测试。
- 把错误改成 warning。
- 只更新文档而不修代码。
- 在 CLI 内硬编码服务端返回。
- 只验证第二次重试成功。
- 只检查数据库写入。

## 11. 里程碑完成门禁

里程碑完成必须满足：

1. 所有核心验收条件达到目标值。
2. 所有能力状态为 `validated`。
3. 独立验证证据存在。
4. 阻塞该里程碑的 P0/P1 问题为零。
5. 回写场景具备后端与浏览器双层证据。
6. build、test、release check 和专项质量门禁通过。
7. 文档与实际命令一致。

完成后主会话必须停止，并用简洁语言输出：

- 本版本增强了哪些能力。
- 出现了哪些前期未预估问题。
- 根因是什么。
- 后续如何避免。
- 下一版本的目标。
- 预期量化结果。
- 主要风险。

用户手工确认后，才能把下一里程碑改为 `in_progress`。

## 12. 每次目标模式的小版本收尾

每完成一次目标模式的小版本迭代：

1. bump patch 版本。
2. 执行全部本地质量门禁。
3. 提交全部本轮变更。
4. 发布提交信息以 `[skip ci]` 结尾。
5. 推送主分支。
6. 创建并推送版本 tag。
7. 直接使用 `gh release create` 发布 GitHub Release。
8. 不运行 `gh workflow run`，不依赖 GitHub Actions 完成本次发布。
9. 验证 release、tag、资产和 checksum。
10. 生成紧凑上下文交接文件。

建议发布资产：

```text
package.tgz
install.sh
install.ps1
checksums.txt
package.tgz.sha256
install.sh.sha256
install.ps1.sha256
```

## 13. 强制上下文压缩与交接

如果运行平台没有直接清空或压缩当前上下文的 API，使用受大小限制的持久交接文件作为强制边界。

建议输出：

```text
reports/iteration-context.json
```

必须包含：

- 已发布版本、tag、release URL 和 commit。
- 当前里程碑。
- 增强能力。
- 意外问题。
- 根因。
- 规避措施。
- 下一阶段目标和预期结果。
- 主要风险。
- 活动问题摘要。
- 下一会话读取顺序。

要求：

- 不超过固定大小，例如 12 KiB。
- 自动脱敏。
- 仅在 tag、release、资产和远端同步验证通过后生成。
- 生成后结束当前目标。
- 下一主会话首先读取该文件，再读取 roadmap 和 issues。

## 14. API Key 与安全

测试环境可创建专用 API key 时：

- 仅在指定开发环境创建。
- 使用最小权限。
- 不用于生产写操作。
- 不写入仓库、命令历史、日志、截图或证据。
- 测试结束后按策略轮换或撤销。
- 报告只记录 `present/absent`，不记录 token 内容。

所有输出统一脱敏：

```text
Authorization
Bearer
API key
token
password
passwd
secret
Cookie
Set-Cookie
```

## 15. 自动化质量门禁

建议脚本：

```json
{
  "scripts": {
    "build": "...",
    "test": "...",
    "check:roadmap": "node scripts/check-roadmap.mjs",
    "roadmap:render": "node scripts/check-roadmap.mjs --write-docs",
    "check:release": "... && npm run check:roadmap",
    "context:compact": "node scripts/compact-iteration-context.mjs"
  }
}
```

检查器至少验证：

- 同时最多一个活动里程碑。
- 下一里程碑必须有人工确认。
- 验收条件具有 metric、comparator、target 和 measurement method。
- `issues.json` 只包含活动问题。
- Server/Cross-repo 问题绑定固定服务端会话。
- 独立验证模型、任务和目录没有漂移。
- 回写场景要求真实浏览器视觉验收。
- 测试账号必须复用。
- 每次目标模式要求 patch 发版。
- 发布路径跳过 GitHub Actions。
- 上下文交接字段和大小限制有效。
- 生成的 Markdown 与 JSON 同步。

## 16. 迁移到其他工程

复制后替换：

```text
<CLI_REPOSITORY>
<SERVER_REPOSITORY>
<INDEPENDENT_TEST_PROJECT>
<VALIDATOR_CODEX_THREAD>
<SERVER_CODEX_THREAD>
<VALIDATOR_MODEL>
<SERVER_MODEL>
<RELEASE_ASSETS>
<VERSION_POLICY>
<MILESTONES>
<ACCEPTANCE_METRICS>
```

保留不变的核心原则：

- 实现与独立验收分离。
- 真实自然语言测试。
- 首次失败证据保留。
- 服务端缺口回到服务端修复。
- 回写必须做浏览器视觉验收。
- 活动问题及时删除。
- 只即时规划当前里程碑。
- 里程碑之间人工确认。
- 每轮发布并生成紧凑交接。
