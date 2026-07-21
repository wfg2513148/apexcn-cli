# apexcn-cli

把 APEX 中文社区装进本地 AI 工具里。你可以少开网页、少复制链接，直接让 AI agent 帮你搜索社区帖子、总结资料、起草提问和回复、发帖回帖、收藏订阅。

## APEX 中文社区是什么

[APEX 中文社区](https://oracleapex.cn/) 是面向 Oracle APEX 中文用户的交流社区。社区按“问题求助”“新手入门”“进阶技巧”“建议与意见反馈”等板块组织内容；你可以在网页里阅读、提问和回复，也可以通过 `apexcn-cli` 让本地 AI 工具检索、整理或在确认后操作这些内容。

![APEX 中文社区首页和内容板块](docs/assets/readme/apexcn-community-home.jpg)

> 上图为 2026 年 7 月 21 日真实社区首页。未登录时，右上角账号入口显示为 `nobody`。

## 如何获取 API Key

API Key 用于证明 CLI 请求来自你的社区账号。它不是安装 `apexcn-cli` 的前置参数：先从社区网页获取 Key，再在本机单独配置即可。

1. 打开 [oracleapex.cn](https://oracleapex.cn/)，点击右上角的 `nobody`。
2. 注册新账号，或使用已有账号/Google 认证登录。
3. 登录后点击右上角账号菜单，选择 **API Key 管理**。
4. 在弹窗中点击 **复制**，保存当前 API Key。

![APEX 中文社区 API Key 管理弹窗](docs/assets/readme/apexcn-api-key-management.png)

> 上图来自真实账号页面，账号标识和 Key 已专门遮盖。页面中的 **重新生成** 会撤销旧 Key 并创建新 Key；只有在 Key 丢失、疑似泄露或确实需要轮换时才使用。

请把 API Key 当作密码保管：不要发到帖子、聊天记录或 issue，不要提交到 Git 仓库，也不要在截图中保留完整值。CLI 和文档示例只使用 `YOUR_API_KEY` 作为占位符。

## 适合谁

- 刚开始用 APEX 中文社区，不想记命令的小白用户。
- 想让本地 AI 工具读取社区帖子、整理答案、生成排查清单的用户。
- 需要在终端里直接操作社区内容的进阶用户。

## 快速安装

安装和认证是两个独立步骤。安装命令不接收 API key，也不会配置账号或联网验号。

### 推荐：在 AI 工具里安装

把这条命令发给你正在使用的 AI 工具，让它执行。安装完成后，AI 通常就能自动识别 APEX 中文社区相关请求。

macOS / Linux：

```bash
bash -o pipefail -c 'curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh | bash'
```

Windows PowerShell：

```powershell
irm "https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.ps1" | iex
```

两条命令都不接收参数，会安装 CLI launcher 和用户级 agent skill。安装器要求本机已有 Node.js 20+、校验 release 包的 SHA-256，并在发现可识别的旧 launcher 时直接更新它。

### 安装后单独认证

完成上面的“获取 API Key”步骤后，在自己的 shell 中执行一条命令即可保存它：

```bash
apexcn -apikey "YOUR_API_KEY"
apexcn me --json
```

普通字母数字 key 也可以不加引号：

```bash
apexcn -apikey xxxxxx
```

请把示例值整体替换为真实 key。该快捷命令会把 key 保存到权限为 `0600` 的默认 `prod` profile，不会回显 key，也不会在配置时调用社区 API。因为命令行参数可能进入 shell 历史和短暂出现在进程列表中，对安全要求更高时可继续使用环境变量方式：

```bash
apexcn auth set-token --profile prod --token-env APEXCN_API_KEY
```

不要把 `你的_API_KEY` 或 `YOUR_API_KEY` 原样当作 token。安装脚本不会读取 API key；认证命令会拒绝示例占位符、非 ASCII 字符和带空白的 token。

## 安装后怎么用

在 AI 工具里直接用自然语言说需求。多数情况下不需要显式说 `apexcn-cli`，只要说清楚你要访问 APEX 中文社区或 oracleapex.cn。

### 搜索和总结

> 帮我在 APEX 中文社区搜索 REST API 相关帖子，总结前 5 条，并带上每条帖子的真实链接和原文链接。

> 搜一下 oracleapex.cn 里关于 ORDS 认证失败的帖子，整理成排查清单。

> 查一下 APEX 中文社区有没有 JSON_TABLE 的新手示例，按适合阅读的顺序列出来。

> 总结最近 48 小时更新的 APEX 中文社区帖子，按主题归纳并带上链接。

### 查看和整理帖子

> 打开社区帖子 30549，帮我总结主要内容、关键步骤、注意事项和真实链接。

> 把这几条 APEX 中文社区帖子整理成一份学习笔记，每条写清楚适合谁看、解决什么问题、链接是什么。

### 新手任务路径

> 给我一条从安装、检索到安全提问的 APEX 中文社区学习路径。

> 给我一份 APEX 应用部署前后的检查清单，并说明哪些结论还需要核对官方文档。

终端中可直接查看本地策展视图：

```bash
apexcn guide learning --json
apexcn guide compatibility --apex-version 24.2 --ords-version 24.4 --json
apexcn guide deployment --format text
apexcn guide security --json
apexcn guide performance --json
```

### 起草和发布内容

> 我遇到 APEX 调用 REST API 返回 401。请先搜索社区已有讨论，再帮我起草一篇提问帖。先不要发布，给我确认。

> 请把我确认后的内容发布到合适的 APEX 中文社区板块。发布前先告诉我标题、板块、正文和标签。

### 回复、收藏和订阅

> 帮我给帖子 30549 起草一条友好的回复，先给我预览，不要直接发布。

> 帮我收藏帖子 30549，并把真实链接发给我。

> 帮我订阅帖子 30549，后续方便关注更新。

## 验证安装

你可以让 AI 检查：

> 请检查 apexcn-cli 是否安装成功，并确认当前登录账号、板块列表和搜索能力是否正常。不要输出完整 API key。

也可以自己在终端里执行：

```bash
command -v apexcn
apexcn --version
apexcn doctor --json
apexcn auth show --json
apexcn me --json
apexcn me stats --json
apexcn category list --json
apexcn stats category --json
```

能看到账号信息和板块列表，就可以用了。

## 使用手册

- 小白用户手册（中文）：[docs/user-guide.zh.md](docs/user-guide.zh.md)
- Beginner Guide (English)：[docs/user-guide.en.md](docs/user-guide.en.md)
- 命令行终端手册（中文）：[docs/cli-manual.zh.md](docs/cli-manual.zh.md)
- Terminal Manual (English)：[docs/cli-manual.en.md](docs/cli-manual.en.md)
- 快速说明：[docs/quickstart.md](docs/quickstart.md)
- 产品路线图：[docs/roadmap.md](docs/roadmap.md)
- 0.30.x 迁移说明：[docs/migration-v0.30.md](docs/migration-v0.30.md)
- 0.40.x 迁移说明：[docs/migration-v0.40.md](docs/migration-v0.40.md)
- 0.50.x 迁移说明：[docs/migration-v0.50.md](docs/migration-v0.50.md)
- 0.60.x 迁移说明：[docs/migration-v0.60.md](docs/migration-v0.60.md)
- 0.70.x 迁移说明：[docs/migration-v0.70.md](docs/migration-v0.70.md)
- 0.80.x 迁移说明：[docs/migration-v0.80.md](docs/migration-v0.80.md)
- MCP Agent 接入：[docs/mcp.md](docs/mcp.md)
- MCP 客户端兼容：[docs/mcp-client-compatibility.md](docs/mcp-client-compatibility.md)
- JSON/API 契约：[docs/api-contract.md](docs/api-contract.md)
- RAG 与 live readonly 检索质量：[docs/rag-quality.md](docs/rag-quality.md)
- 安全模型：[docs/security-model.md](docs/security-model.md)

## AI Agent / MCP

CLI 仍是主入口。MCP 是可选的本地 stdio 适配层，默认 readonly：

```bash
apexcn mcp tools --json
apexcn mcp inspect --json
apexcn mcp serve --readonly
```

MCP preview-only 写工具只生成 `willExecute: false` 的预览请求。topic/reply 的真实创建、修改和删除必须走 CLI 的 hash-bound workflow；直接 topic/reply 写命令只保留 `--preview` / `--dry-run`。MCP 不提供 execute-write。

## 常见问题

如果 AI 没有自动识别 APEX 中文社区相关请求，先重启 AI 工具，或让 AI 检查 `apexcn-cli` skill 是否已经安装到当前 AI 工具能读取的位置。

如果 shell 找不到 `apexcn`，或者 `command -v apexcn` 显示的不是安装脚本最后输出的目录，把该目录放到 `PATH` 前面。默认通常是：

- macOS / Linux：`~/.local/bin`
- Windows：`%LOCALAPPDATA%\apexcn\bin`

macOS / Linux 可先执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

如果要换 API key，可以对 AI 说：

> 请帮我重新配置 apexcn-cli 的 API key。我会提供新的 key。配置后请验证账号是否可用，不要输出完整 key。

终端用户可参考 [命令行终端手册（中文）](docs/cli-manual.zh.md) 或 [Terminal Manual (English)](docs/cli-manual.en.md)。

## 开发

```bash
npm ci
npm run build
npm test
npm run check:release
```

本地构建后可用只读命令抽查 v0.4 过滤能力：

```bash
node dist/index.js topic list --view unanswered --page-size 2 --json
node dist/index.js search "ORDS" --tags APEX,ORDS --has-useful-reply --json
node dist/index.js ask "最近 ORDS API 有哪些更新？" --tag ORDS --from 2026-07-01 --to 2026-07-05 --json
```

稳定安装文件：

```text
https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh
https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.ps1
https://github.com/wfg2513148/apexcn-cli/releases/latest/download/apexcn-cli.tgz
https://github.com/wfg2513148/apexcn-cli/releases/latest/download/checksums.txt
https://github.com/wfg2513148/apexcn-cli/releases/latest/download/apexcn-cli.tgz.sha256
https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh.sha256
https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.ps1.sha256
```

Release assets 使用 SHA-256 校验。安装脚本必须下载 `checksums.txt` 并校验 `apexcn-cli.tgz`；校验不可跳过。
