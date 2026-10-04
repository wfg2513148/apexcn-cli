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
| `src/commands/collection.ts` | build／favorites 语言持久化，sync 按源语言重放，旧集合中文兼容 |
| `src/schemas/registry.ts`、`src/commands/guide.ts`、`README.md`、`docs/{cli-manual,user-guide}.{zh,en}.md`、`agent-skill/SKILL.md` | 机器与用户契约一致 |
| `test/capability-compatibility.test.ts`、`test/content-language.test.ts`（新建）、现有 collection／rag／contract 测试 | 精确回归，不镜像所有实现 |
| `package.json`、`package-lock.json`、`src/version.ts`、发布资产 | 向后兼容版本、冻结候选与发布 |
| `issues.json`、`roadmap.json`、`docs/agents/independent-validation.md`、验收目录 | 归属、任务绑定、有效证据与闭环 |
| `/Users/kwang/apexcn-forums` 及最新社区工作副本 | 独立服务器任务独占修复，CLI 任务不修改 |

服务器子项目必须在其仓库保存独立实现计划、API 审计、部署和同样本 Chrome／API 证据。统一验收在本文收口。

## Acceptance Conditions

验收文件 `docs/reports/2026-10-05-community-multilingual-upgrade-acceptance.json` 必须逐项记录 status、assertion、threadId 和 evidence。只有以下 **20/20 PASS、零开放问题、零残留** 才算 100%；没有 N/A 替代这 20 项。

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
| A17 | ask 成功返回符合公开契约且来源可追溯；privacy/rules、stats 和管理员聚合允许／拒绝路径有受控权限证据，不用网络失败替代验收。 |
| A18 | 全部适用固定基线和上述动态场景有首次记录、原始输出 hash、明确语义断言；冻结候选身份与可见新手任务验证正确，失败／阻塞数为零。 |
| A19 | DEV 样本及收藏订阅全部删除，最终个人样本列表／marker 搜索零残留；浏览器关闭、临时凭据副本删除、原账号配置保留。 |
| A20 | build、全本地测试、check:release 通过；版本、commit、tag、发布包与 hash 一致，推送和 GitHub Release 已核对，活动问题闭合、交付报告完整。 |

### Task 1: Server audit and page repair

**Files:** 服务器任务负责其独立计划及 `docs/reports/2026-10-05-cli-multilingual-server-acceptance.md`；CLI 任务记录 scope 与 binding。

**Interfaces:** Consumes 报告与 COMMUNITY-I18N-20261004-003 首次截图；Produces 明确 lang 端点列表、内容回退行为、修复提交、DEV／TEST／PROD 同样本证据和 cleanup。

- [ ] Step 1: 新建服务器可见任务，核对最新提交 393d1b2 和应用边界，保存其修复计划。有效任务 `01a107c0-9b1c-70b0-af4f-91579ef6871d`；前一启动任务因沙箱 Git 元数据审批停住，已归档且不纳入交付，改用有现有授权的 CLI 执行器。
- [ ] Step 2: 读取最新 OpenAPI 的 ContentLanguage 引用并对照部署，记录 `/categories`、`/category-stats`、`/me/topics`、`/me/replies`、`/me/favorites`、`/me/favorites/export`、`/me/subscriptions`、`/me/search`、`/search`、`/topics`、`/topics/{id}`、`/topics/{id}/visual`。仅在该审计确认后冻结 CLI 语言范围。
- [ ] Step 3: 服务器任务以本轮 DEV 样本复现切换缺陷，写失败回归、最小修复与通过记录，保存实际 SQL／APEX／JS 补丁、部署命令和截图；CLI 任务只审查其实际产物。
- [ ] Step 4: 核对 A01、A14、A15 所需同样本读回、原稿回退、页面登录与非登录证据，并审查管理员／ask 路径 A17 所需测试权限，不用普通账号拒绝代替管理员成功路径。

### Task 2: Contract compatibility

**Files:** Modify `src/core/capability-compatibility.ts`; Test `test/capability-compatibility.test.ts`。

**Interfaces:** Consumes `assessCapabilityCompatibility(value: unknown, requiredCapabilities: string[])`; Produces 同签名并加入已验证版本，`ok/status/missingCapabilities/issues` 不变。

- [ ] Step 1: 加入以下失败测试，并将原有窗口长度断言改为 7，negotiationMode 为一个 versioned 和六个 legacy。

```ts
test("accepts the deployed multilingual contract", () => {
  const value = { ...inventory("0.10.0-candidate"),
    supportedContractVersions: ["0.10.0-candidate", ...SUPPORTED_API_CONTRACT_VERSIONS] };
  expect(assessCapabilityCompatibility(value, ["personal-community"]).ok).toBe(true);
  expect(assessCapabilityCompatibility(value, ["notifications"]).status).toBe("missing-capability");
});
```

- [ ] Step 2: 独立开发验证任务运行 `npx vitest run test/capability-compatibility.test.ts`，预期新增测试 FAIL；保留失败输出。
- [ ] Step 3: 在 SUPPORTED_API_CONTRACT_VERSIONS 首项加入 `"0.10.0-candidate"`，错误窗口文本加入 `0.10`；保持 requestId、entry、广告窗口和 requiredCapabilities 检查不变。
- [ ] Step 4: 同独立开发任务再运行该文件，预期全 PASS；随后记录精确修改并提交 `fix: accept verified multilingual API contract`，不包含他人改动。

### Task 3: Scoped content-language transport

**Files:** Create `src/core/content-language.ts`, `test/content-language.test.ts`; Modify `src/core/request-context.ts`, `src/index.ts`, `src/http.ts`。

**Interfaces:** Produces `ContentLanguage = "zh-cn" | "en"`, `parseContentLanguage(value: string): ContentLanguage`, `currentContentLanguage(): ContentLanguage | undefined`, `setCurrentContentLanguage(language: ContentLanguage | undefined): void`, `contentLanguageQuery(path: string, method: string | undefined, query?: RequestJsonOptions["query"]): RequestJsonOptions["query"]`；request context 内 operation 和 language 分离。

- [ ] Step 1: 添加 helper 回归测试，覆盖英语仅传支持 GET、显式 query.lang 优先、POST/ask/capabilities 不传、缺省不传、非法值拒绝、并发隔离。最小可执行测试如下，其余公开命令断言在同文件按实际接口补足。

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

- [ ] Step 2: 独立开发任务运行 `npx vitest run test/content-language.test.ts`，预期缺少 module／接口失败。
- [ ] Step 3: 在 request-context 添加可选 `language?: ContentLanguage` 及两个 accessor，沿用现有 AsyncLocalStorage。新 helper 的完整值解析为：

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
- [ ] Step 4: index 在公开读取命令注册 `.option("--lang <language>", "content language: zh-cn or en (default zh-cn)", parseContentLanguage)`，精确命令为 category.list、stats.category、search、topic.list/recent/view、me.dashboard/search/topics/replies/favorites/subscriptions、research、rag.retrieve、collection.build/favorites。preAction 将 actionCommand.opts().lang 写入当前 context，每次 parse 前清空这些命令 lang 的旧值。http 使用 `addQuery(joinUrl(baseUrl, path), contentLanguageQuery(path, options.method, options.query))`。
- [ ] Step 5: 独立开发任务测试 public help/manifest、非法参数零请求、两次 parse 不泄漏语言、并发中英读、research/rag 每个子请求使用同语言；预期 PASS。提交 `feat: propagate scoped content language through CLI reads`。

### Task 4: Derived evidence and offline collections

**Files:** Modify `src/commands/content.ts`, `src/commands/collection.ts`, `src/schemas/registry.ts`; Test `test/content-language.test.ts` 和现有 collection／rag 测试。

**Interfaces:** Consumes 当前上下文语言；Produces `collection.source.contentLanguage?: ContentLanguage`（旧文件省略按中文），派生 topic/evidence 的 `contentLanguage/translationStatus` 为服务器原值，不翻译。

- [ ] Step 1: 写英文 build→sync 的回归：mock server 返回中英不同正文，英文 build 后无 lang sync 必须仍请求 en；旧集合省略 source.contentLanguage 必须请求 zh-cn；source.contentLanguage=fr 验证拒绝。独立开发任务先运行新增测试，预期 FAIL。
- [ ] Step 2: build 和 favorites 的 source 写 `contentLanguage: currentContentLanguage() ?? "zh-cn"`；sync 详情请求写 `query: { lang: loaded.collection.source.contentLanguage ?? "zh-cn" }`；ValidCollection.source 加可选 ContentLanguage，isValidCollectionSchema 仅允许 undefined/zh-cn/en。
- [ ] Step 3: favorites 人工构建 topic 时复制 `contentLanguage: item.contentLanguage` 和 `translationStatus: item.translationStatus`；researchTopicFromData 和 appendTopicEvidence 复制对应源对象字段，query/provenance 写当前请求语言。原文 body/title 不变。
- [ ] Step 4: COMMON_PROPERTIES 加 `contentLanguage: { enum: ["zh-cn", "en"] }`、`translationStatus: { enum: ["CURRENT", "STALE", "MISSING"] }`；集合语言位于源元数据，不破坏旧 schemaVersion 1/2。实际回复保持原文而非伪造英文标签。
- [ ] Step 5: 独立开发任务运行 `npx vitest run test/content-language.test.ts test/collection.test.ts test/collection-m070.test.ts test/rag.test.ts test/contract`，预期全 PASS；审查 canonical hash 包含实际 topic 语言字段，export/import 保留 source，提交 `feat: preserve collection language and translation provenance`。

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
- [ ] Step 2: 完整适用固定基线与 A02—A17 专项执行，首次尝试原始输出 SHA 保留，公开 CLI 操作和对照 HTTP 分开；写回必须真实 Chrome 识别同样本，管理员成功路径使用受控专用角色，权限不足必须修复测试前置而非 N/A。
- [ ] Step 3: 任何功能失败按 CLI／服务端／环境归属处理；CLI 修改后重新冻结并新建验收任务，服务端缺陷交服务器任务修复；旧失败不能改成首次成功。限次网络重试后仍不满足就保持未通过并继续诊断。
- [ ] Step 4: 独立 cleanup 后核对数据零残留、私有副本删除、Chrome 关闭，记录 A18/A19；builder 按有效证据自查，不运行本会话用户模拟。
- [ ] Step 5: 全适用功能 PASS 后按发布脚本生成包和校验材料，提交、推送 main 与 v1.2.0 tag，直接 GitHub Release 发布，不启动 Actions；核对真实远端 commit/tag/assets hash。活动问题闭合与 `npm run check:roadmap` 必须通过，完成 A20。
- [ ] Step 6: 输出 acceptance.json 20 项全部 PASS 与中文完成报告；若真实未完成，明确未通过项并继续工作，禁止提前宣称 100%。

## Self-review

A01/A14/A15 属于服务端任务；A02—A09 属于 CLI 实现；A10—A19 属于独立验收；A20 属于版本发布。报告中所有确认缺陷与待验证范围已对应条件。历史 GA／Windows 不升级为本次条件；各接口名与本文代码一致，未指定任何未知函数。当前授权已要求执行，无需再询问执行方式。
