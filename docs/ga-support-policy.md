# GA 候选支持与资格政策

本文件定义 `apexcn-cli` 1.x GA 候选的公开兼容、升级、恢复、供应链和独立验证边界。它是资格契约，不代表某个候选版本已经通过资格验证；通过结论必须引用实际运行证据。

## 公开面冻结

冻结范围包括：

- `apexcn --help` 和 `apexcn commands --json` 中的公开命令、别名、选项、安全语义与退出行为；
- 全部公开 JSON 成功 Schema 与 `apexcn-error-v1`；
- workflow goal、preview、approval、execute、resume、verify 和 bundle 契约；
- CLI 实际使用的 `/api/v1` ORDS 路径、HTTP 方法与身份语义；
- 中英文用户文档和 Agent Skill 中的公开使用方式。

冻结清单由 `qualification/ga/public-surface-v1.json` 记录，`npm run check:ga-readiness` 会将当前构建与该清单逐项比较。1.x 内允许增加可选字段、增强说明和兼容修复；删除命令、改变既有字段类型、增加必填字段、绕过 preview/confirmation、改变身份语义或替换既有 API 路径都属于破坏性变化。本里程碑不新增公开命令族。

`rag retrieve` 只使用现有 search 和 topic detail 只读端点；`ask` 继续独立使用 App 100 `/api/v1/ask`。GA 候选不得修改 App 100 页面 100 或其现有 RAG 知识问答实现。

## 支持版本与升级矩阵

1.0.9 候选支持从已公开发布的稳定 1.x 版本升级。当前冻结起点为 `1.0.0`、`1.0.2`、`1.0.3`、`1.0.4`、`1.0.5`、`1.0.6`、`1.0.7` 和 `1.0.8`；`1.0.1` 从未公开发布，因此不是升级起点。

`qualification/ga/support-matrix-v1.json` 给出每个起点、平台、shell 和生命周期阶段。每条资格路径必须执行：

1. 安装冻结起点；
2. 保留认证配置升级到候选；
3. 注入无效包或校验失败并证明自动恢复；
4. 回滚到升级前备份；
5. 再次升级并卸载 CLI，同时保留用户认证配置。

macOS、Linux 和 Windows 资格都使用隔离安装根、隔离 launcher 和只读或 DEV 测试身份。生产社区写入不属于升级或恢复资格。

## 恢复环境契约

每次运行必须记录候选版本、commit、包 SHA-256、起点 Release URL、平台、架构、Node、shell、隔离目录、开始和结束时间。失败注入只能替换本轮候选包或校验文件，不能修改用户真实安装。清理只能删除本轮隔离目录；配置保留和残留计数必须分别报告。

任何阶段失败都使该矩阵单元失败。重试不得覆盖首次尝试，修复后必须用新的运行标识重新执行受影响单元。

## Release build

发布构建使用 `scripts/check-release-artifacts.mjs` 产生：

- `apexcn-cli.tgz`、`install-agent.sh`、`install-agent.ps1`；
- `apexcn-cli.spdx.json`（SPDX 2.3 SBOM）；
- `release-provenance.json`（in-toto Statement v1、SLSA provenance v1 predicate）；
- `checksums.txt` 和每个上述资产的独立 `.sha256` 文件。

发布包内保留 `scripts/verify-release-supply-chain.mjs`，使下载者和独立 validator 无需 builder 源码即可验证同目录资产。维护者必须在上传前用它重新计算全部 SHA-256，核对 SBOM 中的版本与运行时依赖，并核对 provenance 的全部 subject、源 commit、完整源树 hash 和候选版本。最终上传前使用 `--require-clean`，拒绝 provenance 记录为 dirty 的源树。发布后还要比较 GitHub Release API 返回的每个资产 digest，确认上传内容与本地冻结资产相同。

provenance 证明构建输入、源 commit、构建器和 subject digest；它不是第三方签名。任何需要签名证明的分发渠道必须另行资格化，不能把本文件解释为已提供签名。

## 独立资格与安全审查

跨角色资格集、评分器、隔离写与清理边界定义在 `qualification/ga/qualification-contract-v1.json`。候选必须由 `/Users/kwang/Downloads/Works/66.Projects/apexcn-cli-test` 中全新的用户可见 novice task 黑盒执行，使用冻结候选和结构化 scope contract。

独立安全审查使用与 builder 不同的用户可见任务和不可变候选。审查至少覆盖凭据与脱敏、命令注入与路径穿越、归档提取、workflow preview/approval/hash 绑定、权限边界、隔离写清理、依赖与 SBOM、provenance 和 Release 资产一致性。未关闭的 critical 或 high 发现不得豁免。
