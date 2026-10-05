# Query Language Release Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 当前主会话协调执行；服务端和独立验收使用仓库指定的用户可见 Codex Desktop 任务。

**Goal:** 完成中文问题返回中文、其他问题返回英文的 CLI 修复，使文章标题、正文、问答引用和打开后的页面语言一致，并完成独立验收、精确清理、生产部署、1.2.1 发布、安装验证和交接。

**Architecture:** CLI 从原始当前问题确定语言，服务端选择已有语言版本并生成绑定语言的完整签名链接。先恢复可验证的运行环境、核实服务端，再冻结 CLI 发布候选；独立新手仅使用冻结候选和公开接口验收，全部通过后部署生产并发布相同资产。当前修复是一个跨仓库闭环，三个责任域有依赖，不拆成互相独立的产品计划。

**Tech Stack:** TypeScript、Node.js、Vitest、Oracle PL/SQL、APEX、ORDS、SQLcl、真实 Google Chrome、Git、GitHub CLI、Codex 原生目标模式。

## Global Constraints

- 用户规则：“中文提问返回中文，其余的提问一律返回英文thread标题(打开后也应该对应英文的正文内容)”。
- “Do not use `2.0.0` or higher unless the user explicitly authorizes a breaking major release.” 本轮目标版本为尚未发布的 `1.2.1`；若版本已被他人发布，先核实并使用下一个未占用的兼容补丁号，更新全部冻结证据。
- “Keep server changes in `apexcn-forums`, CLI implementation here, and independent evidence in the validation project.”
- “Do not mask missing server capability with CLI-only fallbacks.” 不客户端翻译文章，不修改普通用户原文、回复或代码字面量。
- “Every validation round creates a fresh independent novice task thread in that project.” 独立任务 cwd 精确为 `/Users/kwang/Documents/Codex/2026-10-04/apexcn-cli-test-r5`，模型 `gpt-5.6-luna`，reasoning `high`；不得以隐藏子代理替代。
- 服务端主任务 `01a10a92-ec48-7b70-b4c9-8b7c5c6a718e`，cwd `/Users/kwang/apexcn-forums`，模型 `gpt-5.6-terra/high`；已有授权持续有效。
- “The release commit must end with `[skip ci]`” 和 “do not run `gh workflow run`”。直接 `gh release create`，发布后校验下载的全部资产。
- 保留用户修改的 `AGENTS.md`、未跟踪 `docs/agents/` 和他人改动；只按明确文件路径暂存。禁止强制推送、重写旧 tag、假装旧候选对应新提交。
- 故障诊断先证据后修复；不因 ORA-00942 猜测性授予 DBA、SELECT ANY TABLE 或共享角色权限。共享设施修改须有实际根因、最小范围、可恢复备份和回滚命令。
- 所有凭据仅在受控进程内读取 Keychain 或既有连接配置；不得写入报告、命令参数、提交或模型输出。
- 不把 EXCLUDED、空列表、退出码 0、静态检查、环境失败或历史成功计作当前业务 PASS。
- 原始首次尝试不可覆盖；每个重试用新 label，记录原因和实际结果。相同故障最多一次有依据的重试，随后改做诊断或独立工作。
- 当前补丁目标不激活其他路线图里程碑，尤其不重新激活历史 `0.9 timeboxed`。

---

## 当前基线与文件责任

所有相对路径均以 `/Users/kwang/apexcn-cli` 为根，服务端路径另写绝对路径。

| 文件/目录 | 责任 |
|---|---|
| `docs/superpowers/plans/2026-10-05-query-language-release-closure.md` | 当前计划、验收条件、执行勾选 |
| `reports/query-language/goal-20261005/acceptance.json` | G1–G9 状态、证据路径；pending 不能当 pass |
| `reports/query-language/goal-20261005/runtime-readiness.json` | 当前运行健康、真实根因、恢复/回滚、API/Chrome 前置证据 |
| `reports/query-language/goal-20261005/candidate.json` | 新发布提交、版本、11 个资产 SHA、服务端源码 SHA、实际本地测试出处 |
| `reports/query-language/goal-20261005/cleanup.json` | 旧两主题、两会话、新夹具、临时密钥/审计/幂等记录的精确清理证明 |
| `reports/query-language/goal-20261005/release-verification.json` | 双仓库提交、远端 tag、发布、下载 SHA、安装后冒烟 |
| `reports/query-language/goal-20261005/iteration-summary.json` | context:compact 的真实交接输入 |
| `issues.json`、`roadmap.json` | 问题状态及已证实的 readiness risk；历史首证留存 |
| `src/core/content-language.ts`、`src/core/errors.ts` | 现有语言选择和错误码实现；只有新证据证明缺陷时才修改 |
| `test/content-language.test.ts`、`test/content-language-ask.test.ts`、`test/content-language-commands.test.ts`、`test/content-language-collections.test.ts` | 既有语言回归；代码变化才添加具体失败用例并重跑 |
| `/Users/kwang/.codex/worktrees/community-i18n-server-20261005/export/dev@oci/f102/db/packages/{specs,bodies}/` | 服务端既有工作树中 APEXCN_FORUM_PKG、APEXCN_RAG_PKG 修复源码；由服务端任务拥有 |
| `/Users/kwang/Documents/Codex/2026-10-04/apexcn-cli-test-r5/round-1.2.1-04/` | 下一轮首次证据、冻结清单、作用域、报告、真实 Chrome 截图；已存在则使用下一个全新编号 |
| `reports/iteration-context.json` | 发布后生成并提交的可恢复交接 |

第三轮只作历史证据：提交 `5aee7c5f0a9d53dc02eaa5e4f75443006753a7ac`，包 SHA `ae0bfe58eab94011c1237fe6fa51a92c486c92111642a5fd0e796f117cf9b74a`；本地 861 PASS/1 既有 skipped；独立基线 71/77 PASS、动态 12/20 PASS。剩余 DEV 主题 36975/36976、两个受保护会话引用、审计及幂等清理未完。三条夹具已删除，不能原样续用第三轮环境冻结。第三轮发布提交没有 `[skip ci]`，目标模式下须新建发布提交及新资产，不改第三轮记录。

## 完成条件：全部 G1–G9 必须为 pass

| 门禁 | 可判定的验收条件 | 必需证据 |
|---|---|---|
| G1 运行前置 | DEV/TEST 真实鉴权读取得到正确业务 JSON；TEST 不再在进入 handler 前 500；DEV 有用问答完成；受控真实 Chrome 能登录并显示文章 | HTTP 状态/requestId、SQL 主体和对象状态、实际页面文本与截图；恢复依据、最小变更和回滚（如有） |
| G2 语言合同 | 中文→zh-cn；英语/法语/西语/日语/韩语/纯技术词→en；显式覆盖优先；中文历史不改变英文当前问题；列表在分页前排除缺少所选版的文章；详情缺版明确不可用；STALE 同语言透明可读 | 实际 DEV API 请求响应，20 个 LANG 场景的对照；不以空引用证明正文语言 |
| G3 候选 | 发布提交后缀 `[skip ci]`；版本一致、源码干净、全部结构/候选门通过；11 资产和 server SHA 冻结；适用本地测试通过 | candidate.json、构建/检查日志、SHA 清单；复用旧测试须证明运行源码及依赖未变 |
| G4 独立验收 | 新可见任务身份/model/cwd/候选 SHA 匹配；完整 202 基线逐条归类，其中 77 必验全部 PASS，125 排除不计 PASS；LANG-01..20 全部 PASS；零 FAIL/BLOCKED/NOT_VERIFIED/漏项 | scope/manifest/intake、before-action 首证、输出、语义逐项断言、真实 Chrome 英中页面与相反偏好截图；如范围变化须事前冻结并说明，不能为失败减项 |
| G5 TEST | 同一服务端源码在 TEST 实际 API 和 Chrome 标题/正文/链接语言全部通过；包有效且无本次新增编译错误 | TEST 部署收据、源码 SHA、ALL_OBJECTS/错误、HTTP 和截图 |
| G6 PROD | 仅在 G4/G5 通过后部署；PROD 真 API/Chrome 中文及英文和相反偏好通过；App100 中文 RELEASE_NOTES；服务端正常版本发布完成 | PROD 范围/备份/部署/回滚、截图和请求、服务端 commit/push/release |
| G7 清理 | 旧36975/36976主题、两精确会话及本轮新建数据/会话/临时密钥和需清理的自有审计/幂等记录均有实际零残留证明；原账号/配置保留 | 身份 guard、精确 ID 清单、DELETE/NOT_FOUND 与 DB 数量；无权限/超时不算零 |
| G8 发布与安装 | CLI main 非强推已含发布提交；tag 指向确切验收提交；正式 GitHub Release 有全部11资产；下载 SHA/provenance/tag 一致；实际安装升级后版本正确、英中生产冒烟通过 | 远端 Git、Release 元数据、下载哈希、安装前后配置一致及实际 CLI 输出 |
| G9 收口 | 两活动问题按发布证据移出活动集并保留历史；enhancement 完成；最终 GA/roadmap 通过；交接提交已推送；目标只在此后 complete | 问题历史、最终检查日志、iteration-context.json、审计 commit/远端证明 |

### Task 1: 恢复可验证环境并清理旧残留

**Files:** Read `reports/query-language/test-runtime-external-blocker.json`、`server-r3-fixture-cleanup.json`、`round3-controller-session-cleanup-status.json`；Create `reports/query-language/goal-20261005/runtime-readiness.json`、`cleanup.json`。服务端任务拥有恢复操作。

**Interfaces:** Consumes 第三轮真实失败及受控连接引用；Produces G1 实际健康证据、旧残留精确清理结果及新根因记录。根因未证明时不产生假想 SQL 修复。

- [ ] **Step 1: 刷新一次当前状态。** 读取原生服务端任务状态；经既有受控配置执行以下只读检查，每条连接设置限时，失败保留到本轮新路径：

```bash
cd /Users/kwang/.codex/worktrees/community-i18n-server-20261005
APEX_CONN_JSON_FILE=/Users/kwang/apexcn-forums/.conn.json tools/sql_as.sh dev@oci 102 -c "select sys_context('USERENV','SESSION_USER'),sys_context('USERENV','CURRENT_SCHEMA') from dual"
APEX_CONN_JSON_FILE=/Users/kwang/apexcn-forums/.conn.json tools/sql_as.sh test@oci 900 -c "select sys_context('USERENV','SESSION_USER'),sys_context('USERENV','CURRENT_SCHEMA') from dual"
APEX_CONN_JSON_FILE=/Users/kwang/apexcn-forums/.conn.json tools/oci_docker_exec.sh apexcn@oci oracle26 'uptime'
```

预期分别确认 DEV/TEST 实际主体和可用连接；命令失败只能记失败，不用名称推断环境。不得打印 `.conn.json`。

- [ ] **Step 2: 诊断 TEST 原始 ORA-00604/00942。** 用已授权维护连接执行已有 `/tmp/query-language-controller-ords-context-readonly.sql`；若临时文件不存在，服务端任务按以下完整 SQL 重建在本轮报告目录再执行：

```sql
set define off
set echo off
set pagesize 100
set linesize 220
select object_owner, object_name, policy_name, pf_owner, package, function, enable
from dba_policies
where object_owner='ORDS_METADATA'
and object_name in ('ORDS_SCHEMAS','USER_ORDS_MODULES','USER_ORDS_HANDLERS');
select owner, trigger_name, status, triggering_event, base_object_type
from dba_triggers where triggering_event like '%LOGON%' order by owner,trigger_name;
select owner, object_name, object_type, status from all_objects
where owner in ('DEV','TEST','APEXCN')
and object_name in ('APEXCN_FORUM_PKG','APEXCN_RAG_PKG') order by owner,object_name,object_type;
exit
```

关联原始 ECID `3ZA4z9m8K4NgkxIkpFfVaA` 的 ORDS 日志，查失败 SQL 的实际主体/代理上下文；对照能进入 handler 的 DEV 请求。把结果写为事实/尚未证明两部分。

- [ ] **Step 3: 根据实证修复连接或 TEST 前置。** 修改前把确切目标、现值、恢复文件、最小修改命令、回滚命令写入 `runtime-readiness.json` 的 `repair` 对象，由主会话核对后在现有授权内执行。若涉及产品源码，先向本计划追加含完整差异和失败回归的独立修复任务，再实现；不能将未知根因写成确定 grant。相同连接失败一次有据复试后转另一既有安全路线或独立工作。
- [ ] **Step 4: 精确清理旧主题。** 由服务端任务重读 36975 的 zh-cn、36976 的 en，断言 `createdBy=3848` 及第三轮唯一 marker；重放 `reports/query-language/apexcn-dev-r3-api-cleanup-results.json` 保存的原 operationKey/payloadHash，DELETE 后原可读语言须为真实 `404 NOT_FOUND`。语言不可用 404 不算删除证明。
- [ ] **Step 5: 清理两精确会话。** 主会话仅在 `round-1.2.1-03/private/browser-sessions/` 读取对应保护引用；使用既有 `cleanup-round2-sessions.py` 的身份/workspace guard 方法，绑定本轮实际两引用执行 `apex_session.delete_session` 并查询 remaining=0，再移除引用。私密 SQL 0600、进程内传入、结果仅输出数量；不得把 SID 写到报告或工具参数。服务端查询对应自有审计/幂等残留并精确清理，不删除业务审计全集。
- [ ] **Step 6: 复测实际服务。** 使用既有 opaque DEV bridge 在新报告路径执行 `search APEX --lang en --page-size 1 --json`；TEST 由服务端用受控身份执行对应 API；补一次真实 DEV `ask "How do I use APEX_AI.GENERATE in Oracle APEX 26.1?" --top-k 3 --json`，单进程 `APEXCN_HTTP_TIMEOUT_MS=180000`。必须有有用英文答案和真实英文来源，180秒 HTTP000 不能通过。登录真实 Chrome 读取文章，确认正文后截图，关闭并清理自身会话。达到 G1 后结束本任务。

### Task 2: 完成服务端合同与 TEST 验证

**Files:** 服务端既有 FORUM/RAG spec/body、`export/dev@oci/f102/db/tests/`、对应 `export/test@oci/f900/`；Create `reports/query-language/goal-20261005/server-contract.json`、`test-acceptance.json`。

**Interfaces:** Consumes G1、原始中文/英文规则；Produces 实际合同、同一服务端源码 SHA 和 G2/G5 证明。

- [ ] **Step 1: 对照实际源版本。** 核对第三轮 FORUM SHA `a546db4319114323d2d72352234817e67a9d150d53c040ad3983dcbda7c778c4`、RAG SHA `6f81641d0ac0d3dd9a9b256bd69359abf0997485b7f0638a6643cee802c48582` 与工作树及数据库；有漂移就先说明归属，不覆盖他人版本。
- [ ] **Step 2: 完成实际合同矩阵。** 用 `dynamic-cases-round3-draft.json` 的全部20场景核对：自动语言/覆盖、研究重试、历史上下文、游标、CURRENT/STALE/缺版、收藏 THREAD/POST。有用问答至少包括英文、中文、英文问题加中文历史三例，正文与引用逐项检查。缺版列表不能先分页再丢弃；详情返回明示不可用。
- [ ] **Step 3: 修复仅实证缺陷。** 若存在新产品缺陷，服务端先记录失败请求和责任；为确切 SQL/代码差异补充完整代码计划及失败回归，再改最小实现。CLI 侧不加翻译兜底；代码变化使旧冻结失效，后续重新冻结。
- [ ] **Step 4: TEST 范围部署并真页测试。** 服务端按仓库原生部署流程只部署实际改变对象；记录前后对象/源码、USER_ERRORS 和实际环境主体。使用 App900 真实接口及 Chrome：英文 URL 在中文偏好下标题/正文仍英文；中文 URL 在英文偏好下仍中文；保留完整 cs 与 lang。两方向均有正文和截图才记 G5 pass。
- [ ] **Step 5: 新 DEV 验收夹具一次准备齐全。** 同一专用账号，独立新 marker：CURRENT、STALE、缺英文、英文原文缺中文，加双语主题/原文回复和 THREAD/POST 两种收藏；精确记录 ID、语言状态、来源 hash、清理脚本。不得让独立验收从空收藏推断成功。准备完再冻结环境。

### Task 3: 准备符合目标模式的发布提交与新冻结候选

**Files:** 本计划、`issues.json`、`package.json`、`package-lock.json`（版本确需变化才改）；Create 本轮 `candidate.json` 与 `frozen-release-assets/`。不暂存用户的 AGENTS.md 或 docs/agents/。

**Interfaces:** Consumes G2/G5 合同及 CLI 已有实现；Produces G3，供新验收精确绑定的提交、资产和环境身份。

- [ ] **Step 1: 核实版本占用和远端。** 读取 `gh release view v1.2.1 --repo wfg2513148/apexcn-cli` 及远端 main；仅“tag不存在”算未发布，网络失败不能算不存在。若未发布继续1.2.1；如已被他人占用，核对再选下一个补丁号并用 `npm version --no-git-tag-version` 同步锁文件，不覆盖 tag。
- [x] **Step 2: 准备发布提交。** 在当前 CLI checkout 建任务分支（已有同名则先核对，不重置），保留他人工作区。提交仅本次计划和问题进度，确有新增实现则逐个加入其源/测试文件。命令：

```bash
cd /Users/kwang/apexcn-cli
git switch -c fix/query-language-goal-20261005
git add docs/superpowers/plans/2026-10-05-query-language-release-closure.md issues.json
git commit -m "fix: prepare query-language release closure [skip ci]"
npm run check:roadmap
```

预期受控提交消息以 `[skip ci]` 结尾，问题仍开放；不 amend 第三轮提交。
- [x] **Step 3: 验证源码变化范围。** 对比旧测试提交的 `src/`、`test/`、依赖及 tsconfig；均未变化可沿用已核对的861项记录。任何运行代码/依赖修改则先跑新增失败回归，再运行 `npm test` 和 `npm run build`；失败必须归因并修复，不能把既有 skip 改 PASS。
- [ ] **Step 4: 从新提交干净构建。** 用独立干净构建 checkout，checkout 本任务实际发布提交。执行：

```bash
npm ci --ignore-scripts --prefer-offline
npm run build
node scripts/check-release-version.mjs
node scripts/check-release-artifacts.mjs --expected-version 1.2.1
node scripts/check-workflows.mjs
node scripts/check-source-layout.mjs
node scripts/check-roadmap.mjs
node scripts/check-ga-readiness.mjs --candidate
```

若 Step1 实际版本变化，所有命令和文件中的版本一次同步后再执行。复制生成的完整11资产到 `reports/query-language/goal-20261005/frozen-release-assets/`，逐个 SHA；`release-provenance.json` 必须指实际干净提交。candidate 模式只允许尚未完成验收的已登记问题，不等于最终 GA 通过。
- [ ] **Step 5: 冻结新作用域。** 新编号目录保存 candidate、77 required/125 excluded 的202基线归类、20LANG场景、数据集/评分器版本、环境/服务器 SHA、新 fixture、公共材料和禁止动作；记录全部 SHA。桥接启动器 ROOT 必须绑定自身新轮路径，`--bridge-info` 与包 SHA一致。新冻结后不得原地覆盖。

### Task 4: 全新独立新手验收

**Files:** 新轮 `scope-contract.json`、`frozen-input-manifest.json`、`intake.json`、`first-attempts.jsonl`、`baseline-results.jsonl`、`dynamic-results.json`、`report.json`、`screenshots/`、`cleanup.json`。

**Interfaces:** Consumes G3 不可变候选和 G1/G2/G5 前置；Produces G4 与新发现的可追溯证据。

- [ ] **Step 1: 原生新建可见任务。** 使用已登记的验收 project；实际任务 cwd 必须精确为测试项目，model `gpt-5.6-luna`、thinking `high`。主会话读取运行身份而非只信提示词。任务只读公开 CLI/help/schema/允许资料，不读实现、旧轮报告、记忆或内部技能，不自行修复。
- [ ] **Step 2: 验收开始前 intake。** 独立记录版本、source commit、包 SHA、scope SHA、environment SHA、身份和材料清单；任一不符先修复设施再开始，已有尝试保留。
- [ ] **Step 3: 完整运行并逐项判定。** 全部77 required和LANG01..20开始前先写 recorder；成功需要实际用户结果而非命令0。中文、英文、其他语种及上下文对照；有用问答必须核对真实引用标题/正文/URL；个人范围必须有正例。
- [ ] **Step 4: 真实 Chrome 语义验收。** 独立打开 CLI 返回完整URL，两种语言各在相反偏好下确认标题、可读正文、菜单切换与重新打开；真实像素截图和页面文本对照。只到登录/等待正文/无截图不得 PASS。操作设施需改时保留失败并冻结新设施；若候选改变，结束本轮并新建下一轮。
- [ ] **Step 5: 审查与修复循环。** 主会话核对全部77+20、排除125和首证覆盖；真实新发现才入 issues。修复后新候选和新可见新手任务，不能把自测替换独立通过。最终 report 必须零 fail/blocked/not_verified/not_run，G4 才 pass。

### Task 5: 生产验证与所有自建状态清理

**Files:** Create `reports/query-language/goal-20261005/production-acceptance.json`、更新 `cleanup.json`；服务端相关生产源、App100发布说明和正式发布记录。

**Interfaces:** Consumes G4+G5 pass；Produces G6+G7、服务端正式 commit/push/release。

- [ ] **Step 1: 部署前确认。** 核对最新 PROD 基线、仅本次改变对象与 TEST 验证源码同一 SHA；准备现有正式备份和精确回滚，不把 SELECT 输出当备份。
- [ ] **Step 2: 服务端范围部署。** 原服务端任务按生产 bugfix 流程部署并立即核对 App100 `ALL_OBJECTS OWNER='APEXCN'`、编译错误及实际 API。
- [ ] **Step 3: PROD 实际端到端。** 真实 Chrome 读现有文章；中文/英文 CLI 问题和有用问答均对应标题、正文、引用及打开页面；相反浏览器/账号偏好不覆盖 URL 指定语言。生产不写社区测试帖子。
- [ ] **Step 4: 精确 cleanup。** 关闭自身 Chrome，核对并删除自己新旧临时主题、回复、收藏、订阅、保护会话、临时API密钥及协议要求的自有审计/幂等记录；DB和API对应证明0。删除前校验 user3848/marker/ID，保留既有账号及配置。尚存一项或不可核实即 G7不通过。
- [ ] **Step 5: 服务端收口。** App100 RELEASE_NOTES 使用简体中文，技术提交、非强制 push 和仓库正常兼容补丁 Release 完成；记录真实版本/commit/tag/URL，不预设并发发布后的版本仍是3.0.2。

### Task 6: 发布相同 CLI 资产、实际升级和目标闭环

**Files:** `release-notes-v1.2.1-draft.md`、本轮 `release-verification.json`、`iteration-summary.json`、`issues.json`、`roadmap.json`、`reports/iteration-context.json`。

**Interfaces:** Consumes G1–G7 pass；Produces G8/G9、可追溯正式发布和目标完成状态。

- [ ] **Step 1: 发布前复核身份。** 读取 candidate.json 里实际 releaseCommit，断言当前版本、tag未占用、远端main可非强推前进；若合并引入运行变化回到 Task3，新冻结并新验收，不移动旧冻结 SHA。
- [ ] **Step 2: 推送与正式发布。** 在受控发布 checkout 精确 checkout 已验收提交，运行以下命令；只有网络已证代理故障才使用取消代理环境或SSH的已有安全路线：

```bash
git push origin HEAD:main
git tag v1.2.1
git push origin v1.2.1
gh release create v1.2.1 /Users/kwang/apexcn-cli/reports/query-language/goal-20261005/frozen-release-assets/* --repo wfg2513148/apexcn-cli --verify-tag --title v1.2.1 --notes-file /Users/kwang/apexcn-cli/reports/query-language/release-notes-v1.2.1-draft.md
```

只能上传清单中11个最终文件，目录不得混入日志。版本若经Task3调整，以更新后的计划为准。发布失败不关闭issues。
- [ ] **Step 3: 下载验证。** `gh release download v1.2.1 --repo wfg2513148/apexcn-cli --dir reports/query-language/goal-20261005/downloaded-release`；逐文件对照 candidate SHA、provenance sourceCommit与远端tag，运行 `node scripts/check-release-artifacts.mjs --verify-only --expected-version 1.2.1 --artifacts-dir reports/query-language/goal-20261005/downloaded-release`，必须退出0。
- [ ] **Step 4: 实际升级。** 先对现有用户配置做私密备份/哈希，执行现有官方 `apexcn update`，再 `apexcn --version`；真实 PROD `search` 英文问题、中文问题和文章详情/打开URL各一次，确认新安装实际使用1.2.1且配置未被覆盖。记录安装路径/版本/请求/截图；不以测试目录运行冒充用户安装完成。
- [ ] **Step 5: 问题关闭。** G1–G8证据齐全后，将两条活动问题完整归档到本轮历史记录，再从 issues 活动集移出，enhancement改completed并指向实际独立报告和release证据；保留最初失败文件。
- [ ] **Step 6: 最终质量与交接。** `npm run check:roadmap`、`node scripts/check-ga-readiness.mjs` 和资产 verify-only 均通过；不得重新打包已验收资产。交接输入必须有 `milestoneId:"1.1"` 及 enhancedCapabilities/unexpectedProblems/rootCauses/preventionActions/expectedResults/majorRisks 六个非空字符串数组和 nextMilestoneGoal字符串，内容取实际事实；nextMilestoneGoal明确“本补丁闭环，不激活后续里程碑”。

```bash
npm run context:compact -- --summary reports/query-language/goal-20261005/iteration-summary.json --release-url https://github.com/wfg2513148/apexcn-cli/releases/tag/v1.2.1 --offline
```

这里 offline 仅用于元数据审计提交晚于已验收tag的既有分离流程；Step3真实在线发布校验不可省略。在独立干净审计checkout生成交接，明确 releaseCommit与metadataCommit，不把 offline称在线核验。只提交本轮收口/交接文件，提交消息以 `[skip ci]` 结尾并非强推main；tag仍指验收源码。
- [ ] **Step 7: 完成目标。** 读取所有G1–G9，检查每个证据文件和实际语义、远端main/发行资产；未完成任一项禁止 `update_goal complete`。确实全部完成才更新目标完成并汇报真实版本、链接、验收和清理结果。

## 执行与阻断规则

用户已选择制定计划后自动启动目标模式，无需再询问执行方式。主会话使用 executing-plans 逐任务落实，原服务端任务负责服务端，新原生可见任务负责每轮独立验收。只完成当前补丁，不扩大到下个里程碑。

目标模式不因“计划写完”“代码已修”“临时网络失败”结束。每轮依据新事实推进可做工作；故障复现后限次重试，改做根因诊断、准备或收口，避免重复无变化轮询。仅当同一阻断连续三个目标回合反复出现且已无可推进工作、必须用户输入或外部状态改变，才按 Codex 目标工具规则标记 blocked，不能谎报 complete；恢复后重新开始阻断计数。

## 计划自查

- [x] 用户语言规则、缺版/历史/链接一致性均映射到 G2/G4/G6/G8。
- [x] 原始残留、真实Chrome、完整适用基线、新任务身份、发布同资产、安装升级和交接均有独立门禁。
- [x] 未引入无实证的产品重构或预先猜测的 ORDS 授权补丁；新缺陷须先补完整修复任务。
- [x] source commit、artifact SHA、scope SHA、environment SHA 分别记录；第三轮与新轮不混用。
- [x] 发布提交后缀规则与旧冻结不一致已明确通过新提交/新资产/新独立轮解决。
- [x] 不将历史timeboxed里程碑作为本补丁后续目标；没有未经授权的新功能目标。
