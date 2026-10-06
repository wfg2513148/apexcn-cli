

<!-- codex-air-review-20261006-task -->
## 2026-10-06 M5-Air 深度审查

### 范围与基线
主机 hostname 实测 kwang-macbook-air-m5；项目 /Users/kwang/apexcn-cli，独立产品仓库；main，HEAD fac8fbe（2026-10-06 02:45:19 +0800）。已有未跟踪 assets/、drafts/，保持不变。本次读取 AGENTS.md、README、语言实现/测试、验证路由、发布闭环计划、goal-20261005 交接证据；无项目 .agents/skills 发现。仅文档审查，未访问生产、秘密或 sessions。

### 定位、终极目标与实际进展
README 明确定位：让本地 AI 通过 ORDS 查找、问答、管理和经确认写入 APEX 中文社区；终极目标可概括为可信、低摩擦、有来源且安全的自然语言社区助手（概括推断，依据 README 的功能/安全边界）。package.json 为 1.2.1。src/core/content-language.ts 已在原始问题阶段推断语言，异步上下文隔离且显式 lang 优先；test/content-language.test.ts 覆盖韩日混合、补充汉字和并行上下文。2026-10-05-query-language-release-closure.md 明确 G1–G9 以及77适用基线、20语言场景、125排除；iteration-summary.json 记录候选 b96289a、11资产下载/安装和生产实页验收完成。这是历史记录，本轮没有重做在线发布验收。

### 优先问题、证据与影响
1. P1：发布证据链有已披露缺口。reports/query-language/goal-20261005/iteration-summary.json 的 unexpectedProblems 明确独立 phase 台账被覆盖、12项 child 精确时间戳未恢复，以及部署前 DBMS_METADATA 导出未完成。后续恢复较早四原始文件并匹配 SHA 不能把“较早基线”当成“部署瞬间完整备份”。影响：故障审计和回滚时序仍存在限制；不是推断发布失败。
2. P1：TEST 代理元数据异常使用会话级 20648883 规避，未独立证明 Oracle 内部缺陷号（同一 summary 的 rootCauses/majorRisks）。需要明确适用连接、生命周期与恢复后检查，否则平台变化可能使复现重新出现。此项属于跨仓库服务端依赖，CLI 不应提供掩盖服务失败的 fallback。
3. P2：多份历史验证项目容易被误当当前路由。docs/validation-routing.md 明确当前是 Documents/Codex/2026-10-04/apexcn-cli-test-r5，而 /Users/kwang/apexcn-cli-test 是重建的旧 harness；下一轮必须冻结 current binding，不能把 npm check 或历史 GA 计入当前 full qualification。
4. P2：inferContentLanguage 使用 Han 且无日/韩字符的启发式，纯汉字日语和混合中英均可能落中文；这是当前公开 README 描述的算法边界，并非已证明违约。用户原规则是“中文，其余英文”，需要确认该边界而非无依据替换算法。

### 改进及验收
近期：整理不可变 phase manifest，将原始命令/时间、stdout digest、candidate SHA、排除理由和证据责任人关联；缺失精确时间保留 unknown，验收为任一 PASS 可追到同候选首证且不覆盖旧文件。为 TEST 规避补复现、连接矩阵、取消规避后的对照和回滚条件，验收为有界 DEV/TEST 身份/对象/API 检查且不能自动生产执行。下一轮先由当前独立项目按精确 SHA 验收，排除项单列。
中期：将检索/回答语言、正文语言、签名URL语言和分页语言的跨端合同做版本化兼容矩阵；验收新增服务端版本不能悄悄改变 CLI 错误码、缺版或 STALE 行为。确认语言启发式边界后增加明确语义案例。下一产品目标需新用户目标，不自动重启历史0.9或后续里程碑。

### 检查结果与待确认
本轮 ./node_modules/.bin/vitest run test/content-language.test.ts 启动失败：EPERM 写 node_modules/.vite-temp 下打包配置；因此 **测试未运行，不能称业务失败或PASS**。未运行 build/update/install/在线问答/生产或DEV写入。git status 回读仍仅 assets/、drafts/，没有产品文件修改。待确认：下一里程碑、规避维护责任和语言判定边界；发布历史证据的独立语义审计未在本轮完成。

### 2026-10-06 当前验收路由可用性补核实
本机检查 `test -d /Users/kwang/Documents/Codex/2026-10-04/apexcn-cli-test-r5` 返回不存在。docs/validation-routing.md 虽指向 r5，但 **Air 上当前路由目录缺失**；本轮没有发现可用 r5，历史报告不能证明当前可重新执行。影响：当前候选独立复验链在本机断开，不能以现存旧 /Users/kwang/apexcn-cli-test 或 npm check 替代正式验收。近期应在用户后续授权的验证任务中恢复具有明确来源的冻结 harness，并核验版本、源码/候选SHA、contract/dataset/scorer摘要、首证来源与当前机器路径；或使用已确认其他机器上的只读来源保留历史证据，并单独配置新的可执行验证项目。验收为目录实际存在、所有冻结输入摘要匹配且 current binding 两字段一致，随后独立可见任务能以相同候选完成适用范围。新建空目录不算历史恢复，跨机历史PASS不算Air现场PASS。该核实仅更新任务工作区审查文档，未更改产品或原handoff。
