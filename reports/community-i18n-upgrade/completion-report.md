# apexcn-cli 1.2.0 多语言社区升级验收报告

状态：业务验收与真实发布完成，M1最终默认审计门通过，最终M2核对及 main 同步执行中。

按实际M1证据，必验升级条件55/55、适用基线192/192、聚合门20/20；总体完成仍等待最终M2独立核对与main同步，不提前宣称全目标100%。冻结范围为55项必验升级条件及192项适用基线，共247项；1项升级条件和10项基线在冻结前排除，未计入PASS，未扩大排除范围。

## 实现与独立验收

社区0.10契约兼容、16个适用读取命令的中英语言上下文，以及research/RAG/collection的语言元数据和完整性均已实现。话题和回复保留用户原稿，不自动翻译；缺译文按公开合同显示原稿。服务端修复保留在apexcn-forums，CLI未掩盖缺失服务端能力。

所有用户CLI模拟均在独立可见Codex会话执行。最终R5使用固定验证目录、gpt-5.6-luna/high、冻结C3/H3和范围；真实Chrome登录与匿名验收使用同样本，核对ID、版本、正文、代码、表格、emoji与原文回复。开发质量与新手验收分别取证，首次失败及重试均保留。

开发回归：824通过、1项既有跳过，共825测试；56测试文件通过。C3 build及候选质量门已通过。最终审计默认门另行在独立开发会话的干净审计克隆核对，不重建发布包。

## 首次与最终结果

R5首次原始自报为升级34 PASS、8 PARTIAL、3 BLOCKED、10 NOT_VERIFIED、1 EXCLUDED；基线192 PASS、10 EXCLUDED。独立批判审查拒绝将其当作最终验收：指出网络失败、批准执行、直接输出脱敏、真实Chrome与发布身份等证据缺口。后续实际补充与语义复审已完成全部192基线与52项发布前升级条件。首次数字是原始自报而非经过审查的完整通过数，不能用来宣称首次全部通过。

## 发布身份

Release：https://github.com/wfg2513148/apexcn-cli/releases/tag/v1.2.0

产品提交C3：14ff3bb5c79e9af6e5d8c6c161fc3a5ae02aae1b。原受验包H3：1a370947025fd2e801ba2d12afa5fcf210df3dd3365fa150cd1efc7ce4a1a1b2。远端标签准确指C3；原11个发布资产实际下载、逐个SHA256匹配，供应链sourceCommit一致，没有重新构建/打包。审计提交仅改变包外记录，与发布源码身份分开。

## 清理与验收边界

本轮自有话题、回复、收藏、订阅及marker已清零；已知精确会话与自动化Chrome进程为0，临时配置与handoff删除，原账号、Keychain与原配置保留。旧两个未知匿名session依据有效超时策略证明NON_REVIVABLE_BY_POLICY，不宣称其物理数据库行数为0。

DEV完成受控业务写入与清理；TEST仅证明服务端部署源码/编译有效，未宣称TEST HTTP业务验收；生产仅只读真实页面与API验证。历史空壳无法复现，未虚称已找到或修复其历史根因。受控管理员正向能力在冻结前未满足身份前提，明确排除；普通身份拒绝已验。

## 逐项升级条件

| 条件 | 聚合门 | 状态 | 断言 |
|---|---|---|---|
| UPG-001-scope-server-contract | A01 | PASS | 当前OpenAPI与部署能力窗/语言端点一致，缺口归属清晰 |
| UPG-002-cap-live-dev | A02 | PASS | DEV能力0.10兼容且required capability/endpoint可用 |
| UPG-003-cap-live-prod-readonly | A02 | PASS | 生产只读能力0.10兼容 |
| UPG-004-cap-legacy-unknown-malformed | A02 | PASS | 旧版本兼容、未知拒绝、坏结构与缺能力拒绝 |
| UPG-005-lang-public-surface | A03 | PASS | 16个lang命令及禁用命令表、manifest/help、thread别名一致 |
| UPG-006-lang-invalid-before-network | A03 | PASS | fr/空/大小写非契约值发请求前拒绝 |
| UPG-007-lang-default-repeat-concurrent | A03 | PASS | 缺省中文，重复parse和并发调用不串语言 |
| UPG-008-category-bilingual | A04 | PASS | 分类列表和分类统计zh-cn/en及元数据正确 |
| UPG-009-language-api-invalid | A04 | PASS | 只读API非法语言400 INVALID_LANGUAGE |
| UPG-010-search-bilingual | A05 | PASS | 全局中英搜索匹配选择正文并保留来源 |
| UPG-011-topic-read-bilingual | A05 | PASS | list/recent/view选择语言，原文代码表格emoji完整 |
| UPG-012-cursor-same-language | A06 | PASS | 同语言续页重放过滤，无重复 |
| UPG-013-cursor-cross-language | A06 | PASS | 跨语言续页400 INVALID_CURSOR_LANGUAGE |
| UPG-014-cursor-legacy-chinese | A06 | PASS | 旧游标仅中文可用，英文拒绝 |
| UPG-015-personal-topics-replies | A07 | PASS | 非空自有话题/回复列表、语言选择与权限字段正确 |
| UPG-016-personal-favorites-subscriptions | A07 | PASS | 非空收藏/订阅列表与回复/话题身份不混淆 |
| UPG-017-personal-dashboard | A07 | PASS | dashboard聚合保持语言与隐私 |
| UPG-018-personal-search-scopes | A07 | PASS | created/replied/favorited/subscribed逐scope非空检索正确 |
| UPG-019-research-language-provenance | A08 | PASS | 每个search/detail同语言，顶层响应语言、topic状态与来源保留 |
| UPG-020-rag-language-provenance | A08 | PASS | 检索不调用app ask，引用内容语言保留、回复原文不改 |
| UPG-021-collection-build-language | A09 | PASS | build保存请求语言、响应语言和翻译状态 |
| UPG-022-collection-favorites-language | A09 | PASS | favorites继承export响应顶层语言，回复收藏明确排除 |
| UPG-023-collection-sync-language | A09 | PASS | 英文sync重放en，不被中文默认覆盖 |
| UPG-024-collection-source-language-tamper | A09 | PASS | 清单语言正反篡改均在网络前拒绝 |
| UPG-025-collection-legacy-sync | A09 | PASS | 旧无语言集合旧hash有效，默认中文，sync自然升级元数据 |
| UPG-026-collection-offline-bundle | A09 | PASS | verify/index/query/stats/export/import/restore/automation保留语言与完整性 |
| UPG-027-write-own-topic | A10 | PASS | 话题create/update/delete预览确认、版本API读回与Chrome同样本识别 |
| UPG-028-write-own-reply-nested | A10 | PASS | 回复create/update/delete及嵌套回复API和Chrome同样本识别 |
| UPG-029-reply-answer-roundtrip | A11 | PASS | 答案mark/unmark公共预览确认及读回 |
| UPG-030-reply-favorite-roundtrip | A11 | PASS | 回复收藏add/remove公共预览确认及读回 |
| UPG-031-topic-favorite-subscription | A12 | PASS | 话题收藏订阅add/remove、非空个人列表和导出正确 |
| UPG-032-write-version-conflict | A13 | PASS | 陈旧version确认409且正文不被覆盖 |
| UPG-033-write-other-owner-denial | A13 | PASS | 其他所有者变更拒绝，无越权修改 |
| UPG-034-write-approval-integrity | A13 | PASS | 过期/篡改operation与bundle按公开安全合同拒绝，不把未执行观察当绕过 |
| UPG-035-page-same-topic-switch | A14 | PASS | DEV同话题zh/en/zh保留ID/正文/原文回复 |
| UPG-036-page-original-fallback | A14 | PASS | 缺译文新样本English仍显示原稿与原文回复 |
| UPG-037-page-existing-bilingual | A14 | PASS | 既有双语文章显示对应存储版本及状态 |
| UPG-038-page-auth-edited-content | A15 | PASS | 登录后修改真实Chrome识别同样本正文代码表格回复 |
| UPG-039-page-public-access | A15 | PASS | 公开内容未登录实际可见，不能把登录空壳算通过 |
| UPG-040-page-production-readonly | A15 | PASS | 代表性生产中英页面只读可见 |
| UPG-041-auth-doctor-local | A16 | PASS | 认证隔离/优先级/脱敏、doctor有效与坏JSON预期正确 |
| UPG-042-draft-review-local | A16 | PASS | 本地草稿/清单/恢复/导出导入/review合同正确 |
| UPG-043-schema-guide-workflow-local | A16 | PASS | 81Schemas与指南语言说明一致，workflow本地预览批准恢复正确 |
| UPG-044-ask-existing-contract | A17 | PASS | ask实际成功、引用可追溯，不新增回答语言或性能SLA |
| UPG-045-privacy-rules-advertised | A17 | PASS | privacy/rules与advertised可用性一致，unavailable原因公开可理解 |
| UPG-046-stats-existing-contract | A17 | PASS | 现有公开统计读取回归成功 |
| UPG-047-admin-ordinary-denial | A17 | PASS | 普通身份管理员端点拒绝与privacy/最小权限正确 |
| UPG-048-admin-controlled-positive | A17 | EXCLUDED | 仅已有受控DEV管理员只读身份被预先确认可用时正向聚合required |
| UPG-049-fresh-validator-intake | A18 | PASS | 新可见任务cwd/model/effort/novice/候选hash/scope身份齐全 |
| UPG-050-baseline-applicable-complete | A18 | PASS | 固定202基线所有适用case有语义证据，排除项冻结前明确 |
| UPG-051-first-attempt-integrity | A18 | PASS | 原始首尝试stdout/stderr hash及重试身份不可改写 |
| UPG-052-cleanup-owned-data | A19 | PASS | 本轮topic/reply/favorite/subscription清理，marker与个人样本列表0 |
| UPG-053-cleanup-local-browser | A19 | PASS | Chrome关闭/临时配置删除/原账号与原配置保留 |
| UPG-054-local-quality-gates | A20 | PASS | build/npm test/check:release适用门全部通过 |
| UPG-055-release-candidate-identity | A20 | PASS | tag指C、GitHub上传原H_C、供应链sourceCommit/hash一致 |
| UPG-056-issue-closure-metadata | A20 | PASS | M只审计元数据、不pack/tag，问题闭合与roadmap治理门通过 |

逐项thread、证据绝对路径与SHA见同目录验收JSON；首次完整原始归档及所有重试没有改写。

## 逐项适用基线

| 条件 | 冻结分类 | 最终语义裁定 | 预期结果 |
|---|---|---|---|
| M110-Q-001 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List public community admins |
| M110-Q-002 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List public community admins |
| M110-Q-003 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show administrator-only apexcn-cli operations aggregates |
| M110-Q-004 | excluded | EXCLUDED | Show administrator-only apexcn-cli operations aggregates |
| M110-Q-005 | excluded | EXCLUDED | Ask community RAG or scoped references |
| M110-Q-006 | excluded | EXCLUDED | Ask community RAG or scoped references |
| M110-Q-007 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Audit local auth profile configuration |
| M110-Q-008 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Audit local auth profile configuration |
| M110-Q-009 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List local auth profiles |
| M110-Q-010 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List local auth profiles |
| M110-Q-011 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Clear active auth profile |
| M110-Q-012 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Clear active auth profile |
| M110-Q-013 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Remove an auth profile |
| M110-Q-014 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Remove an auth profile |
| M110-Q-015 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Configure a file or environment API credential profile |
| M110-Q-016 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Configure a file or environment API credential profile |
| M110-Q-017 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Show active auth profile with redacted token |
| M110-Q-018 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Show active auth profile with redacted token |
| M110-Q-019 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Switch active auth profile |
| M110-Q-020 | required | ACCEPTED_BY_INSPECTED_TEXT_OR_REDACTED_AUTH_OUTPUT | Switch active auth profile |
| M110-Q-021 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List community categories |
| M110-Q-022 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List community categories |
| M110-Q-023 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Create an offline readonly automation plan |
| M110-Q-024 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Create an offline readonly automation plan |
| M110-Q-025 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Run an offline readonly automation plan |
| M110-Q-026 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Run an offline readonly automation plan |
| M110-Q-027 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Build a local collection |
| M110-Q-028 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Build a local collection |
| M110-Q-029 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Export a deterministic collection bundle |
| M110-Q-030 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Export a deterministic collection bundle |
| M110-Q-031 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Build a topic collection while explicitly excluding reply favorites |
| M110-Q-032 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Build a topic collection while explicitly excluding reply favorites |
| M110-Q-033 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Import a verified collection bundle |
| M110-Q-034 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Import a verified collection bundle |
| M110-Q-035 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Build a local collection search index |
| M110-Q-036 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Build a local collection search index |
| M110-Q-037 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Query a local collection index |
| M110-Q-038 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Query a local collection index |
| M110-Q-039 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Restore collection files from a verified bundle |
| M110-Q-040 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Restore collection files from a verified bundle |
| M110-Q-041 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show local collection index stats |
| M110-Q-042 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show local collection index stats |
| M110-Q-043 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Incrementally refresh collection topics |
| M110-Q-044 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Incrementally refresh collection topics |
| M110-Q-045 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Verify a local collection |
| M110-Q-046 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Verify a local collection |
| M110-Q-047 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Verify a deterministic collection bundle |
| M110-Q-048 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Verify a deterministic collection bundle |
| M110-Q-049 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Print command manifest |
| M110-Q-050 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Invalid operation confirmation fails closed without a write. |
| M110-Q-051 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Check installation, auth, and API reachability |
| M110-Q-052 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Check installation, auth, and API reachability |
| M110-Q-053 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Print local support snapshot |
| M110-Q-054 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Print local support snapshot |
| M110-Q-055 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Delete an active-profile saved draft |
| M110-Q-056 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Delete an active-profile saved draft |
| M110-Q-057 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Export active-profile drafts for migration |
| M110-Q-058 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Export active-profile drafts for migration |
| M110-Q-059 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Import drafts into the active profile |
| M110-Q-060 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Import drafts into the active profile |
| M110-Q-061 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List active-profile saved drafts |
| M110-Q-062 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List active-profile saved drafts |
| M110-Q-063 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Draft a local question |
| M110-Q-064 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Draft a local question |
| M110-Q-065 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Draft a local reply |
| M110-Q-066 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Draft a local reply |
| M110-Q-067 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Restore an active-profile saved draft |
| M110-Q-068 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Restore an active-profile saved draft |
| M110-Q-069 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Favorite a topic or preview favoriting a reply |
| M110-Q-070 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Favorite a topic or preview favoriting a reply |
| M110-Q-071 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Unfavorite a topic or preview unfavoriting a reply |
| M110-Q-072 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Unfavorite a topic or preview unfavoriting a reply |
| M110-Q-073 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show a curated APEX task guide |
| M110-Q-074 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show a curated APEX task guide |
| M110-Q-075 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show current account |
| M110-Q-076 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show current account |
| M110-Q-077 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Discover personal-workbench server capabilities |
| M110-Q-078 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Discover personal-workbench server capabilities |
| M110-Q-079 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show the current user's personal dashboard |
| M110-Q-080 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show the current user's personal dashboard |
| M110-Q-081 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List current user's favorites |
| M110-Q-082 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List current user's favorites |
| M110-Q-083 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read current user's inbox when available |
| M110-Q-084 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read current user's inbox when available |
| M110-Q-085 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read current user's notifications when available |
| M110-Q-086 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read current user's notifications when available |
| M110-Q-087 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read the authoritative privacy policy when available |
| M110-Q-088 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read the authoritative privacy policy when available |
| M110-Q-089 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List current user's replies |
| M110-Q-090 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List current user's replies |
| M110-Q-091 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read authoritative community rules when available |
| M110-Q-092 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read authoritative community rules when available |
| M110-Q-093 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Search only within the current user's personal dashboard |
| M110-Q-094 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Search only within the current user's personal dashboard |
| M110-Q-095 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show current user's stats |
| M110-Q-096 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show current user's stats |
| M110-Q-097 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List current user's subscriptions |
| M110-Q-098 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List current user's subscriptions |
| M110-Q-099 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List current user's topics |
| M110-Q-100 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List current user's topics |
| M110-Q-101 | required | ACCEPTED_BY_INSPECTED_RAG_EVIDENCE_BOUNDARY | Retrieve citable community evidence for a local AI |
| M110-Q-102 | required | ACCEPTED_BY_INSPECTED_RAG_EVIDENCE_BOUNDARY | Retrieve citable community evidence for a local AI |
| M110-Q-103 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview reply creation and return a confirmation id |
| M110-Q-104 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview reply creation and return a confirmation id |
| M110-Q-105 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview reply deletion and return a confirmation id |
| M110-Q-106 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview reply deletion and return a confirmation id |
| M110-Q-107 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview marking a reply as a correct answer |
| M110-Q-108 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview marking a reply as a correct answer |
| M110-Q-109 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview removing the correct-answer mark from a reply |
| M110-Q-110 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview removing the correct-answer mark from a reply |
| M110-Q-111 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview reply update and return a confirmation id |
| M110-Q-112 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview reply update and return a confirmation id |
| M110-Q-113 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Build a research bundle |
| M110-Q-114 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Build a research bundle |
| M110-Q-115 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Review local reply draft |
| M110-Q-116 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Review local reply draft |
| M110-Q-117 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Review local topic draft |
| M110-Q-118 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Review local topic draft |
| M110-Q-119 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Export all public JSON Schemas |
| M110-Q-120 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List public JSON Schemas |
| M110-Q-121 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List public JSON Schemas |
| M110-Q-122 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show one public JSON Schema |
| M110-Q-123 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Show one public JSON Schema |
| M110-Q-124 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Search community topics |
| M110-Q-125 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Search community topics |
| M110-Q-126 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read category stats |
| M110-Q-127 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read category stats |
| M110-Q-128 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read tag stats |
| M110-Q-129 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read tag stats |
| M110-Q-130 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read topic stats |
| M110-Q-131 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Read topic stats |
| M110-Q-132 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview or subscribe |
| M110-Q-133 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview or subscribe |
| M110-Q-134 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview or unsubscribe |
| M110-Q-135 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview or unsubscribe |
| M110-Q-136 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview topic creation and return a confirmation id |
| M110-Q-137 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview topic creation and return a confirmation id |
| M110-Q-138 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview topic deletion and return a confirmation id |
| M110-Q-139 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview topic deletion and return a confirmation id |
| M110-Q-140 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List topics with filters |
| M110-Q-141 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List topics with filters |
| M110-Q-142 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List recent topics |
| M110-Q-143 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | List recent topics |
| M110-Q-144 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview topic update and return a confirmation id |
| M110-Q-145 | required | ACCEPTED_BY_INSPECTED_WRITE_PREVIEW_SEMANTICS | Preview topic update and return a confirmation id |
| M110-Q-146 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | View topic detail |
| M110-Q-147 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | View topic detail |
| M110-Q-148 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Approve workflow preview |
| M110-Q-149 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Approve workflow preview |
| M110-Q-150 | required | ACCEPTED_BY_INSPECTED_WORKFLOW_AUDIT_TEXT | Print workflow audit log |
| M110-Q-151 | required | ACCEPTED_BY_INSPECTED_WORKFLOW_AUDIT_TEXT | Print workflow audit log |
| M110-Q-152 | required | ACCEPTED_NEGATIVE_DIFF_SEMANTICS | Diff workflow preview and approval |
| M110-Q-153 | required | ACCEPTED_NEGATIVE_DIFF_SEMANTICS | Diff workflow preview and approval |
| M110-Q-154 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Export workflow evidence |
| M110-Q-155 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Export workflow evidence |
| M110-Q-156 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Plan a workflow |
| M110-Q-157 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Plan a workflow |
| M110-Q-158 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Create a workflow policy template |
| M110-Q-159 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Create a workflow policy template |
| M110-Q-160 | required | ACCEPTED_BY_TARGETED_JOIN | Run or execute approved workflow |
| M110-Q-161 | required | ACCEPTED_BY_TARGETED_JOIN | Run or execute approved workflow |
| M110-Q-162 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Verify workflow artifacts |
| M110-Q-163 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Verify workflow artifacts |
| M110-Q-164 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Verify workflow bundle |
| M110-Q-165 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Verify workflow bundle |
| M110-Q-166 | excluded | EXCLUDED | Checksum mismatch fails closed. |
| M110-Q-167 | excluded | EXCLUDED | Missing checksum metadata fails closed. |
| M110-Q-168 | excluded | EXCLUDED | Supported upgrade preserves config. |
| M110-Q-169 | excluded | EXCLUDED | Failed upgrade restores source version. |
| M110-Q-170 | excluded | EXCLUDED | Rollback restores source version. |
| M110-Q-171 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Missing profile is actionable and secret-safe. |
| M110-Q-172 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | 401 is classified as authentication failure. |
| M110-Q-173 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | 403 is classified as permission/configuration denial. |
| M110-Q-174 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | 404 returns a truthful not-found result. |
| M110-Q-175 | required | ACCEPTED_BY_CROSS_EVIDENCE_JOIN | 409 requires a fresh read and preview. |
| M110-Q-176 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | 429 preserves the exact retry window. |
| M110-Q-177 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | 5xx remains a service failure. |
| M110-Q-178 | required | ACCEPTED_BY_TARGETED_JOIN | Network failure is actionable. |
| M110-Q-179 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Timeout is classified without fabrication. |
| M110-Q-180 | required | ACCEPTED_BY_TARGETED_JOIN | Recursive redaction leaves zero secret leaks. |
| M110-Q-181 | required | ACCEPTED_BY_TARGETED_JOIN | Breaking schema drift is rejected. |
| M110-Q-182 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | The approved administrator operations and update additions preserve every existing command. |
| M110-Q-183 | required | ACCEPTED_BY_INSPECTED_RAG_EVIDENCE_BOUNDARY | RAG retrieve remains isolated from App 100 ask. |
| M110-Q-184 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Existing ask behavior remains available. |
| M110-Q-185 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Favorite identity fidelity is 100%. |
| M110-Q-186 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Missing personal search is truthful. |
| M110-Q-187 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Empty search remains truthful and actionable. |
| M110-Q-188 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Cursor traversal preserves identity and termination. |
| M110-Q-189 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Invalid operation confirmation fails closed. |
| M110-Q-190 | required | ACCEPTED_BY_TARGETED_JOIN | Workflow hash mismatch blocks execution. |
| M110-Q-191 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Other-owner mutation is denied. |
| M110-Q-192 | required | ACCEPTED_BY_REVIEWED_SAME_SAMPLE_API_AND_REAL_CHROME | Nested reply passes API and real Chrome evidence. |
| M110-Q-193 | required | ACCEPTED_BY_CROSS_EVIDENCE_JOIN | Owned reply deletion passes dual evidence. |
| M110-Q-194 | required | ACCEPTED_BY_CROSS_EVIDENCE_JOIN | Other-owner reply deletion is denied. |
| M110-Q-195 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Offline query performs zero network and write calls. |
| M110-Q-196 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Tampered collection bundle is rejected. |
| M110-Q-197 | required | ACCEPTED_BY_FRESH_PATH_SIDE_EFFECT_PROOF | Path traversal cannot escape isolation. |
| M110-Q-198 | required | ACCEPTED_BY_FRESH_PATH_SIDE_EFFECT_PROOF | Absolute archive paths are rejected before extraction. |
| M110-Q-199 | required | ACCEPTED_BY_FRESH_PATH_SIDE_EFFECT_PROOF | Parent-directory archive paths are rejected before extraction. |
| M110-Q-200 | required | ACCEPTED_BY_STRUCTURED_PUBLIC_EVIDENCE | Isolated write cleanup leaves zero residual resources. |
| M110-Q-201 | excluded | EXCLUDED | Managed update succeeds with backup and unchanged auth configuration. |
| M110-Q-202 | excluded | EXCLUDED | Failed or unmanaged update cannot replace the working installation or auth configuration. |

最终默认门六项实际退出0、context生成实际0；上下文生成提交M1=e5dc072bad1d3b17b5e6e42c46fd3298ade64705。版本门内部 temporaryInternalPack=true、formalRepack=false、publishedArchiveStillH3=true，临时校验目录已删除；其内部临时包没有上传、替换或进入Git。一次Codex容量失败及报告忽略文件断言更正的原始记录均保留，未重跑已通过的门。
