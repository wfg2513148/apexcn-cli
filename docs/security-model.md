# apexcn-cli 安全模型

本文说明 apexcn-cli 正式版的认证、写操作、敏感信息保护和安装完整性策略。

## API Key 与凭据存储

apexcn-cli 支持两种凭据来源：

- `file`：使用 `apexcn -apikey` 或 `auth set-token --token` 保存到本地配置文件；
- `env`：使用 `auth set-token --token-env <name>` 只保存环境变量名，不保存环境变量值。

同时配置两种来源时，运行时优先读取环境变量；环境变量不可用时才回退到文件凭据。两种来源都不可用时，命令会在发送 API 请求前停止。

配置文件默认只允许当前用户读写，权限为 `0600`。API Key 可能出现在 shell 历史或短暂出现在进程列表中，因此共享设备或高安全环境应优先使用环境变量方式。

## Profile 隔离

每个 profile 独立保存社区地址和凭据配置。切换 profile 不会复制或合并凭据；本地草稿也按 profile 隔离。

可使用以下命令检查配置状态，输出不会包含完整 API Key：

```bash
apexcn auth show --json
apexcn auth audit --json
```

## 预览与确认

- `preview`：展示准备发送的请求，保存待确认操作并返回操作编号，不执行远端写入；
- `dry-run`：验证参数和本地安全规则，不保存待确认操作，也不执行远端写入；
- `confirm`：使用操作编号执行用户刚刚确认的同一项变更。

话题和回复的创建、修改或删除必须先取得操作编号，再通过 `apexcn confirm <operation-id> --yes` 执行。操作编号会绑定本地配置范围、profile、社区地址、完整请求、SHA-256 哈希、有效期和幂等键；目标、正文、版本或配置发生变化后，旧编号立即失效。已经完成的编号不能重复写入，网络结果不确定时只能使用原编号重试同一请求。

删除操作还会校验目标版本以及完整标题或精确回复 ID，避免误删相似内容。

## 写操作风险等级

- `medium`：收藏和订阅的添加或取消；
- `high`：话题和回复的创建或修改，以及正确答案标记的变更；
- `destructive`：话题和回复的删除。

涉及 `high` 或 `destructive` 操作时，应先检查预览，再由用户明确确认。

## 敏感信息脱敏

stdout、stderr、诊断快照和本地操作记录会对以下内容进行脱敏：

- Authorization Bearer Token；
- API Key、token、password、passwd、secret 等字段；
- Cookie 与 Set-Cookie；
- URL 中的用户凭据。

确定性模糊测试覆盖 Authorization、JSON 敏感字段、命令行参数、URL userinfo 和 Cookie 等场景；检测到明文残留时，安全测试会失败。

## 诊断与支持快照

使用以下命令生成脱敏的本地诊断文件：

```bash
apexcn doctor snapshot --output ./support-snapshot.json --json
```

快照不会包含完整 API Key、Authorization Header、Cookie、密码或未脱敏配置内容，输出文件仅允许当前用户读写。

## 管理员运营观测与隐私

CLI 的每个社区 API 请求都会发送版本化 `X-APEXCN-Client: apexcn-cli/<version>`；可识别命令还会发送受限值 `X-APEXCN-CLI-Operation`。服务端只把合法客户端标识的请求计入管理员运营统计。该标识是合作式标识，不是新的认证凭据：持有有效社区凭据的其他客户端可以仿造它，因此聚合结果用于运营观测，不能作为不可抵赖的安全审计证明。

`apexcn admin operations` 只读取服务端聚合，不读取本机历史或建立本地遥测。计数表示服务端实际收到的请求；本地参数校验失败、配置加载失败，以及尚未到达服务端的网络错误不会出现。服务端只为显式 `search` 和 `me search` 保存长度受限的规范化关键词；`ask` 问题、Authorization、API Key 和原始请求正文不会写入关键词字段，也不会由聚合端点返回。日志保留遵循社区服务端现有审计日志生命周期，CLI 不会延长或绕过该生命周期。

## 安装与更新完整性

公开 Release 提供以下文件：

- `apexcn-cli.tgz`；
- `install-agent.sh` 与 `install-agent.ps1`；
- `apexcn-cli.spdx.json` 与 `release-provenance.json`；
- `checksums.txt`；
- 上述五个发布文件对应的独立 `.sha256` 校验文件。

安装脚本必须使用 `checksums.txt` 对下载包执行 SHA-256 校验。校验缺失或失败时安装立即停止，不提供跳过选项。

维护者在上传前运行 `node scripts/verify-release-supply-chain.mjs artifacts`，核对全部 checksum、SPDX 2.3 SBOM、in-toto/SLSA provenance、源 commit 与候选版本。发布后还必须将 GitHub Release API 返回的资产 digest 与本地冻结资产逐项比较。完整资格边界见 `docs/ga-support-policy.md`。

生命周期脚本是独立脚本，不是 `apexcn` 子命令，因此不会出现在 `apexcn --help` 或 `apexcn commands --json` 中。安装器会打印实际的 `Installed source`；自定义安装目录时，应以该路径替换下面的 `CLI_SOURCE`。安装器会在 source 内记录实际安装根目录和 launcher 目录，因此从自定义 `Installed source` 运行生命周期脚本时无需再次传入路径参数。

macOS / Linux 默认安装可以这样升级、回滚或卸载：

```bash
CLI_SOURCE="$HOME/.apexcn/tools/apexcn-cli/package"
bash "$CLI_SOURCE/scripts/lifecycle-agent.sh" upgrade
bash "$CLI_SOURCE/scripts/lifecycle-agent.sh" rollback --backup "<升级输出的备份路径>" --yes
bash "$CLI_SOURCE/scripts/lifecycle-agent.sh" uninstall --yes
```

Windows PowerShell 默认安装使用对应脚本：

```powershell
$CliSource = Join-Path $env:LOCALAPPDATA "apexcn\tools\apexcn-cli\package"
& "$CliSource\scripts\lifecycle-agent.ps1" upgrade
& "$CliSource\scripts\lifecycle-agent.ps1" rollback -Backup "<升级输出的备份路径>" -Yes
& "$CliSource\scripts\lifecycle-agent.ps1" uninstall -Yes
```

升级前会创建版本化备份，失败时自动恢复；回滚和卸载需要明确确认。卸载只删除 CLI 安装目录和脚本创建的 launcher，保留认证配置。首次安装仍使用本节列出的公开安装脚本。
