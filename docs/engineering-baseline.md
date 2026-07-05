# Engineering Baseline

扫描日期：2026-07-05。

## 配置

- 包名和版本：`apexcn-cli@0.16.0`。
- Node/TypeScript：`type: module`，`tsconfig.json` 使用 `module: NodeNext`、`target: ES2022`、`strict: true`，源码入口为 `src/**/*.ts`，输出到 `dist/`。
- 测试：Vitest，脚本为 `npm test`。
- 构建：`npm run build` 执行 `tsc -p tsconfig.json`。
- 发布检查：`npm run check:release` 执行 `scripts/check-release-version.mjs`。
- 当前无独立 lint/coverage 脚本。

## 基线命令

- `npm install`：通过，提示 `fsevents` install scripts 被忽略，未发现漏洞。
- `npm run build`：通过。
- `npm test`：通过，基线为 16 个测试文件、452 个测试。
- `npm run check:release`：通过，检查版本 `0.16.0` 的 README、安装脚本、agent skill 与 release 引用一致性。

## 当前 CLI 命令

`commands --json` 基线为 `schemaVersion: 1`、`version: 0.16.0`、49 个 leaf commands。主要命令组：

- auth：`set-token`、`show`、`audit`、`list`、`use`、`remove`、`logout`。
- diagnostic：`doctor`、`doctor snapshot`。
- read：`admin list`、`category list`、`search`、`ask`、`research`、`topic list/view/recent`、`stats *`、`me *`。
- write：`topic create/update/delete`、`reply create/update/delete`、`favorite add/remove`、`subscription add/remove`。
- local/workflow：`draft *`、`review *`、`workflow plan/run/approve/verify/export/verify-bundle`。
- collection：`collection build`、`collection verify`。

本次改造后新增 `collection index/query` 与 `mcp tools/inspect/serve`，manifest 保持旧字段并追加 `manifestVersion: 2` 能力元数据。

## JSON 输出能力

- 多数 read/write/workflow 命令支持 `--json`。
- 旧 manifest 字段为 `path`、`aliases`、`description`、`options`、`safety`、`examples`。
- 新增能力字段为 additive change：`id`、`capability`、`apiEffect`、`riskLevel`、`authRequired`、`supportsJson`、`supportsPreview`、`supportsDryRun`、`mcpExposure`。

## Preview / Dry Run / Workflow

- 写命令已有 `--preview` 与部分 `--dry-run`。
- destructive 命令已有强确认：topic delete 要求 `--yes`、`--force`、`--confirm-title`；reply delete 要求 `--yes`、`--force`。
- workflow 已支持 plan/run/approve/verify/export/verify-bundle，并有 hash-bound approval 语义。
- MCP 新增工具默认 readonly；preview-only 写工具只生成 request preview，`willExecute: false`。

## 测试覆盖

- 现有测试覆盖 auth、content、collection、doctor、workflow、natural-language scenarios、release scripts。
- 自然语言测试要求每个 manifest command 至少有一条普通场景和一条真实 CLI 场景。
- 本次新增 core registry、contract、MCP、security 测试。

## 发布流程

- `.github/workflows/ci.yml` 运行构建/测试。
- `.github/workflows/release.yml` 与 `scripts/check-release-version.mjs` 校验 README、安装脚本、agent skill、release URL 和 npm 包元数据。
- `files` 包含 `agent-skill/`、`dist/`、`docs/`、`scripts/e2e-readonly.sh`、安装脚本和 README。

## 明显技术债

- CLI command、manifest guidance 与业务实现仍集中在 `src/index.ts` 和 commands 模块，后续需继续下沉到 `src/core/`。
- runtime schema 目前是轻量手写 validator，后续可评估 `zod` 或 JSON Schema 生成。
- MCP stdio server 为 MVP，不包含完整客户端兼容性矩阵。
- collection 本地查询使用简单 term frequency，尚未实现 BM25、SQLite 或向量索引。
- keychain 仅完成 store 抽象设计，未引入系统 keychain 依赖。
