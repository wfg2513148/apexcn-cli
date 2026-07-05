# v1.0 GA Criteria

| 领域 | GA 标准 |
|---|---|
| CLI | 公开命令稳定，breaking change 必须有迁移说明和兼容期。 |
| JSON Contract | 所有公开 JSON 输出有 schema、fixture 和 contract tests。 |
| Agent | MCP readonly 可用，Skill、README、MCP 文档和 manifest 一致。 |
| Safety | 写操作默认 preview，delete 强确认，所有诊断/错误/快照脱敏。 |
| Workflow | approval hash-bound、verify/export 稳定，policy 可选且可审计。 |
| RAG | eval baseline 存在，引用覆盖率、低置信拒答和 unsupported claim 指标明确。 |
| Collection | 可构建、可校验、可本地索引和查询。 |
| Security | token 存储策略、profile 隔离、keychain/fallback、secret redaction 清晰。 |
| Release | npm/GitHub release/checksum/install/upgrade/uninstall 文档完善。 |
| Quality | `npm run build`、`npm test`、`npm run check:release` 全通过；关键路径 contract tests 覆盖。 |
