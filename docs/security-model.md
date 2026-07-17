# Security Model

## API Key 存储

当前 CLI 使用本地配置文件保存 profile、baseUrl 和 token；也支持从环境变量注入安装和运行时配置。配置文件路径可通过 `--config` 或 `APEXCN_CONFIG_PATH` 指定。

## 文件权限策略

配置文件和 workflow artifacts 应保存在用户本机目录。写入 token、workflow approval、support bundle 时必须避免 world-readable 权限；后续版本应将权限检查纳入 `auth audit --json`。

## Keychain 策略

当前已有 `CredentialStore` 抽象，并实现 file/env store。短期保留 file/env store，再评估 macOS Keychain、Windows Credential Manager 和 Linux Secret Service。keychain 依赖必须是可选能力，不能破坏无 GUI/CI 环境安装。

## Profile 隔离

每个 profile 独立保存 baseUrl/token。CLI 命令通过当前 profile 调用 API，MCP 复用同一 profile，不另建认证路径。

## Preview / Dry Run 语义

- `preview`：展示即将发送的 request，不执行远端写入。
- `dry-run`：验证参数与本地安全策略，不执行远端写入。
- MCP preview-only 工具永远返回 `willExecute: false`。
- 0.60.x 的 topic/reply 直接命令永远不执行写入；真实 CRUD 仅由已批准 CLI workflow 执行。

## Workflow Approval

workflow approval 同时绑定 profile、base URL、完整 request、preview hash 和 `expiresAt`。执行前任何目标、正文、版本、确认字段、operationKey、payloadHash 或期限变化都必须拒绝。timeout/5xx 只能复用同一 operationKey 恢复；409 必须创建新 workflow。

topic/reply create/update 的正文副本在 preview 前进行空正文、占位符和疑似密钥扫描。delete workflow 需要版本，并把完整标题或精确回复 ID 纳入批准请求。

## MCP Readonly 默认值

MCP 面向 AI Agent，默认攻击面应最小化。第一版默认 readonly，只允许 read/local diagnostic/tool manifest；写操作必须 blocked 或 preview-only，真实 execute-write 不进入第一版。

## 写操作风险等级

- medium：favorite/subscription add/remove。
- high：topic/reply create/update。
- destructive：topic/reply delete。

## Secret Redaction

必须脱敏：

- `Authorization: Bearer ...`
- `Bearer ...`
- `api_key`、`apiKey`、`token`
- `password`、`passwd`、`secret`
- `Cookie`、`Set-Cookie`

脱敏适用于 stdout/stderr JSON、doctor snapshot、workflow artifacts、MCP errors、测试 fixture。

## Doctor Snapshot / Support Bundle

不得包含完整 API key、Authorization header、Cookie、password、未脱敏 config 文件内容、真实 workflow 写请求中的敏感字段。

## Release Asset 校验

Release 必须上传：

- `apexcn-cli.tgz`
- `install-agent.sh`
- `install-agent.ps1`
- `checksums.txt`
- `artifacts/apexcn-cli.tgz`
- `artifacts/install-agent.sh`
- `artifacts/install-agent.ps1`
- `artifacts/checksums.txt`
- `artifacts/apexcn-cli.tgz.sha256`
- `artifacts/install-agent.sh.sha256`
- `artifacts/install-agent.ps1.sha256`

安装脚本默认下载 `checksums.txt` 并用 SHA-256 校验 `apexcn-cli.tgz`。校验失败必须停止安装。只有显式设置 `APEXCN_CLI_SKIP_CHECKSUM=1` 时才允许降级跳过，并应向用户输出 warning。
