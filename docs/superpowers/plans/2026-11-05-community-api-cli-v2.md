# Community API and CLI Statistics v2 Implementation Plan

> **For agentic workers:** Use the applicable implementation and verification workflows task by task. Server changes and independent acceptance belong to their designated user-visible tasks, not this CLI implementation session.

**Goal:** 完成社区搜索及 API 契约修复，为 CLI 提供兼容的统计 v2，并使冻结的全部适用验收场景通过。

**Architecture:** 社区仓库拥有 ORDS、数据库和生产修复；CLI 通过已声明能力的 ORDS 接口读取 v2，既有 v1 命令及契约不变。独立项目只使用冻结候选和公开资料，验证真实用户场景及证据。

**Tech Stack:** Oracle APEX／PLSQL／ORDS、SQLcl、TypeScript、Commander、Vitest、JSON Schema、真实 Chrome、Codex Desktop。

**Spec:** `docs/superpowers/specs/2026-11-05-community-api-cli-v2.md`

## Global Constraints

- 按 spec 的 A01—A11 和项目的独立验证、生产修复、版本及密钥规则执行。
- `/Users/kwang/apexcn-forums`、`/Users/kwang/apexcn-cli`、`/Users/kwang/apexcn-cli-test` 各自拥有服务器、CLI、独立验证；不借用历史验证结果冒充本轮结果。
- 服务器修复必须先复现并查明根因；DEV 基线、TEST 真页面和生产验证按服务器仓库门禁执行。
- 固定基线取候选发布合同；现有 1.2.2 合同列出 202 个题目，保留其历史状态并按适用合同执行，不把未运行的任务算作通过。
- 新命令暂定候选版本 `1.3.0`，冻结前重新核对远端标签；现有 1.2.2 的发布 readiness 检查不应将该进行中的后续版本需求误报为 1.2.2 已通过。
- 保留主工作区既有 `handoff.md` 删除和监控文件修改；在只含本轮候选提交的独立工作树运行全量构建和质量门，确保依赖目录为真实目录而非会干扰供应链扫描的软链接。
- 当前 `check-ga-readiness.mjs` 仅接受目标版本和版本化合同中同时登记的增强请求；隔离复核证实在 1.2.2 上记录本轮 1.3.0 请求会失败。候选合同必须正确绑定该请求，不得通过提前删除请求或放宽其他版本检查掩盖失败。
- 新能力基于服务端已验证的 v2 合同；不掩盖缺失能力，不破坏 v1，不升级主版本。

## Review Focus

- 缺少能力、权限不足或服务端返回异常时不能降级为 v1 或输出成功。
- v1 和 v2 的字段、关键词、limit 和 JSON Schema 不能混淆。
- 上海自然日、零请求日期及未分类计数必须与真实服务端合同一致。
- 新命令的请求头归因必须与现有服务端 allowlist 兼容，并通过 route 区分 v2。
- 首次失败、候选哈希、跨环境状态和真实浏览器证据必须可追溯。

### Task 1: 服务器故障、契约和 v2 环境证据

**Owner:** `/Users/kwang/apexcn-forums` 的独立可见任务。

**Assignment:** 用户于 2026-11-06 授权新建的可见任务 `01a1ac75-211c-7152-b763-3ae977a7b84f`；最终状态以该任务和其服务器证据为准。

该社区服务端任务此前归档后已于用户 2026-11-06 明确要求继续时恢复。服务端随后在最新生产基线上完成修复、DEV／TEST／生产验收及清理，并以提交 `434be4be623bff519518bf55dedee1003928d1fe` 发布 `v3.5.2`。其报告为 `/Users/kwang/.codex/worktrees/apexcn-forums/community-api-search-contract-20261106/docs/reports/2026-11-06-community-api-search-v2.md`；历史 V4 检查缺少已退役 App 107 的生成证据，无法精确归属的旧匿名会话保留，生产包中既有中文编码损坏亦原样保留。

**Interfaces:** 消费生产首次失败请求 ID 与 OpenAPI 解析错误；产出根因、服务器 commit、修复后的 API 合同、DEV／TEST／生产和 Chrome 证据、v2 能力与权限证据、清理记录。

- [x] 按当前远端及生产源确认基线，复现 `APEX` 英文 500，比较 `ORDS` 英文和 `APEX` 中文，定位具体失败点；保留原始失败。
- [x] 针对根因先写失败回归并修复，验证中英文搜索、空结果、分页及跨语言游标；按 DEV→TEST→生产门禁执行，生产只读验收且保护其他工作。
- [x] 修复 OpenAPI YAML，并按公开入口的实际行为记录 topic／reply 更新合同；运行社区契约检查及相关源码／运行时测试。DEV 实测 PATCH 在 nginx 返回 404，POST 对专用话题和回复更新成功，现有 CLI 使用 POST；生产 PATCH 尚未测试。ORDS 注册或 OPTIONS 不能证明 PATCH 公网可用，合同不得将其标为已验证支持。
- [x] 验证 DEV v2 管理员成功、普通用户／匿名拒绝、日期／limit 边界。独立测试发现未传 limit 首次返回 400（requestId `req_5f8a43a8ecb6684de063020012ac15bd`），而文档规定默认 20；先定位该差异并修复服务端，不以 CLI 默认值掩盖。交付已提交的合同和 DEV 证据供 CLI 接入；后续补齐 TEST／生产及清理证据。

  待验证假设：当前 ORDS 模块 `p_items_per_page` 为 25，v2 handler 向包体传递 `:limit`，包体仅在输入为 NULL 时默认 20；Oracle 文档将 `limit` 列为保留分页参数。上述事实与 400 现象有关联的可能，但尚未证明实际绑定值或根因；应在 DEV 安全地核对绑定值和原始查询参数，不得仅凭推测调整整个模块的分页设置。[Oracle ORDS 隐式参数](https://docs.oracle.com/en/database/oracle/oracle-rest-data-services/26.1/orddg/implicit-parameters.html)

### Task 2: CLI 统计 v2 与兼容契约

**Files:** Modify `src/commands/content.ts`, `src/core/services.ts`, `src/core/command-registry.ts`, `src/schemas/registry.ts`, `src/schemas/schema-ids.ts`, public guides and agent-skill routes as required; Test `test/content.test.ts`, `test/schema-registry.test.ts`, `test/index.test.ts` and focused contract tests. 发布合同行为涉及 `scripts/generate-ga-public-surface.mjs`, `scripts/generate-ga-qualification-dataset.mjs`, `scripts/check-ga-readiness.mjs` 和对应测试。

**Interfaces:** 消费 Task 1 的已验证 v2 合同；提供 `apexcn admin operations-v2 [--from DATE --to DATE] [--user-id ID] [--limit 10|20|50|100] [--json|--format FORMAT]`。旧 `admin operations` 保持 v1。

- [x] 先写公开命令行为测试：v2 成功、能力未提供／禁止、非法日期与 limit、服务器错误、v1 不变、统计请求归因；运行并确认因功能缺失而失败。
- [x] 实现最小 v2 命令、能力门及格式化。与服务端核对 `X-APEXCN-CLI-Operation` 的规范归一规则：现有 allowlist 使用 `admin_operations`，v2 route 单独区分；能力预检归因不能伪装成统计请求。
- [x] 增加与 v2 响应相符的独立公开 JSON Schema 和 manifest 对应关系；正例与缺失字段、错误版本、错误语义 ID、无关键词反例均被测试。
- [ ] 更新中英文手册与代理路由，清楚区分 v1 关键词和 v2 口径；运行聚焦测试、完整 `npm test`、`npm run build`、`npm run check:release` 及类型检查。macOS 跳过的 Windows 生命周期测试必须用已授权的 Windows 验证覆盖；记录失败和结果。
- [x] 为 readiness 版本和增强请求绑定添加正反测试：1.3.0 候选合同包含本轮请求时可通过，未绑定或错误版本仍失败；保持既有 1.2.2 合同不可变。

- [x] 历史测试适配：在隔离工作树注入 v2 描述符，先复现 `test/ga-readiness.test.ts` 错误要求 1.1.6 包含新命令；改为以 1.1.6 冻结公开面核对历史数据集，并要求当前命令集合保留全部历史命令。模拟删除历史命令仍失败；历史文件未修改。1.3.0 新增面仍须在候选合同和正式验收中单独校验。

### Task 3: 冻结与独立真实验收

**Owner:** CLI 任务冻结候选；`/Users/kwang/apexcn-cli-test` 的全新独立可见任务执行验证。

**Baseline preflight:** 按用户澄清在 `apexcn-cli-test` 新建独立会话 `01a1ac80-6c8c-7c63-a509-1a945449c8fa`，针对官方 1.2.2 归档开展真实只读基线和 DEV 能力预检。此轮不代替冻结升级候选后的全新正式验收轮。

**Interfaces:** 消费完成 Task 1 和 Task 2 的候选；产出带首尝试证据的固定基线、动态场景、API／Chrome、清理和逐项汇总。

独立验证准备现状：测试项目的 `run-release-qualification.mjs` 对缺少专用 fixture 的多项逆向场景明确标记 blocked，其中 `M110-Q-188` 不能由普通示例自动通过；生命周期验证还将升级后的版本固定断言为 1.1.6，现有补测脚本也固定读取 1.1.6 资产。正式轮必须由独立验证任务使用候选包内的当前合同、候选版本及真实或适当隔离的 fixture 逐项取得证据，特别验证 cursor 遍历；不得直接改评分标志或复用旧版本结果。

首次证据与评分审计：现有 `merge-release-supplement.mjs` 会以补测结果覆盖 `firstAttempt`，仅把原值另存为 `priorFirstAttempt`；该合并结果不能证明首次通过。现有 release scorer 检查 evidence 路径存在及 attempt hash 格式，但不重算文件与 attempt 哈希。正式验收须保留每轮不可变的原始首次结果，重算候选、stdout、stderr 和 attempt 哈希并核对证据根目录；修复后采用新的冻结候选和全新验证轮，单独报告旧轮失败，不能把补测重命名为旧轮首次成功。

已用独立临时合成样本复现：任意 64 位伪造 attempt hash 仍可得到 `independentAcceptance=true`，重复 required scenario ID 也被计入 scoped pass；缺少权威数据集时总结果虽为 false，展示的通过数仍可能为所需总数。`apexcn-cli-test` 会话 `01a1ac80-6c8c-7c63-a509-1a945449c8fa` 已在自身项目完成独立证据核验器及 50 项合成测试；该工具只判定完整性，始终保留语义待审，不直接授予验收。现有 recorder 不产生其所需格式，正在同一测试项目另行准备不可覆盖的采集及封存工具；这些准备不替代未来全新正式验证轮。

核验器独立审查确认 6 项待修边界：本地合成故障不应被要求伪造 DEV 附件；删除未封存 results 的 followUps 可能隐藏失败补测；stdout/stderr 的不同路径可能指向同一文件；后续证据缺失时报告不应丢失已核验的首次失败；动作未发生的 blocked 场景不能被迫伪造 DEV/Chrome/清理附件；assessment 元数据不应在未绑定时被当作完整性保护的内容。这些情况均需以冻结合同、可信结束见证及负向测试处理，不能降低真实写入和 Chrome 门禁。

后续复核发现新版模式策略未覆盖 `M110-Q-175`：其 `preview-network-only`／`preview-only` 场景已有本地 409、仅 GET 的合成夹具，但原策略仅允许 DEV。测试会话已交付冻结授权的 loopback 预览模式，合成回归 140 项通过；该结果只证明工具结构和字节一致性，真实隔离、零生产写入和业务语义仍待正式轮独立审定。证据：`/Users/kwang/apexcn-cli-test/preview-synthetic-verifier-20261106-BUQ4li/REPORT.md`。

对上述新版的独立审查复现四项边界：统一报告遗漏补测状态、不完整 PNG、JSON 转义绕过凭据模式检测及 preview `outcome` 中未计的嵌套对象。测试会话已在独立副本修复并保留 RED/GREEN，160 项合成回归通过；截图真实性、网络观察完整性及业务语义仍须独立审定。证据：`/Users/kwang/apexcn-cli-test/runs/q189-synthetic-isolation-20261106-6KUB5x/tool-fixes/REPORT.md`。

`M110-Q-175` 另有语义缺口：现有 `validate-adverse-local.mjs` 向首次 GET 注入 409，只执行 preview 并检查错误／无写请求，没有产生并确认旧 operation id，不能证明旧版本冲突后不重放。历史任务的 `preview-only` 策略也不授权 confirm；正式冻结前须以不降低权限边界的方式设计独立 DEV 动作链或版本化动态场景，保留历史场景及首试，不得将现有 synthetic 结果计为完整语义通过。

拟定的补充动态场景：使用既有专用 DEV 账号创建本轮话题，读取版本 v1 并生成更新预览 A；用独立、已授权的测试更新使该话题进入 v2；确认 A 时验证服务端返回 `409 VERSION_CONFLICT`，记录 operation id、请求次数和 requestId，证明没有自动重放；最后用 API 和真实 Chrome 核对 v2 内容，再仅删除本轮样本并证明清理。该场景须在冻结 scope 中单独标记 `isolated-dev-write`、`isolated-confirmed` 和真实 Chrome；Q175 的 preview-only 部分不能借此获得写权限。只有预览证据和补充动作链均通过，才可认为原始“不重放”意图得到覆盖。

`M110-Q-189` 的无效 operation id 场景本应零网络；macOS 定向沙箱出现合成硬链接越界。测试会话随后使用独立 Colima profile 检查容器：清空 socket 的合成 Node 可运行，但过滤前已连接的 socket 仍能发送本地请求，真实 CLI 启动链、全部继承 FD 和完整网络审计未验证。任务 profile、容器及镜像已清理，默认 profile 保持停止、Docker context 未切换；删除时的磁盘解锁警告及后续路径不存在检查保留在报告中。正式轮须取得可核验的隔离环境，否则保持该项未验证。证据：`/Users/kwang/apexcn-cli-test/runs/q189-synthetic-isolation-20261106-6KUB5x/Q189-REPORT.md`。

独立测试会话已做有界后续预检：官方 Node 镜像两次拉取均在匿名认证时返回 EOF，受信启动链和网络观察未运行，1.2.2 及 1.3.0 均未执行，Q189 当时保持 blocked。专属 profile 和临时 context 已清理，默认环境保持原状；首次失败、重试和清理证据见 `/Users/kwang/apexcn-cli-test/runs/q189-bootstrap-v122-20261106-okrPY0/Q189-REPORT.md`。用户要求继续后，主机及专属 VM 对固定 digest 的官方缓存请求返回 HTTP 200，但本轮唯一一次 daemon 拉取仍失败，未执行候选；清理及操作偏差见 `/Users/kwang/apexcn-cli-test/runs/q189-route-preflight-20261106-eGYqXQ/Q189-REPORT.md`。这些合成样本不能计作通过；后续使用另一条路径的结果见下。

后续改用验签的官方 Node 发行包，在专属 VM 内完成有界预检：首次 1.2.2 动作因线程过滤不兼容而超时，轨迹不完整；另一次修正后的独立预检对一个格式无效 ID 给出预期拒绝，目标 11 个线程的动作阶段未观察到网络调用。该后续尝试通过适配器导入发布包入口，启动阶段使用过隔离 loopback，不能覆盖首次失败，也不能替代安装后启动器、其他无效 ID 或新候选的正式验收。证据：`/Users/kwang/apexcn-cli-test/runs/q189-followup-20261106-28g3Fe/Q189-FOLLOWUP-REPORT.md`。

- [x] 可在服务器工作等待期间先行完成资格数据生成器的独立准备：在隔离进程注入 `admin.operations-v2` 描述符，先证明现有生成器会把历史场景编号重新指向其他命令；再确保旧 202 条身份稳定、新命令场景追加，并更新依赖新增命令数量的版本相关断言。原 1.2.2 数据集保持逐字节不变。本步骤仅验证生成器，不代表 202 项独立资格已通过。
- [ ] 按语义版本更新版本化公开面和候选资格合同，不覆盖历史版本。新命令的资格题追加到既有基线之后，保留历史场景 ID；原有“仅两个批准新增命令”的版本相关题目按本轮实际公开面更新并记录差异。固定 commit、package、SHA-256、合同、数据集、评分器与场景清单。
- [ ] 在验证项目运行 readiness 与候选完整性检查；新建独立新手任务，确认 cwd、候选身份和不读实现源码的边界。
- [ ] 完整执行冻结合同的适用固定基线和独立的 v2／搜索／错误场景；真实请求与公共 CLI 对照，适用场景使用同一记录的真实 Chrome，并证明清理完成。
- [ ] 对每个失败保留首次证据，按服务器／CLI／环境归属修复；候选变化后重新冻结并使用新验证轮，直至所有适用条件通过。

### Task 4: 发布与完成审计

**Interfaces:** 消费通过的服务器和独立验证证据；产出本轮发布／交接证据及 A01—A11 完成审计。

- [ ] 对照 spec 逐项核查证据、边界和未执行项；不能以环境 readiness、局部 smoke 或修改验收范围替代完整通过。
- [ ] 按适用项目协议核对版本、提交、标签、包哈希、发布与治理状态；保留独立任务发现的首次失败与历史资格限制。
