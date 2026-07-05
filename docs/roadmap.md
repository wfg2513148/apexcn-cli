# apexcn-cli Roadmap

## 产品定位

`apexcn-cli` 是 APEX 中文社区的本地 AI Agent 操作层、社区知识操作 CLI、可审计内容发布工作流引擎。CLI 是主产品，MCP 是 AI Agent 的薄适配层，真实写操作优先走 CLI workflow。

## 当前阶段

当前版本处于 `0.x` 产品化阶段：CLI 能力较完整，已覆盖搜索、查看、问答、研究、草稿、审核、workflow、收藏、订阅和诊断；正在补齐 JSON 契约、core service、MCP readonly、preview-only MCP 写工具、RAG eval 与 collection 本地索引。

## v0.17 目标

- 稳定 CLI JSON 输出，保持 `schemaVersion: 1` 兼容并追加 manifest v2 元数据。
- 建立 roadmap、capability matrix、GA 标准和安全模型。
- 引入 command registry。
- 建立 runtime schema 与 contract tests 初版。

## v0.18 目标

- 持续抽象 core service，使 CLI 与 MCP 共享 API client 和安全策略。
- 扩大 contract tests 覆盖到主要 read/write/workflow JSON。
- 建立 RAG eval baseline。
- 完成 collection 本地 index/query MVP。

## v0.19 目标

- 提供 `apexcn mcp serve --readonly` 本地 stdio MCP Server。
- 提供 `apexcn mcp tools --json` 与 `apexcn mcp inspect --json`。
- readonly MCP 工具覆盖 search/topic/category/ask/research/doctor/workflow plan。

## v0.20 目标

- 提供 MCP preview-only 写工具。
- preview-only 工具明确 `willExecute: false`，不得发起真实 POST/PATCH/DELETE。
- 强化 workflow policy、audit log 和 workflow diff。

## v1.0 GA 目标

- CLI + MCP + workflow + security model 稳定。
- 所有公开 JSON 输出有 schema 和 contract tests。
- MCP readonly 可被实际 AI 客户端识别。
- 写操作默认 preview，真实执行由 workflow approval 管控。
- release checksum、安装、升级、卸载和回滚路径清晰。

## 非目标

- 不做 MCP-first。
- 不移除或弱化 CLI。
- 不默认启动远端 HTTP MCP Server。
- 不在 MCP 第一版开放真实写操作。
- 不在测试中调用真实社区写接口。

## 风险与取舍

- core service 需要渐进抽象，避免大爆炸重构破坏现有 CLI。
- MCP MVP 优先 stdio 与 tool manifest，先不追求远端部署。
- schema 初版保持宽进严出，避免服务端新增字段导致 CLI 脆弱。
- collection 本地索引先用无 native 依赖方案，牺牲一部分排序质量换取安装稳定。
