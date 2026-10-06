# apexcn-cli 优化分析与后续交接

分析日期：2026-10-06，时间以 UTC 记录。

基线：`main`，`d545fe11a1a6408b28344e781304560eaca518d2`，产品版本 `1.2.1`。

## 结论与建议顺序

当前产品已具备清晰的自然语言社区助手路径、丰富的公开命令与 JSON 合同、来源保留、操作预览和同请求重试机制。下一阶段最值得投入的是让这些已有承诺在异常情况下仍然成立，而不是继续增加命令数量。

本次在最新源码上用隔离 fixture 复证了三类 P1 风险：发送写请求之后的状态分类、操作结果与日志脱敏、修改目标地址时沿用旧凭据。还确认了 CI 合同测试漂移、生成式入门指南与当前安全路径不一致，以及引用评分器漏检。建议先修复 P1 与恢复可信的 CI 门禁，再收敛文档和新手路径，最后补充真实跨平台、自然语言端到端资格。

本文件是分析和改进交接，不是修复完成、正式验收通过或新产品版本发布的声明。本轮只新增本文件，没有修改产品代码、配置、测试、历史交接或版本号；没有执行生产写入、数据库操作、安装升级、发布或推送。

## 1 目标来源与产品边界

### 已有产品目标

- `README.md:5-34` 定义的主路径是：用户描述目标，AI 使用 Skill，CLI 访问 APEX 中文社区，AI 给出带来源的解释。
- `roadmap.json:3497-3554` 的主要任务是社区知识发现和引用、个人社区资产、安全内容变更、Agent 集成和管理员观测。它还明确服务器能力归 `apexcn-forums`，不能用客户端补丁掩盖服务端合同缺口。
- `AGENTS.md:9-28` 要求保持 CLI/server 边界、真实运行证据、独立验证、API 与真实 Chrome 写回证据，并禁止数据库或管理员旁路。
- `src/core/workflow-plan.ts:1-12` 的 goal 是研究、提问、发帖、回复、编辑和删除等社区内容流程。`src/commands/guide.ts:146-172` 的 deployment 是检查清单，执行和回滚步骤没有代办命令。

因此，本仓库的优化目标应是：让不了解 CLI 参数的用户也能可靠地检索、理解、引用、管理和经确认参与社区；让团队能够审计、恢复并复验这些流程。APEX 应用初始化、页面设计、开发、测试、部署执行器不属于本次已确认范围，不能因为项目名相近就把其他项目的目标移植到这里。

### 本轮授权范围

在助手云主机上对最新代码进行进一步分析，先形成项目根 `handoff.md`。允许源码、文档、已有 CI 证据的只读检视，以及无外部副作用的隔离复证。产品修复、版本变更与发布应作为后续明确范围执行；持久化这份交接不等于其列出的改进已经实施。

### 保留的历史交接

本次开始时根目录没有 `handoff.md`。以下文件保持原样，本文件补充当前基线的证据，不覆盖其历史结论：

- [Air 审查](docs/handoff/2026-10-06-air-review.md)
- [云端续接说明](docs/handoff/2026-10-06-cloud-continuation.md)
- [Pro 历史审查及合并记录](docs/handoffs/m5-pro-20261006.md)

历史报告中的机器路径、当时 dirty 状态、旧候选和当时测试结果只适用于各自时间点。当前 `AGENTS.md` 已无历史 Pro 审查提到的 `RTK.md` 引用，不能继续把该引用缺失当作当前缺陷。原始问题语言隔离、响应体读取超时等已有实现和测试，也不应重复列为“尚未实现”。

## 2 当前证据与验证边界

### 2.1 源码与环境

- 完整 Git 工作区：`/workspace/shared/github/checkouts/20261006T061830Z/wfg2513148/apexcn-cli`。
- 分析起点 `git status --porcelain` 为空。恢复过程已核对 HEAD、tree 与完整性；本轮另外保存全部 tracked 文件 SHA-256，交付前再比较。
- 云环境为 Linux，Node `v24.19.0`。没有 `node_modules`，本轮没有安装依赖，未运行完整 Vitest、TypeScript build 或包生命周期测试。
- 安全复证使用 Node 内建 TypeScript stripping 直接加载当前源函数；fetch 全部 stub，配置与操作日志只写 `/tmp`。Commander 只作导入/回调适配，不代表真实 Commander 解析器或已发布安装包验收。
- 所有凭据样本均为 `fixture-*` 虚构字符串，目标为 `.invalid`/示例域名，未进行网络连接。临时脚本、日志和哈希清单在 `/tmp/apexcn-cli-audit-20261006-QxpVD8`；本文件已记录关键步骤和输出，后续不能仅依赖此临时目录。

### 2.2 已有 CI 结果

本轮读取了[对应基线的 CI run 37421648453](https://github.com/wfg2513148/apexcn-cli/actions/runs/37421648453)，确认其 `head_sha` 就是本文件基线，并读取三个 job 的实际日志。

| 检查 | 结果 | 应如何理解 |
| --- | --- | --- |
| Linux 构建 | 通过 | 该 CI 环境的 build 通过 |
| Linux 单元/合同测试 | 852 passed，4 failed，6 skipped；57 文件中 3 failed | 3 个 README 合同断言和 1 个验证目录 fixture 问题，详见 F04 |
| Windows PowerShell 5.1 | 20 passed，1 failed，17 skipped | 失败是同一个 README 安装认证分离断言，不是 17 个未测项已经通过 |
| Windows PowerShell 7 | 20 passed，1 failed，17 skipped | 同上 |
| Linux `check:release`、后续 `eval:rag` | skipped | 被前面的失败阻断，不能用构建通过替代 |
| Windows 已发布包安装/更新检查 | skipped | 此步骤仅 `workflow_dispatch` 才运行，普通 push CI 不等于 Release 安装验收 |

工作流依据为 `.github/workflows/ci.yml:20-84`。Linux job 为 `112132103206`，PowerShell 7 为 `112132103366`，PowerShell 5.1 为 `112132103428`；本轮重新读取原始日志核对以上计数和失败断言。没有重跑、取消或修改这些 CI 作业。

### 2.3 本地实际运行

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| `node scripts/check-roadmap.mjs` | exit 0，9 milestones，0 active issues | 结构一致，不证明历史风险已关闭 |
| `node scripts/check-workflows.mjs` | exit 0 | 工作流静态合同 |
| `node scripts/check-source-layout.mjs` | exit 0 | tracked 源码布局 |
| `node scripts/check-roadmap.mjs --validator-readiness` | exit 1，目录缺失或不可访问 | 本云环境不存在已记录的 Mac 路径；不能据此断言用户所有电脑均不可用 |
| `node scripts/eval-rag.mjs --strict` | exit 0，30 问/30 引用 fixture | 明确是 offline-fixture，不测真实答案正确性、线上检索质量或 unsupported claim rate |
| 本地合同/评分器/指南复证 | 完成，见 F04-F07 | 使用原函数或指南纯函数源码，不是全 CLI 测试 |
| 写操作/脱敏/凭据隔离复证 | 完成，见 F01-F03/F08 | stub fetch、临时配置、一次受控 EIO 注入，无服务器副作用 |

没有运行生产 API、在线 RAG、真实 Chrome、Windows/macOS、本机安装器、数据库、完整 GA harness 或正式独立新手验收。不能将本文件或这些定向复证计入项目要求的独立验证轮次。

## 3 已有能力应保留

1. **检索与回答职责清晰。** Skill 默认 `rag retrieve` 供本地 AI 综合，只有明确请求时调用服务端 `ask`；检索证据保留 title、communityUrl、originalUrl、requestId 与 evidenceId。依据 `agent-skill/SKILL.md:67-75`、`src/commands/content.ts:1552-1593`。
2. **预览绑定具体内容和身份。** 写操作绑定 config scope、profile、base URL、credential fingerprint、完整请求、哈希、有效期和 operationKey。篡改、换账户、重复完成操作已有测试。依据 `src/core/write-operation.ts:86-150`、`test/write-operation.test.ts:327-394`。
3. **本地任务不强求登录。** 草拟、审查、指南、schema 等本地流程与远端访问分开；意图目录检查 preflight、命令存在性和写操作确认。依据 `test/agent-skill-intent-routes.test.ts:58-118`。
4. **语言选择在原问题阶段完成。** `src/core/content-language.ts:22-41` 与 `src/index.ts:130-143` 维护当前请求上下文；读取与分页不应改写签名 URL。Han 且无日/韩字符的规则是公开启发式，不能把其语言学边界误报为已证明的算法违约。
5. **供应链已有校验与恢复设计。** 安装/升级、校验资产、SBOM、provenance 与回滚已有实现和测试。`docs/ga-support-policy.md` 明确 provenance 不是第三方签名；不要夸大，也不要为追求“简单”移除 fail-closed 校验。

## 4 逐项发现与验收建议

等级说明：P1 表示可能影响凭据保密或安全恢复，建议阻断相关产品修复版本的发布；P2 表示显著影响可用性、合同或证据可靠性。下面明确区分“已证实实现问题”“验证缺口”和“建议”。这些是本轮分析发现，不自动改写受独立 validator 来源规则约束的 `issues.json`。

### F01 P1 已证实 发送后的不确定状态被当成确定失败

**证据**：`src/http.ts:134-145` 将 HTTP 2xx 的非 JSON 响应表示为 `HttpError(status=2xx)`；`src/core/write-operation.ts:152-191` 将非网络/超时/5xx 的异常设为 `failed`，而 `133-134` 随后禁止旧 operationId 再次确认并要求新预览。`162-165` 的本地 completed 日志写入与远端请求又在同一 try/catch 中。

**隔离复证**：

- 预览一条虚构回复，stub 服务端返回 `200` 加非 JSON 正文。第一次 confirm 抛 `HttpError(200)`，日志变 `failed`；同 ID 再 confirm 报 `create a new preview`；新预览的 operationKey 与旧值不同。
- stub 返回成功 JSON 后，仅对 completed 日志落盘注入一次 `EIO`。远端成功结果仍在对象中，但 catch 保存 `status=failed`，再次确认仍要求新预览。

**影响与根因**：已经发出请求、甚至收到成功的远端结果，不等于可确定“没有写入”。此时引导新建 operationKey 会削弱安全重试约定，可能产生重复内容。这里证实的是错误状态和新 key；没有声称真实社区已经重复写入。

**改进**：区分发送前拒绝、远端明确业务拒绝、结果未知、远端已确认但本地记录未持久化。2xx 解码/协议异常及发送后的本地持久化错误应保留原请求身份，提供查询或同 key 恢复路径。不要仅把所有异常改成无限重试；403/版本冲突/目标变更仍需准确分流。

**验收**：200 坏 JSON、正文中断、成功后 EIO/ENOSPC、进程中断、500、429 各有组合测试；结果不确定时不得建议换 key，不得默认为没写入。用受控服务端验证重复同 key 只产生一次业务效果，并保留首次失败与恢复证据。`test/http.test.ts:167-186` 只验证错误类型，`test/write-operation.test.ts:374-394` 只验证 500 重试，不能替代两层组合测试。

### F02 P1 已证实 操作结果与本地日志未履行统一脱敏承诺

**证据**：`docs/security-model.md:45-55` 宣称 stdout、stderr、诊断快照和本地操作记录覆盖 token/password/Cookie 等。`src/core/write-operation.ts:162-173,305-311` 却直接保存并返回结果，错误使用 `393-395` 的局部正则；`src/commands/content.ts:125-130` 调用 `printData`，`src/output.ts:58-65` 直接序列化。`src/core/secret-redaction.ts:1-38` 已有更全面的公共脱敏函数。

**隔离复证**：

- 500 错误文字 `password=fixture-password token=fixture-short-token Cookie: sid=fixture-cookie` 原样留在 journal.error.message；公共 redactor 能处理相同样本。
- 成功 JSON 中虚构 `token`、`password`、`headers.Set-Cookie` 原样留在 journal.result 和 confirm 返回值。实际 `printData` 接收该结果后同样输出原值。此项验证了真实输出函数和源代码接线，没有运行完整 Commander parser。

**影响与根因**：服务端或代理若回显敏感字段，原始值可能进入用户终端、Agent 上下文、诊断收集或共享日志。当前 `0600` 权限不等于内容已经脱敏；这不是已发生真实凭据泄漏的声明。

**改进**：为可展示响应、错误、审计字段建立统一且可测试的脱敏/允许字段边界。必须同时处理成功和失败路径，并对实际活动 token 做精确遮蔽。不要盲目清洗整个已审批请求后仍沿用旧 hash：重放所需的原请求和可分享审计视图是不同职责。可能含敏感内容的请求正文需要提交前检测、明确存储说明与最小保留策略；不得改变用户确认的普通帖子或示例代码语义。

**验收**：命令集成测试同时扫描 stdout、stderr、operation journal、导出诊断和错误恢复产物；覆盖嵌套字段、大小写、短值、连字符、Cookie、URL userinfo 和活动 token。安全样本无明文残留，普通社区代码/引用仍保持语义。

### F03 P1 已证实 改目标地址时可能隐式沿用旧文件凭据

**证据**：`src/commands/auth.ts:94-110` 在只提供 `--token-env` 时按同名 profile 继承旧 token，并写入新 baseUrl；`src/core/credential-store.ts:99-104` 在环境变量不可用时回退到文件；`src/core/runtime-session.ts:25-37` 将选中的 token 与当前 baseUrl 配对。Skill `55-65` 只在用户有意要求文件 fallback 时推荐双源配置。

**隔离复证**：临时 profile 原来指向旧 `.invalid` 目标并存虚构 file token；调用真实 set-token action，给出同 profile、新 baseUrl 和不存在的 env 名称。随后 `loadRuntimeSession` 返回 `ok=true`、新 baseUrl、旧 token、`credentialStore=file`。未调用远端请求，没有传出任何真实凭据。

**影响与根因**：从环境变量认证迁移、切换 DEV/PROD 或修改社区目标时，用户可能以为旧凭据不再使用，实际上仍成为 fallback；错误目标可能收到旧凭据。根因是凭据保留策略仅按 profile 名匹配，没有绑定目标地址和用户此次意图。

**改进**：明确 env-only 与有意 env+file fallback 的行为；目标地址变化时禁止静默保留不匹配凭据，要求明确迁移或清除旧 fallback。相同目标既有 fallback 的兼容策略需记录，不能悄悄破坏已有合理双源配置。

**验收**：同目标 env-only、同目标显式 fallback、改 scheme/host/port/path、缺 env、无效 env、`--no-switch` 分别验证配置和 runtime 选择；新目标不能意外使用旧 token，失败应发生在网络请求前。审计输出只报告凭据来源和有效性，不输出值。

### F04 P2 已证实 CI 失败来自合同漂移和非隔离测试环境

**证据**：`test/docs-consistency.test.ts:84-98` 要求英文 README 出现中文标题和特定 API-key 截图；`108-118` 要求中文旧示例警告；`test/install-agent.test.ts:421-432` 要求中文安装说明。当前 README 已提供英文说明并取消那些固定内容编号。`test/roadmap.test.ts:357-371` 只把 validator 改为临时目录，没有迁移 builder；`scripts/check-roadmap.mjs:637-650` 对双方路径做 realpath。

**本地复证**：保留 committed Mac builder 路径时，临时 validator 返回 `Independent validator or builder directory is missing or inaccessible`；改用确实存在的本云工作区作为 builder 后，原 readiness 函数返回 `[]`。

**应该改哪里**：

1. 将文档测试改为双语语义/链接/资产合同：英文 README 和中文 README 分别满足各自语言的引导、认证分离、安装 fail-closed、引用和安全说明。不要为了过断言把中文旧段落塞回英文首页。
2. API-key 截图是否必须保留，应按帮助用户找入口的实际需求决定；当前文档已写出双语菜单和认证指南链接。若采用截图，应测试真正链接的有效图片；不能把特定图片存在本身当新手成功。
3. 没有固定示例 ID 的首页不必无条件包含旧编号警告；带固定 ID 的手册/Skill 必须明确其仅为语法示例。
4. 单元测试创建彼此独立的临时 builder 与 validator，覆盖正例、重叠、符号链接、目录缺失和不可访问。不要删掉生产 readiness 的目录/独立性检查，更不能创建空 Mac 路径伪造验证环境。

**验收**：完整 CI 测试通过且 `check:release` 实际执行；README 两种语言和生成指南纳入同套语义检查；在 Linux、Windows、新路径及无开发者家目录的环境中结果一致。

### F05 P2 已证实 入门指南输出与当前安全路径不一致

**证据与复证**：直接加载 `buildGuide` 的当前纯函数实现，`guide learning` 仍输出 `curl ... | bash`、`auth set-token --profile learning --token "$APEXCN_API_KEY"` 和默认 `ask`。位置为 `src/commands/guide.ts:90-107`。这与 README 的 fail-closed 下载和不将 key 放参数（`README.md:40-52,126-129,138-148`）、Skill 默认 `--token-env`/`rag retrieve`（`agent-skill/SKILL.md:55-73`）不一致。

`guide compatibility` 的版本参数仅 trim，shellQuote 只处理反斜杠和引号（`guide.ts:219-233`）。虚构输入 `$(printf benign)` 被原样放入双引号命令；本轮只生成字符串，绝未执行该命令。复制到 POSIX shell 时该语法会被展开，因此“可执行指南”不应把任意上下文直接拼为 shell 字符串。

**影响与根因**：新手可能沿另一条入口落回较弱认证路径、误调用服务端回答、在 Windows 得到不适用的 shell 命令，或者误解指南本身已经替其验证了部署/兼容性。现有 `test/guide.test.ts:10-87` 主要测 schema、字符串和离线性，未检查所有示例的安全语义和目标 shell。

**改进**：让 README、Skill、guide 和命令 manifest 共享最小的安装/认证/检索路径；生成结构化命令 argv，或显式区分目标 shell 并严格引用。版本输入应按明确格式验证。兼容性清单不要指向不存在的 `package.engines`（当前 package.json 无该字段），应引用实际运行时政策。

**验收**：指南默认不用明文 token 参数、不默认 ask、不将下载失败当安装成功；Linux/macOS、PowerShell 5.1/7 的命令可用；空格、引号、美元符、反引号和恶意样本只能成为字面值或被拒绝。学习指南中的“collection verify 通过”应有相应验证步骤，而不是仅列检查文本。实际 Skill 加载应单独确认，文件存在不等于 AI 已使用它。

### F06 P2 已证实 文章缺版说明在多个入口仍然矛盾

**证据**：`README.md:104`、`README.zh-CN.md:275`、`agent-skill/SKILL.md:193`、`src/commands/guide.ts:75` 仍说缺译可能回原文；`docs/cli-manual.en.md:643` 和中文版 `645` 则要求列表分页前排除缺版、详情返回请求语言不可用。此项历史 Pro 审查已经提出，本次对最新源码复证为仍存在，而不是新增重复计数。

**影响**：英文用户空结果或详情不可用时，AI 可能错误承诺原文兜底；翻页数量、来源和展示语言的预期也会不一致。

**改进**：以 `apexcn-forums` 当前权威合同与同候选运行证据核对后，统一 CURRENT、STALE、缺版文章、普通原稿、回复五类语义。不要仅为迎合 README 更改服务器，不能在 CLI 加入私自抓取/翻译 fallback。

**验收**：中英文 README、手册、Skill、guide、schema/fixture 对五类均一致；列表、search、detail、personal search、collection sync 和跨语言 cursor 的实测结果与相同服务端版本相符。普通原稿/回复保留原语言与“缺版文章不兜底”需要明确区分。本轮确认了文档互相冲突，没有在线复验服务器。

### F07 P2 已证实 引用评分器可以放过不完整或错配来源

**证据**：`scripts/agent-rag-eval-score.mjs:20-43` 对 sources 使用 `every`，不要求与 evidence 数量/ID 集合一一对应；同 ID 只比较 title 和 URL 语法，没有比较 source.communityUrl 与对应 evidence.communityUrl 的值。

**隔离复证**：对含一条完整 S1 evidence 的成功结果，分别设置 `sources=[]`、以及同 ID/同标题但不同 URL 的 source，原评分器均给出 `citationIntegrity=true`。这证明评分门禁漏检，不证明正常 CLI 已经返回错误 URL。

**改进与验收**：每条证据恰有对应来源，evidenceId、topic/reply 身份、完整 URL 和可选 originalUrl 精确匹配；缺项、多项、重复 ID、换 URL、签名参数变化均失败；真正无证据的 unanswerable 允许按显式规则返回空来源。增加故意破坏输出的负向评分测试，而不只给 scorer 喂“理想答案”。保留返回的 URL 原样，不通过重建 URL 修复评分。

### F08 P1 验证缺口 安全恢复还需要跨进程与有效期证据

`src/core/write-operation.ts:127-150,305-311` 没有在“读状态—确认—发请求—写状态”间建立跨进程锁，写 JSON 也不是原子替换。本轮并发同 ID confirm 的隔离结果是两次请求、两次 fulfilled；它们是否产生重复业务写入取决于服务端幂等语义，本轮没有证明远端重复。

操作有效期为两小时（`write-operation.ts:99`）；本轮模拟 `execution-uncertain` 后跨过有效期，仍得到 `has expired; create a new preview`。是否应允许新的人工恢复流程，需要同时明确服务端幂等保留期和结果查询能力，不能简单延长审批有效期。

**建议**：对本地状态文件做原子持久化与合理互斥；将“尚未发送的审批过期”和“已发送但结果未知的恢复”分开。测试并发进程、重复 CLI 调用、断电/部分写、文件系统 EIO、跨有效期和不同账户恢复；所有路径保留原身份和首证，不能因恢复而绕过新的身份/目标/内容确认。

### F09 P1 资格缺口 单元测试和历史小范围验收不足以证明企业可靠

**现状证据**：`.github/workflows/ci.yml:20-84` 的常规 Linux 与 Windows任务并不覆盖完整 Mac/Node最低版本/全部 Windows CLI 行为；README 承诺 Node 20+ 及三平台。`roadmap.json:4041-4051` 仍明确 timeboxed qualification：完整 Q001-Q200、18 个 macOS/Linux 和18个 Windows 生命周期单元、DEV API/真实 Chrome 写回、清理和独立安全审查未获完整资格证据。

`scripts/eval-rag.mjs:22-37` 的所谓 citationCoverage/referenceHitRate 实际为 fixture 字段覆盖；即使值为 1，也没有运行模型。在线 Agent-RAG 数据集当前为28题，主要中文，runner 和 scorer 没有评价 AI 最终自然语言答案的实际引用、过度断言或真实首轮任务成功率。`eval/agent-rag/README.md` 明确要求隔离配置，不能在本轮无授权情况下借“测质量”访问生产。

**改进**：保留现有快速单元/合同层，另建与实际任务一致的黑盒资格层。用冻结候选、明确输入、不可覆盖的首轮结果、平台/Node/shell矩阵，分别报告单元通过、线上只读质量、最终回答质量、经授权 DEV 写回和清理。历史77适用基线+20语言场景不能说成202项全通过；历史 timebox 也不是当前修复版本的豁免。

**验收**：每个“通过”可追至 exact commit、包 SHA、CLI/server contract、环境、任务 ID、输入、原始输出摘要、首试/重试、排除理由和清理；缺证用 unknown/blocked。先真实恢复/选择独立 harness，再核验 baseline/scorer，不以空目录充当恢复，不以本轮分析任务当独立验收者。

## 5 面向实际用户的验收流程

下面是下一轮建议的任务级验收，并非本轮已执行。所有涉及远端写入的项目均应使用明确授权的专用 DEV 身份和隔离数据，满足项目要求的 API 加真实 Chrome 证据。

| 用户任务 | 最小成功条件 | 必测失败/中断路径 |
| --- | --- | --- |
| 安装后直接说“帮我查 ORDS 401” | 正确版本、AI确实读到Skill、凭据不进入聊天/参数，真实检索带标题与完整来源 | 无Node、下载中断、错误校验、Skill未加载、auth缺失 |
| 英文提问并连续追问 | 每次内容读取沿用用户本轮语言，追问保留主题/版本，引用与打开页面一致 | 短追问无上下文、技术词纯英文、显式lang、混合语言、跨语言cursor |
| 检索到部分资料 | 能区分“找到证据”“答案适用本环境”“官方支持”，不足时说明限制 | 缺版、STALE、空结果、detail部分失败、429、慢响应、无正确答案 |
| 在我的收藏里查资料 | 使用me search且保留topic/reply身份，缺能力如实报错 | 不得偷偷改全站搜索、回复ID不得当topicID |
| 草拟并发表回复 | 本地草稿/审查不发布，预览展示正确目标/身份/正文，确认后仅执行该请求 | 用户改正文、换账户、409、403、坏JSON、结果未知、审批过期、同ID重复确认 |
| 导出诊断供同事排查 | 有requestId和稳定错误码，足够定位，无真实秘密 | 成功和错误响应回显token/Cookie、嵌套字段、日志包含旧凭据 |
| 构建离线资料集 | verify之后才能依赖，索引/查询保留来源和语言 | 断网、损坏/过期文件、symlink、回复收藏被排除的说明 |
| 升级后继续使用 | 配置与Skill保留，版本一致，可回滚，卸载只清本轮安装 | checksum失败、权限拒绝、自定义路径、路径空格、PowerShell两版本、恢复失败 |

建议同时记录：首轮成功率、人工澄清次数、错误恢复成功率、证据引用完整性、秘密残留数、非授权写入数和端到端耗时。先建立同候选实测基线，再决定性能目标；不要从单次运行猜测 p95，也不要用增加并发降低安全性。

## 6 分阶段改进计划

### 阶段 A 冻结范围与恢复可信门禁

1. 以本文件基线建立修复分支，重新采集 HEAD/dirty，保留历史交接和已有首证。
2. 修正 F04 测试 fixture 与双语合同，保持安全语义，不删断言逃避问题。
3. 将 F01-F03 的本轮最小复证转成正式失败回归测试；锁定修复前失败结果。

退出条件：测试能在不依赖维护者 Mac 家目录的环境复现；现有 CI 失败得到解释并修好；新增安全回归在修复前确实失败。仅此阶段通过仍不能宣称产品风险已修复。

### 阶段 B 修复安全与恢复基础

1. 先处理 F03 凭据目标绑定，再处理 F02 可分享输出/审计脱敏。
2. 修复 F01 的发送阶段分类和远端成功/本地失败恢复，保留同 operationKey。
3. 针对 F08 明确客户端锁、原子日志与服务端幂等/有效期的共同合同；不要把服务端未证实保证写进 CLI 文档。

退出条件：安全负向集全部通过；正常写前审批和身份绑定不退化；在受控 DEV 场景证实单业务效果与可恢复性；秘密扫描包含实际输出和所有本地产物。没有这些证据不宣称安全发布就绪。

### 阶段 C 收敛一个可靠的新手路径

统一 README/中文README/Skill/guide/manifest 的安装、env-only、默认 RAG、明确 ask、五类语言内容语义和错误引导。修复 F05/F06，避免让用户记内部状态文件和参数。guide 不承担未经授权的部署执行。

退出条件：同一用户目标从不同入口得到相同安全动作；只向用户询问真正缺失的版本、范围或必要确认；全流程在新手黑盒任务可完成，并包含失败恢复，而不只是示例字符串存在。

### 阶段 D 强化评估与正式资格

先修 F07 scorer，再冻结任务、阈值、required/excluded 范围和候选。平台至少覆盖当前明确支持的 Node/runtime 与 shell，新增范围应按用户决定记录。真实写回只在授权 DEV，包含浏览器检查和清理。补足语言、短追问、提示注入/不可信社区内容、权限拒绝与正确拒答的自然语言任务。

退出条件：各层结果分别报告；独立 validator 对同候选给结论；高风险发现关闭；所有 required 有首证和清理证据。若范围只能 timebox，明确未测/排除项，不把“有harness”当“跑过harness”。

### 阶段 E 发布与可恢复交接

执行时遵守 `AGENTS.md` 的1.x版本政策和 `docs/agent-roadmap-workflow.md`。产品修复版本需要真实 build/test/check:release、冻结包、checksum/SBOM/provenance、远端资产digest、安装升级与相关独立资格；不能为绕过版本门禁只改 version，不能重打既有版本资产。

文档可以单独提交保存，但文档提交、审查记录标签或只含handoff的资产不应伪装成已完成上述产品修复的正式二进制 Release。每次交接应保存远端 commit/文件链接、候选身份、未完成项和下一入口；临时云目录不能作为唯一长期证据。

## 7 依赖 决策与不做项

### 必需依赖或决策

- CLI 与 `apexcn-forums` 共同确认：缺语言版本、同 operationKey 的行为/保留期、结果未知后的查询、权限和版本冲突合同。服务端改动归其仓库，CLI不得绕过。
- 凭据策略需确认：旧配置迁移如何区分有意 fallback 与 env-only；不能默默删除合理配置，也不能继续跨目标保留。
- 独立验证目录必须根据执行机器实际解析，核验已有 harness、candidate、dataset、scorer；Mac历史绝对路径不是云环境配置。
- 发布前选择本轮产品修复范围和跨平台 required/excluded；不能从当前分析自动重启旧0.9目标或扩大到别的 APEX CLI 项目。

### 本轮及下一步默认不做

- 不新增通用 APEX 应用初始化/开发/部署执行器，不新增数据库/管理员旁路。
- 不为文档合同修改线上数据，不将无数据/无权限错误伪装成成功空结果。
- 不删除历史失败、旧交接、timebox风险或缺失证据；不把修复后重试覆盖首试。
- 不全局放宽确认、校验、TLS、路径或凭据边界；不把全部写操作自动重试。
- 不用大规模重构替代具体修复。`content.ts`、`workflow.ts`、`collection.ts` 规模较大，后续可沿请求/输出/状态机边界渐进拆分，但应先用行为回归锁定合同。

## 8 可携带的最小复证记录

以下记录可在临时文件丢失后指导重建测试；不要把虚构样本换成真实密钥。运行时为 Node 24.19.0，使用内建类型剥离和模块解析适配加载本基线 `.ts`，没有安装依赖。正式回归应进入现有 Vitest，不长期依赖这套临时适配。

1. F01：`createWriteOperation` 创建 reply.create；mock fetch 为 `Response('<html>...</html>', {status:200})`；confirm 抛 HttpError(200)；读 journal 得 `failed`；再次 confirm 得 `cannot be confirmed; create a new preview`；重新 preview 得不同 operationKey。
2. F01：mock fetch 成功 JSON；仅在写 `status=completed` 时让 fs.writeFile 一次性抛 EIO；journal 最终 `failed`，result 中仍有 `ok:true,requestId:fixture-committed`；同 ID 恢复被拒。
3. F02：mock 500 的 error.message 含虚构 password/token/Cookie；journal保留原值。mock成功响应的同类嵌套字段；journal、返回值和实际printData输出均保留原值；公共redactSecrets对相同输入得到 `[redacted]`。
4. F03：临时旧profile保存虚构token和旧目标；调用set-token action仅提供新baseUrl和缺失的tokenEnv；loadRuntimeSession得到新目标加旧file token，`ok:true`。这只证明本地选择，不证明发生真实凭据传输。
5. F04：原roadmap复制对象只迁移validator目录，调用validatorReadiness得到missing；再把builder迁移至存在且不重叠目录，得到空问题数组。
6. F05：执行buildGuide纯函数，观察learning三个旧示例；compatibility的版本输入含`$(printf benign)`，生成命令仍包含未转义表达式。只检查字符串，不执行生成命令。
7. F07：一条S1 evidence，完整title/topic/URL；sources=[]时citationIntegrity=true；sources换为同ID/title、不同URL时仍true。
8. F08：并发两个confirm同一ID，stub fetch计数2、两个fulfilled；不能据此断言真实服务器重复写。另将execution-uncertain操作跨过两小时，有效期检查要求new preview。

重点源码固定链接：

- [写操作状态机](https://github.com/wfg2513148/apexcn-cli/blob/d545fe11a1a6408b28344e781304560eaca518d2/src/core/write-operation.ts#L121-L191)
- [HTTP 响应解析](https://github.com/wfg2513148/apexcn-cli/blob/d545fe11a1a6408b28344e781304560eaca518d2/src/http.ts#L81-L145)
- [认证迁移逻辑](https://github.com/wfg2513148/apexcn-cli/blob/d545fe11a1a6408b28344e781304560eaca518d2/src/commands/auth.ts#L94-L110)
- [指南生成](https://github.com/wfg2513148/apexcn-cli/blob/d545fe11a1a6408b28344e781304560eaca518d2/src/commands/guide.ts#L85-L142)
- [引用评分器](https://github.com/wfg2513148/apexcn-cli/blob/d545fe11a1a6408b28344e781304560eaca518d2/scripts/agent-rag-eval-score.mjs#L20-L43)

## 9 交接检查

- 根文件为本次新增，原三份历史交接原样保留。
- 产品代码、配置、测试、版本、发布资产均未修改。
- 249 个原 tracked 文件内容在本轮前后 SHA-256 一致；最终 `git diff --check` 通过，Git状态只有新增 `handoff.md`。
- 正式持久化/发布动作尚不属于本分析文件的完成声明；下一执行者应先确认当前远端和工作区变化，再处理经授权的提交或修复。
