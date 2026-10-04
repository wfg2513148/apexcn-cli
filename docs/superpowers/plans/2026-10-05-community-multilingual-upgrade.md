# Community Multilingual Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. CLI implementation stays in the current task; user simulation runs in fresh independent visible Codex tasks.

**Goal:** 将 apexcn-cli 升级到向后兼容的 1.x 版本，修复报告中三个确认问题，并使下面全部适用验收条件通过。

**Architecture:** 服务器负责语言选择、译文存储、权限和页面呈现，CLI 不模拟服务器缺失能力。CLI 用一次命令生命周期内的语言上下文贯通所有适用 GET 请求，写操作和 ask 回答策略保持原有契约。离线集合保存请求语言、返回语言及翻译状态，sync 重放集合语言。

**Tech Stack:** TypeScript、Commander 12、Node fetch／AsyncLocalStorage、Vitest、Oracle APEX／PLSQL／ORDS、真实 Chrome、Codex Desktop 独立任务。

## Global Constraints

- Backward-compatible routine iterations use `1.x` patch or minor releases according to semantic versioning.
- Do not use `2.0.0` or higher unless the user explicitly authorizes a breaking major release.
- 不取消 capability、endpoint、所有权、版本、预览、批准和完整性检查；未知契约继续拒绝。
- 用户模拟全部在 `/Users/kwang/Documents/Codex/2026-10-04/apexcn-cli-test-r5` 的全新可见 Codex 任务运行，gpt-5.6-luna/high；验证者不得修候选或读实现、内部技能、记忆、历史报告。
- 保留现有 AGENTS.md、docs/agents/ 和其他已有工作区改动；只提交本轮明确归属的修改。
- 生产不写测试内容；DEV 用现有专用账号，仅清理本轮样本，密钥不进入仓库、日志或报告。
- 失败、阻塞、未验证不计通过；预期权限／参数／冲突拒绝可在语义断言成立后计通过。环境错误有限重试，首尝试记录不改写。
- 本次验收覆盖社区升级兼容性与现有功能回归；全平台安装资格、Windows 全量生命周期、重构、新增通知／私信和新增 RAG 回答语言策略不在本次范围。update 的隔离供应链检查沿用本地质量门，不升级用户安装。
- 三条活动问题只有在修复、独立复验、清理、推送及发布齐全后闭合；新问题必须引用新独立任务首次证据。

---

## File Structure and Ownership

| 文件／范围 | 责任 |
| --- | --- |
| `src/core/capability-compatibility.ts` | 加入已验证 0.10 契约，保留结构／能力检查 |
| `src/core/content-language.ts`（新建）、`src/core/request-context.ts` | 支持的语言值、公开命令／端点范围、命令级上下文 |
| `src/index.ts`、`src/http.ts` | 注册公开选项、解析隔离、仅适用 GET 传参 |
| `src/commands/content.ts` | research／rag 返回语言与翻译状态保留 |
| `src/core/knowledge/collection-assets.ts` | 新artifact语言/hash绑定、旧hash兼容、共享语言一致性断言 |
| `src/commands/collection.ts` | build／favorites 语言持久化，sync 按源语言重放，旧集合中文兼容 |
| `src/schemas/registry.ts`、`src/commands/guide.ts`、`README.md`、`docs/{cli-manual,user-guide}.{zh,en}.md`、`agent-skill/SKILL.md` | 机器与用户契约一致 |
| `test/capability-compatibility.test.ts`、`test/content-language.test.ts`（新建）、现有 collection／rag／contract 测试 | 精确回归，不镜像所有实现 |
| `package.json`、`package-lock.json`、`src/version.ts`、发布资产 | 向后兼容版本、冻结候选与发布 |
| `issues.json`、`roadmap.json`、`docs/agents/independent-validation.md`、验收目录 | 归属、任务绑定、有效证据与闭环 |
| `/Users/kwang/apexcn-forums` 及最新社区工作副本 | 独立服务器任务独占修复，CLI 任务不修改 |

服务器子项目必须在其仓库保存独立实现计划、API 审计、部署和同样本 Chrome／API 证据。统一验收在本文收口。

## Acceptance Conditions

以下20项是聚合 gate，不是计分分母；真实分母为同目录 `2026-10-05-community-multilingual-acceptance-cases.json` 的原子场景，以及冻结 scope 所列适用固定基线。冻结前确认每项 required／excluded 及原因，冻结后禁止把失败、权限不足或超时改 excluded。

验收文件 `docs/reports/2026-10-05-community-multilingual-upgrade-acceptance.json` 必须逐项记录 status、assertion、threadId 和 evidence。只有全部冻结 required 原子场景最终 PASS、20 个父 gate PASS、本轮开放阻断问题为零和本轮数据零残留才算100%。历史跨平台资格欠项保持公开，不计入本次范围；excluded不计PASS、不伪装全平台资格完成。最终报告同时列首次通过数、重试后通过数、excluded范围和未验证边界。

| ID | 可判定条件 |
| --- | --- |
| A01 | 服务器审计确认 0.10 契约和所有 lang GET 端点，页面缺陷根因和修复范围有证据，CLI 不掩盖服务端缺口。 |
| A02 | DEV／生产只读 capabilities 接受 0.10；本地旧版兼容、未知版拒绝、结构损坏／缺失能力拒绝测试全部通过。 |
| A03 | help／commands／Schema／指南公开 lang=zh-cn/en，非法值在发请求前拒绝，省略保持旧中文默认，重复／并发命令不串语言。 |
| A04 | 分类及分类统计中英读取，内容语言／翻译状态保留，非法 API 语言稳定拒绝。 |
| A05 | 全局搜索、topic list/recent/view 中英选择贯通，原稿不改，代码／表格／emoji 保留。 |
| A06 | 同语言游标继续，跨语言与历史中文游标用于英文时拒绝；重放过滤参数且无重复结果。 |
| A07 | me topics/replies/favorites/subscriptions/dashboard 与 me search 的 created/replied/favorited/subscribed 非空样本读取、语言和权限正确。 |
| A08 | research／rag retrieve 每次搜索与详情使用同语言，保留内容语言／翻译状态／引用来源，不增加 ask 回答语言契约。 |
| A09 | collection build/favorites 保存语言与元数据；英文集合 sync 不被默认中文覆盖；旧集合按中文同步，非法集合语言拒绝；index/query/export/import/restore 完整性正常。 |
| A10 | DEV 自有话题／回复创建、修改、删除、嵌套回复 API 与真实 Chrome 均识别本轮内容。 |
| A11 | reply mark-answer/unmark-answer 与 reply favorite add/remove 通过公共预览／确认成功，结果读回，未绕过能力门。 |
| A12 | topic favorite/subscription 增加和移除、非空个人关系列表及收藏导出正常。 |
| A13 | 旧版本确认 409，其他用户操作拒绝、无权限端点拒绝、过期／篡改批准拒绝，不执行未经批准内容。 |
| A14 | 同一个 DEV 页面中文→英文→中文保持话题、正文及原文回复；新无译文样本原稿回退；既有双语文章切换显示正确。 |
| A15 | 登录后修改内容真实 Chrome 可见，非登录可访问内容显示正确；生产只读代表性中英页面验证通过。 |
| A16 | auth 配置优先级／脱敏、doctor 正常和坏 JSON、草稿／review、schema bundle、本地 workflow 预览批准／校验回归通过。 |
| A17 | ask 现有契约成功与引用可追溯；privacy/rules 按 advertised available／unavailable 行为验收；stats和普通账号管理员端点权限拒绝为required。管理员正向仅在冻结前确认已有受控DEV身份实际可用后required，否则提前明确excluded且不宣称覆盖；不新增问答语言或政策功能。 |
| A18 | 全部适用固定基线和上述动态场景有首次记录、原始输出 hash、明确语义断言；冻结候选身份与可见新手任务验证正确，失败／阻塞数为零。 |
| A19 | DEV 样本及收藏订阅全部删除，最终个人样本列表／marker 搜索零残留；浏览器关闭、临时凭据副本删除、原账号配置保留。 |
| A20 | build、全本地测试、check:release 通过；版本、commit、tag、发布包与 hash 一致，推送和 GitHub Release 已核对，活动问题闭合、交付报告完整。 |

### Task 1: Server audit and page repair

**Files:** 服务器任务负责其独立计划及 `/Users/kwang/apexcn-forums/docs/reports/2026-10-05-cli-multilingual-server-acceptance.md`；CLI 任务记录 scope 与 binding。

**Interfaces:** Consumes 报告与 COMMUNITY-I18N-20261004-003 首次截图；Produces 明确 lang 端点列表、内容回退行为、修复提交、DEV／TEST／PROD 同样本证据和 cleanup。

- [ ] Step 1: 新建服务器可见任务，核对最新提交 393d1b2 和应用边界，保存其修复计划。有效任务 `01a107c0-9b1c-70b0-af4f-91579ef6871d`；前一启动任务因沙箱 Git 元数据审批停住，已归档且不纳入交付，改用有现有授权的 CLI 执行器。
- [ ] Step 2: 读取最新 OpenAPI 的 ContentLanguage 引用并对照部署，记录 `/categories`、`/category-stats`、`/me/topics`、`/me/replies`、`/me/favorites`、`/me/favorites/export`、`/me/subscriptions`、`/me/search`、`/search`、`/topics`、`/topics/{id}`、`/topics/{id}/visual`。仅在该审计确认后冻结 CLI 语言范围。
- [ ] Step 3: 服务器任务以本轮 DEV 样本复现切换缺陷，写失败回归、最小修复与通过记录，保存实际 SQL／APEX／JS 补丁、部署命令和截图；CLI 任务只审查其实际产物。
- [ ] Step 4: 核对 A01、A14、A15 所需同样本读回、原稿回退、页面登录与非登录证据，并审查管理员／ask 路径 A17 所需测试权限，不用普通账号拒绝代替管理员成功路径。

### Task 2: Contract compatibility

**Files:** Modify `src/core/capability-compatibility.ts`; Test `test/capability-compatibility.test.ts`。

**Interfaces:** Consumes `assessCapabilityCompatibility(value: unknown, requiredCapabilities: string[])`; Produces 同签名并加入已验证版本，`ok/status/missingCapabilities/issues` 不变。

- [x] Step 1: 加入以下失败测试，并将原有窗口长度断言改为 7，negotiationMode 为一个 versioned 和六个 legacy。

```ts
test("accepts the deployed multilingual contract", () => {
  const value = { ...inventory("0.10.0-candidate"),
    supportedContractVersions: ["0.10.0-candidate", ...SUPPORTED_API_CONTRACT_VERSIONS] };
  expect(assessCapabilityCompatibility(value, ["personal-community"]).ok).toBe(true);
  expect(assessCapabilityCompatibility(value, ["notifications"]).status).toBe("missing-capability");
});
```

- [x] Step 2: 独立开发验证任务运行 `npx vitest run test/capability-compatibility.test.ts`，预期新增测试 FAIL；保留失败输出。
- [x] Step 3: 在 SUPPORTED_API_CONTRACT_VERSIONS 首项加入 `"0.10.0-candidate"`，错误窗口文本加入 `0.10`；保持 requestId、entry、广告窗口和 requiredCapabilities 检查不变。
- [x] Step 4: 同独立开发任务再运行该文件，预期全 PASS；随后记录精确修改并提交 `fix: accept verified multilingual API contract`，不包含他人改动。

### Task 3: Scoped content-language transport

**Files:** Create `src/core/content-language.ts`, `test/content-language.test.ts`; Modify `src/core/request-context.ts`, `src/index.ts`, `src/http.ts`。

**Interfaces:** Produces `ContentLanguage = "zh-cn" | "en"`, `parseContentLanguage(value: string): ContentLanguage`, `currentContentLanguage(): ContentLanguage | undefined`, `setCurrentContentLanguage(language: ContentLanguage | undefined): void`, `contentLanguageQuery(path: string, method: string | undefined, query?: RequestJsonOptions["query"]): RequestJsonOptions["query"]`；request context 内 operation 和 language 分离。

- [x] Step 1: 添加 helper 回归测试，覆盖英语仅传支持 GET、显式 query.lang 优先、POST/ask/capabilities 不传、缺省不传、非法值拒绝、并发隔离。最小可执行测试如下，其余公开命令断言对应完整测试文件在补丁附录和仓库的新建 test/content-language-commands.test.ts、test/content-language-collections.test.ts 中提供。

```ts
import { expect, test } from "vitest";
import { parseContentLanguage, contentLanguageQuery } from "../src/core/content-language.js";
import { runWithCliRequestContext, setCurrentContentLanguage } from "../src/core/request-context.js";
test("language is scoped to supported content reads", () => {
  runWithCliRequestContext(undefined, () => {
    setCurrentContentLanguage("en");
    expect(contentLanguageQuery("/api/v1/search", undefined, { keyword: "APEX" })).toEqual({ keyword: "APEX", lang: "en" });
    expect(contentLanguageQuery("/api/v1/me", undefined)).toBeUndefined();
    expect(contentLanguageQuery("/api/v1/ask", "POST")).toBeUndefined();
    expect(contentLanguageQuery("/api/v1/topics/42", undefined, { lang: "zh-cn" })).toEqual({ lang: "zh-cn" });
  });
  expect(contentLanguageQuery("/api/v1/search", undefined)).toBeUndefined();
  expect(() => parseContentLanguage("fr")).toThrow();
});
```

- [x] Step 2: 独立开发任务运行 `npx vitest run test/content-language.test.ts`，预期缺少 module／接口失败。
- [x] Step 3: 在 request-context 添加可选 `language?: ContentLanguage` 及两个 accessor，沿用现有 AsyncLocalStorage。新 helper 的完整值解析为：

```ts
export type ContentLanguage = "zh-cn" | "en";
export function parseContentLanguage(value: string): ContentLanguage {
  if (value !== "zh-cn" && value !== "en") {
    throw new InvalidArgumentError("Content language must be zh-cn or en.");
  }
  return value;
}
export function contentLanguageQuery(path: string, method: string | undefined,
  query?: RequestJsonOptions["query"]): RequestJsonOptions["query"] {
  const language = currentContentLanguage();
  if (!language || (method ?? "GET").toUpperCase() !== "GET" || !CONTENT_LANGUAGE_PATH.test(path)) return query;
  return { lang: language, ...query };
}
```

导入 Commander.InvalidArgumentError、request-context.currentContentLanguage 和 type RequestJsonOptions；`CONTENT_LANGUAGE_PATH` 精确匹配 Task 1 端点、无前缀模糊匹配。不要对 ask/认证/写入注入参数。
- [x] Step 4: index 在公开读取命令注册 `.option("--lang <language>", "content language: zh-cn or en (default zh-cn)", parseContentLanguage)`，精确命令为 category.list、stats.category、search、topic.list/recent/view、me.dashboard/search/topics/replies/favorites/subscriptions、research、rag.retrieve、collection.build/favorites。preAction 将 actionCommand.opts().lang 写入当前 context，每次 parse 前清空这些命令 lang 的旧值。http 使用 `addQuery(joinUrl(baseUrl, path), contentLanguageQuery(path, options.method, options.query))`。
- [x] Step 5: 独立开发任务测试 public help/manifest、非法参数零请求、两次 parse 不泄漏语言、并发中英读、research/rag 每个子请求使用同语言；预期 PASS。提交 `feat: propagate scoped content language through CLI reads`。

### Task 4: Derived evidence and offline collections

**Files:** Modify `src/commands/content.ts`, `src/commands/collection.ts`, `src/schemas/registry.ts`; Test `test/content-language.test.ts`、`test/content-language-commands.test.ts`、`test/content-language-collections.test.ts` 和现有 collection／rag 测试。

**Interfaces:** Consumes 当前上下文语言；Produces `collection.source.requestedContentLanguage?: ContentLanguage`（旧文件省略按中文；新字段尚未发布，无contentLanguage源字段迁移负担），派生 topic/evidence 的 `contentLanguage/translationStatus` 为服务器原值，不翻译。

- [x] Step 1: 写英文 build→sync 的回归：mock server 返回中英不同正文，英文 build 后无 lang sync 必须仍请求 en；旧集合省略 source.requestedContentLanguage 必须请求 zh-cn；source.requestedContentLanguage=fr 验证拒绝。独立开发任务先运行新增测试，预期 FAIL。
- [x] Step 2: build 和 favorites 的 source 写 `requestedContentLanguage: currentContentLanguage() ?? "zh-cn"`；sync 详情请求写 `query: { lang: loaded.collection.source.requestedContentLanguage ?? "zh-cn" }`；ValidCollection.source 加可选 ContentLanguage，isValidCollectionSchema 仅允许 undefined/zh-cn/en。
- [x] Step 3: favorites 人工构建 topic 时复制 `contentLanguage: item.contentLanguage ?? exportResponse.contentLanguage` 和 `translationStatus: item.translationStatus`；researchTopicFromData 和 appendTopicEvidence 复制对应源对象字段，bundle.requestedContentLanguage 写当前请求语言。原文 body/title 不变。
- [x] Step 4: COMMON_PROPERTIES 加 `contentLanguage: { enum: ["zh-cn", "en"] }`、`translationStatus: { enum: ["CURRENT", "STALE", "MISSING"] }`；集合语言位于源元数据，不破坏旧 schemaVersion 1/2。实际回复保持原文而非伪造英文标签。每份新 artifact.request.query.lang 保存请求语言；响应 result.contentLanguage 必须保留顶层原值，research/rag 衍生字段取 topic.contentLanguage ?? response.contentLanguage。favorites 从整个export响应继承顶层语言，不只从item猜测。source语言与任一artifact请求语言不一致，verify/sync在网络前拒绝；测试正反两种清单篡改。
- [x] Step 5: 独立开发任务运行 `npx vitest run test/content-language.test.ts test/collection.test.ts test/collection-m070.test.ts test/rag.test.ts test/contract`，预期全 PASS；审查 新 artifact 的 canonical hash 同时绑定请求语言、响应顶层 contentLanguage 和 topic（包括其 translationStatus）；旧 artifact 缺请求语言时完全保留旧 hash 算法。export/import 保留 source，提交 `feat: preserve collection language and translation provenance`。

### Task 5: Public contract, version and frozen candidate

**Files:** Modify README、中英手册／guide／agent-skill、package.json/package-lock.json/src/version.ts；Create 本轮 scope 和冻结候选 manifest。

**Interfaces:** Produces 公共文档和不可变 1.x 候选 `version/commit/archiveSha256/scopeSha256`，验证者只读这些公开资产。

- [ ] Step 1: 公共文档加入以下实际用法，并明确缺省中文、原文回复、存储译文回退、语言游标、collection sync 沿用源语言；ask 不提供内容语言参数。

```sh
apexcn category list --lang en --json
apexcn search "APEX" --lang en --json
apexcn topic recent --lang en --json
apexcn topic view 42 --lang zh-cn --json
apexcn me search "APEX" --scope created,favorited --lang en --json
apexcn research "APEX" --lang en --json
apexcn rag retrieve "APEX" --query "APEX" --lang en --json
apexcn collection build --topic-id 42 --lang en --output-dir ./apex-en --json
apexcn collection sync --dir ./apex-en --json
```

- [ ] Step 2: 选择当前授权的向后兼容版本 `1.2.0`，同步 package、lock、CLI_VERSION、DEFAULT_USER_AGENT 和本轮发布契约，不改旧 releases 目录的冻结历史。
- [ ] Step 3: 独立开发验证任务执行 `npm run build && npm test && npm run check:release`，预期所有门通过，修本次变更导致的失败；不调整阈值掩盖实际缺陷。
- [ ] Step 4: 明确文件列表提交冻结 commit；执行 `npm pack`，计算 archive sha256 和 scope hash，保存不可变候选。只有候选变动或真实未解问题才重新运行门。

### Task 6: Fresh independent acceptance and release closure

**Files:** 独立验收目录本轮子目录的 intake／first-attempts／coverage／findings／report／cleanup；Create 本仓库 acceptance.json 和中文完成报告；Modify issues／bindings。

**Interfaces:** Consumes 冻结候选与公开用户材料；Produces A01—A20 完整实证和可追溯发布。

- [ ] Step 1: 新建可见独立新手任务 cwd 为固定 validator project，绑定 gpt-5.6-luna/high、候选和 scope；不继承历史测试结果。独立开发测试可读代码，新手验收禁止代码，两个角色不能混用。
- [ ] Step 2: 完整适用固定基线与 A02—A17 专项执行，首次尝试原始输出 SHA 保留，公开 CLI 操作和对照 HTTP 分开；写回必须真实 Chrome 识别同样本，管理员成功路径只有在scope冻结前确认可用的已有受控DEV身份下required；若此前缺前置，明确excluded且不声称覆盖。冻结后权限不足不得改excluded。用户模拟不能读取开发测试或服务器内部实现证据。
- [ ] Step 3: 任何功能失败按 CLI／服务端／环境归属处理；CLI 修改后重新冻结并新建验收任务，服务端缺陷交服务器任务修复；旧失败不能改成首次成功。限次网络重试后仍不满足就保持未通过并继续诊断。
- [ ] Step 4: 独立 cleanup 后核对数据零残留、私有副本删除、Chrome 关闭，记录 A18/A19；builder 按有效证据自查，不运行本会话用户模拟。
- [ ] Step 5: 全部适用功能PASS后，发布已经冻结且验证过的产品提交C及原始包H_C，tag v1.2.0必须指向C，上传包不得重新打包；直接GitHub Release，不启动Actions。验收汇总、issues闭合和roadmap后续写审计元数据提交M，M不打tag、不npm pack、不冒充受验候选；核对C/tag/Release包及供应链H_C。check:roadmap在M通过是治理门，完成A20。
- [ ] Step 6: 输出 acceptance.json 20 项全部 PASS 与中文完成报告；若真实未完成，明确未通过项并继续工作，禁止提前宣称 100%。

## Self-review

版本：v2（独立批判审查通过，已达成共识）；A01/A14/A15 属于服务端任务；A02—A09 属于 CLI 实现；A10—A19 属于独立验收；A20 属于版本发布。报告中所有确认缺陷与待验证范围已对应条件。历史 GA／Windows 不升级为本次条件；各接口名与本文代码一致，未指定任何未知函数。当前授权已要求执行，无需再询问执行方式。


## Optimized scope and execution rules (v2)

### Review agreement and starting checkpoint

独立批判审查任务 `/root/upgrade_plan_critic` 第一轮拒绝原计划；本版逐项修正验收分母、前置权限、发布身份、跨仓库路径、语言hash和可执行性。主任务已暂停后续源码、测试与服务端部署，2026-10-05最终复审结论APPROVE，已达成共识，允许恢复执行。审查意见和最终共识保存在 `docs/reports/2026-10-05-upgrade-plan-critical-review.md`。

已发生的可恢复实现仅为0.10兼容、语言上下文和公开入口。独立开发任务 `01a107c0-969f-7e31-8f43-207aa08533d2` 保留首次红灯和6个绿灯测试证据；这不是新手业务验收，也不算最终100%。另外两个回归文件已写但未运行。优化版不假装重演已经完成的红灯；后续Task4需先运行新增衍生结果／集合测试并保留真实红灯，再实现。

### Product scope versus infrastructure

服务器工作只修复报告中的页面语言切换缺陷和实证证明必需的API兼容问题，不重新升级APEX、ORDS、Tomcat、Nginx、SQLcl，不全量翻译DEV／TEST，不扩展私信／通知或RAG回答语言。生产部署限定经过DEV／TEST验证的差异，先核对线上基线并备份；原稿及原始回复保留。

ask作为现有公开能力回归required，不增加性能SLA：按公开timeout行为记录实际耗时与可追溯结果。privacy/rules若服务端明确unavailable，验证公开输出与原因而不是制造内容。管理员读取正向在冻结前由服务器确认已有受控DEV身份／最小权限token可用，未确认时该唯一原子项提前excluded并公开未覆盖；不为了提高数字扩大账户权限或编造管理员。

### Exact freeze and release chain

1. C包含所有运行时代码、打包文档、版本、发布契约和公开测试资产。C提交完成、必要本地门通过后冻结。
2. 从C构建并打包，记录archive H_C、打包文件列表及各成员hash、scope hash、服务器实现commit与DEV环境hash。
3. 独立新手只能安装和操作H_C，不修包、不看源码/AGENTS/内部技能/记忆/历史报告。当前主任务只复核证据，不模拟CLI。
4. 有任何候选运行时或打包文件修改就产生C2/H_C2和新验收线程，旧首次失败完整保留。
5. release tag `v1.2.0`固定C；发布上传原H_C及与C关联的供应链材料，下载后核对hash。不可把另一个commit重pack后复用C的通过报告。
6. M仅用于问题闭合、roadmap路由和验收审计，不打tag、不pack。最终明确 `released artifact=C/H_C; repository HEAD=M (audit metadata only)`。如果发布工具强制要求在C关闭问题，停止该工具路径并调整流程，不能提前伪造闭合；优先使用既有脚本可实现的上述链。
7. 每个证据引用包含repository、commit、absolute path、threadId。跨仓库文件必须使用绝对路径。

### Atomic case matrix and freeze policy

机器清单在本计划同目录 `2026-10-05-community-multilingual-acceptance-cases.json`，每行包含 caseId、parentGate、classification(required/excluded)、freezeReason、artifactUnderTest、firstAttemptEvidence、finalEvidence、cleanupEvidence、responsibility。这些字段在执行前允许空证据、状态planned，不能据此PASS。冻结前补实际candidate C/H、scope hash和服务器环境；admin-positive必须完成先验角色检查再锁定分类。固定基线202条逐条记录applicable及事先排除理由，任何适用条目必须完成；历史全平台生命周期场景不计入当前社区功能100%。

case必须有明确语义断言，退出码0只是证据之一。状态只有PASS/FAIL/BLOCKED/NOT_VERIFIED，excluded单列而非PASS。100%分母为freeze时全部required case加全部适用固定基线；需要最后全部PASS、本轮阻断问题0和cleanup成功。首次100%与最终100%不同，必须同时公开首次失败/环境错误/重试记录。

### Language/hash implementation contract

- requestedContentLanguage是CLI选择，result.contentLanguage是服务器响应顶层有效选择，translationStatus从源topic/item保留。不要把UI偏好、原稿语言、响应选择语言与RAG回答语言混为一谈。
- 明确16个lang命令：category.list、stats.category、search、topic.list、topic.recent、topic.view、me.dashboard、me.search、me.topics、me.replies、me.favorites、me.subscriptions、research、rag.retrieve、collection.build、collection.favorites。全部在manifest和help断言；topic别名thread验证同等行为。ask/write/admin/auth/update/schema/doctor不出现lang选项。
- 独立command factory并非稳定公开CLI入口；本次CLI合同以createProgram公开树为界。若任一文档或既有消费者承诺独立factory支持lang，必须在其builder注册语言，不能只在index注入；scope记录审计结论。
- 新artifact.request保存 `{ method: "GET", path, query: { lang: selected } }`；新collection.source保存requestedContentLanguage。favorites读取export顶层contentLanguage并连同topic元数据保存。
- verify在sync发请求前检查source.requestedContentLanguage与每个artifact.request.query.lang一致；清单单改en→zh或zh→en拒绝。legacy无语言metadata仍按原hash有效并默认中文，sync升级记录和source，不能静默把英文集合同步成中文。
- canonical hash在new artifact含request.query.lang时加入 `{requestedContentLanguage, contentLanguage: result.contentLanguage}` 到旧的 `{id,sources,topic}`，topic中的translationStatus随正文参与hash；legacy无request.query.lang时输出旧hash不变。索引/导出/导入/恢复不得丢元数据。

### Complete code and gate appendix

本版执行代码以 `2026-10-05-community-multilingual-code.patch` 为具体补丁附录。它记录当前已实现部分和后续最小变更的完整代码，不用未定义helper名或口头“补足边界”代替。执行者先核对基线，再逐task实施其hunk；不要整patch盲目应用以覆盖当前已有实现。若诊断得到不同根因导致最小补丁需变动，先更新计划并记录理由，而不是偷偷扩大需求。

开发验证保持独立任务，第一轮Task4精确命令：

```sh
npx vitest run test/content-language-commands.test.ts test/content-language-collections.test.ts
```

预期真实衍生元数据／集合语言测试FAIL（当前尚未实现）。实现后同命令PASS；完整受影响门：

```sh
npx vitest run test/capability-compatibility.test.ts test/content-language.test.ts test/content-language-commands.test.ts test/content-language-collections.test.ts test/collection.test.ts test/collection-m070.test.ts test/rag.test.ts test/contract
npm run build
npm test
npm run check:release
```

开发测试可读源码；新手验收与它是不同新鲜任务，禁止复用其测试先验来代表用户可发现性。写回API证据与同样本真实Chrome视觉证据都required，网页认证前置不足必须明确BLOCKED，不猜其根因或把空壳算通过。

每task提交只包含本轮明确修改。冻结后不继续改被打包文件或执行计划checkbox，进度记录到output和验收报告；发布审计M只包含包外元数据。已有6测试无需反复运行，只在修改、失败或未解疑点时跑相关门。

发布契约复制使用完整脚本 `docs/superpowers/plans/2026-10-05-prepare-release-contract.py`；精确命令为 `python3 docs/superpowers/plans/2026-10-05-prepare-release-contract.py`，预期输出 Prepared 1.2.0 public contract。脚本只创建全新1.2.0目录，若已存在则拒绝，不覆盖历史或已冻结资产。补丁附录不重复202条静态基线，保持DRY。

构建冻结候选时使用从C导出的干净独立clone，避免保留在主工作区的AGENTS.md／docs/agents等他人未提交文件进入发布包。主工作区原文件保留，供应链必须报告sourceTreeDirty=false。若治理检查依赖未跟踪本地说明，则使用已提交治理文档等效读取，不把他人文件冒充C的一部分。

治理构建路径最小修复（Task5附属）：`scripts/check-roadmap.mjs` 的 readAgentGuidance 仅在拆分说明存在时追加读取，干净C使用已提交AGENTS和docs/agent-roadmap-workflow.md。冻结规则检查仍必须有freeze immutable文本并指明实际路径或resolved independent validation project；运行时cwd/冻结身份仍有独立强校验。这样保留用户未提交拆分文档而不让发布依赖它。

### Execution adjustment from full gates

首次全量门发现硬编码1.1.6断言、缺失ajv依赖、当前公开面遗漏新增Schema字段，以及GA门要求问题先闭合与发布后闭合的环依赖。修复版号断言和验证地址fixture，按lock离线安装依赖；独立开发任务重新生成仅1.2.0公开面，不修改历史基线。`check-ga-readiness --candidate`只用于候选结构审核：输出candidateOnly=true及完整未解决issue IDs，所有其他门保持；默认无flag仍拒绝活动问题。冻结前运行`npm run check:release -- --candidate`，通过独立验收和发布后在审计提交M执行同组版本/工作流/源码/roadmap/default GA门与 `node scripts/check-release-artifacts.mjs --verify-only --artifacts-dir <C的原始产物目录>` 收口，M不调用会重新打包的默认check:release。候选检查不能证明最终发布通过。

集合拒绝路径的测试helper原先对空stdout强制JSON.parse；现在捕获stderr、允许拒绝时空stdout，并明确断言validation错误、exitCode=1和零请求。独立复验6/6通过，首次失败完整保留。

最终产物审核新增显式`--verify-only`：只审核已存在的C/H_C，不调用npm pack或重建checksum/provenance；旧默认构建行为保持。回归确认原包与provenance字节不变，以及坏checksum拒绝后也不重建包。最终默认GA门仍要求活动issues零，候选flag不能用于发布闭环。

开发证据（独立可见任务01a107c0-969f-7e31-8f43-207aa08533d2）：core 6/6、derived suite 73通过与3夹具解析失败保留、修正后集合6/6、全量812通过/1个既有跳过；build和候选check:release通过。证据位于output/upgrade-20261005，本地质量不计新手业务验收。Task5版本/文档/公开面已实现，最终源树构建与冻结尚待。
