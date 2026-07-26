# 0.9 GA 候选激活与资格资产

> 此目录冻结于 `1.0.10`，用于保留 0.9 timebox 后尚未完成的资格验证契约。后续产品版本只验证这些资产的内部完整性，不把它们描述成当前版本的 GA 验收结果；开放工作继续由 GitHub Issue #2 跟踪。

`1.0.9` 的 v1 数据集、公开面、资格契约和支持矩阵已由本目录的 v2 资产完整替代，并在 `v1.0.12` 工程清理中从当前源码树移除；其历史哈希和结论仍保留在 Git 历史、roadmap timebox 记录与 GitHub Issue #2 中。

这里保存 0.9 激活与候选资格验证必须冻结的机器可读契约：

- `public-surface-v2.json`：从 1.0.10 可执行文件、command manifest、Schema registry、workflow goal 和源码 API 路径生成的公开面；
- `support-matrix-v2.json`：从每个已发布稳定 1.x 起点到 1.0.10 的 36 个平台单元与恢复/回滚阶段；
- `qualification-contract-v2.json`：200 题评分、独立 validator、隔离写清理和独立安全审查契约；
- `fixtures-v1.json`：只声明非 secret 的运行时绑定、隔离边界、DEV/Chrome 证据和清理要求；
- `task-plan-v1.jsonl`：恰好 200 行、由公开命令示例和资格数据确定性生成的执行绑定；
- `harness-manifest-v1.json`：上述输入、recorder、scorer、生命周期脚本、阶段停止点和 36 个矩阵单元的哈希清单。

`scripts/ga-qualification-recorder.mjs` 为每题创建独立 task root 和 synthetic config，并按 `task-plan-v1.jsonl` 的固定顺序执行/记录 fixture。正式候选动作之前先写 append-only `started` 事件，再保存脱敏后的 stdout/stderr、退出码和哈希；一旦动作已开始但证据未完成，禁止重试制造“首次成功”。

这些文件只证明 denominator、执行动作和停止边界已经提前冻结。它们本身不证明资格通过。实际候选仍须提供独立首次尝试结果、完整矩阵、供应链验证、安全审查和零残留证据；未执行的 Windows 单元不得标记为通过或沿用 v1.0.9 的一次性豁免。
