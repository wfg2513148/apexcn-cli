# apexcn-cli Roadmap

## 产品定位

`apexcn-cli` 是 APEX 中文社区的本地 AI Agent 操作层、社区知识操作 CLI、可审计内容发布工作流引擎。CLI 是主产品，MCP 是 AI Agent 的薄适配层，真实写操作优先走 CLI workflow。

## 当前阶段

当前版本处于 `0.x` 产品化阶段：CLI 能力较完整，已覆盖搜索、查看、问答、研究、草稿、审核、workflow、收藏、订阅和诊断；正在把 release、schema、MCP、RAG eval、collection query 和 workflow policy 收口到可回归、可审计状态。

## v0.17 目标

- 稳定 CLI JSON 输出，保持 `schemaVersion: 1` 兼容并追加 manifest v2 元数据。
- 建立 roadmap、capability matrix、GA 标准和安全模型。
- 引入 command registry。
- 建立 runtime schema 与 contract tests 初版。

## v0.18 目标

- 版本、README、release workflow 和安装链接一致。
- release assets 生成 checksum，安装脚本默认校验 tgz。
- `commands --json-schema` 与 MCP tools schema 可导出。
- RAG eval 纳入 CI report-only。
- collection query 使用 BM25，并支持 `--explain` 与 `collection stats`。
- workflow policy init、verify --policy、diff、audit-log 起步可用。

## v0.19 目标

- 扩大 core service 抽象覆盖，减少 CLI/MCP 适配层中的重复逻辑。
- 为更多公开 JSON 输出补 runtime schema 和 contract tests。
- 强化 MCP 客户端兼容测试与文档。

## v0.20 目标

- 强化 workflow policy 表达能力。
- 改进 RAG eval 的真实引用命中评测。
- 评估 optional keychain store，不破坏 CI/跨平台安装。

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
