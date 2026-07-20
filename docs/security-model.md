# Security Model

## API Key 存储

当前 CLI 使用本地配置文件保存 profile 和 baseUrl。`auth set-token --token <value>` 保存 file credential；`auth set-token --token-env <name>` 只保存环境变量名，不把其值写入配置。两者同时传入时，运行时优先读取环境变量，缺失时回退到 file credential。配置文件路径可通过 `--config` 或 `APEXCN_CONFIG_PATH` 指定。

## 文件权限策略

配置文件和 workflow artifacts 应保存在用户本机目录。写入 token、workflow approval、support bundle 时必须避免 world-readable 权限；后续版本应将权限检查纳入 `auth audit --json`。

## Credential Store 与 fallback 策略

0.80.x 支持 file 与 env 两种 credential store。`fallbackCredentialStore(primary, fallback)` 优先读取 primary；primary 不可用时才读取 fallback；两者都不可用时 fail closed。写入和删除只作用于 fallback，因此只读 env 可以安全作为 primary。`auth show`、`auth audit` 和 doctor snapshot 只记录 store 类型、变量名、是否命中和 backend 是否可用，不记录环境变量值。macOS Keychain、Windows Credential Manager 和 Linux Secret Service 尚不属于支持矩阵，不能在资格报告中宣称已支持。

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

0.80.x 的确定性 fuzz 门禁覆盖 Authorization、JSON secret 字段、CLI 参数、URL userinfo 和 Cookie 等 10,000 个样本，任何明文残留都失败。

## Doctor Snapshot / Support Bundle

不得包含完整 API key、Authorization header、Cookie、password、未脱敏 config 文件内容、真实 workflow 写请求中的敏感字段。使用 `apexcn doctor snapshot --output <file> --json` 保存脱敏快照时，文件权限为仅当前用户可读写。

## 生命周期操作

发行包包含 `scripts/lifecycle-agent.sh` 和 `scripts/lifecycle-agent.ps1`，支持 install、upgrade、rollback 和 uninstall。upgrade 会在安装前保留版本化备份，失败时恢复；rollback 和 uninstall 必须显式确认。uninstall 只删除 CLI 安装目录及由脚本创建的 launcher，并保留认证配置。

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

安装脚本必须下载 `checksums.txt` 并用 SHA-256 校验 `apexcn-cli.tgz`。校验缺失或失败时必须停止安装，不提供跳过开关。
