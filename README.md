# apexcn-cli

把 APEX 中文社区装进本地 AI 工具里。你可以少开网页、少复制链接，直接让 AI agent 帮你搜索社区帖子、总结资料、起草提问、发帖回帖、收藏订阅。

## 适合谁

- 刚开始用 APEX 中文社区，不想记命令的小白用户。
- 想让本地 AI 工具读取社区帖子、整理答案、生成排查清单的用户。
- 需要在终端里直接操作社区内容的进阶用户。

## 快速安装

先准备一个 APEX 中文社区 API key，把下面命令里的 `你的_API_KEY` 换成自己的 key。

### 推荐：在 AI 工具里安装

把这条命令发给你正在使用的 AI 工具，让它执行。安装完成后，AI 通常就能自动识别 APEX 中文社区相关请求。

macOS / Linux：

```bash
curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/download/v3.0.0/install-agent.sh | APEXCN_API_KEY='你的_API_KEY' APEXCN_CLI_INSTALL_AGENT_SKILLS=1 bash -s -- --yes
```

Windows PowerShell：

```powershell
$env:APEXCN_API_KEY="你的_API_KEY"; $env:APEXCN_CLI_YES="1"; $env:APEXCN_CLI_INSTALL_AGENT_SKILLS="1"; irm "https://github.com/wfg2513148/apexcn-cli/releases/download/v3.0.0/install-agent.ps1" | iex
```

### 只安装终端命令

如果你只想自己在命令行里用：

macOS / Linux：

```bash
curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/download/v3.0.0/install-agent.sh | APEXCN_API_KEY='你的_API_KEY' bash -s -- --yes
```

Windows PowerShell：

```powershell
$env:APEXCN_API_KEY="你的_API_KEY"; $env:APEXCN_CLI_YES="1"; irm "https://github.com/wfg2513148/apexcn-cli/releases/download/v3.0.0/install-agent.ps1" | iex
```

## 安装后怎么用

在 AI 工具里直接用自然语言说需求。多数情况下不需要显式说 `apexcn-cli`，只要说清楚你要访问 APEX 中文社区或 oracleapex.cn。

### 搜索和总结

> 帮我在 APEX 中文社区搜索 REST API 相关帖子，总结前 5 条，并带上每条帖子的真实链接和原文链接。

> 搜一下 oracleapex.cn 里关于 ORDS 认证失败的帖子，整理成排查清单。

> 查一下 APEX 中文社区有没有 JSON_TABLE 的新手示例，按适合阅读的顺序列出来。

### 查看和整理帖子

> 打开社区帖子 30549，帮我总结主要内容、关键步骤、注意事项和真实链接。

> 把这几条 APEX 中文社区帖子整理成一份学习笔记，每条写清楚适合谁看、解决什么问题、链接是什么。

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
apexcn doctor --json
apexcn auth show --json
apexcn me --json
apexcn category list --json
```

能看到账号信息和板块列表，就可以用了。

## 使用手册

- 小白用户手册（中文）：[docs/user-guide.zh.md](docs/user-guide.zh.md)
- Beginner Guide (English)：[docs/user-guide.en.md](docs/user-guide.en.md)
- 命令行终端手册（中文）：[docs/cli-manual.zh.md](docs/cli-manual.zh.md)
- Terminal Manual (English)：[docs/cli-manual.en.md](docs/cli-manual.en.md)
- 快速说明：[docs/quickstart.md](docs/quickstart.md)

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

稳定安装文件：

```text
https://github.com/wfg2513148/apexcn-cli/releases/download/v3.0.0/install-agent.sh
https://github.com/wfg2513148/apexcn-cli/releases/download/v3.0.0/install-agent.ps1
https://github.com/wfg2513148/apexcn-cli/releases/download/v3.0.0/apexcn-cli.tgz
```
