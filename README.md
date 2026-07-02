# apexcn-cli

把 APEX 中文社区装进终端和本地 AI 工具里。

少开网页、少复制链接。你可以直接搜索社区帖子、查看账号和板块，也可以让 AI 帮你查资料、总结帖子、起草提问。

## 能帮你做什么

- 搜索社区内容：`apexcn search "Oracle APEX" --json`
- 查看帖子详情：`apexcn topic view 30549 --json`
- 让 AI 总结搜索结果、整理排查清单、起草帖子
- 一键安装 CLI 和 AI skill，让本地 AI 工具知道怎么调用 `apexcn`

## 安装

先准备一个 APEX 中文社区 API key，把下面命令里的 `你的_API_KEY` 换成自己的 key。

### AI 工具里安装

把命令发给你正在使用的 AI 工具，让它执行。脚本会尽量把 skill 装到这个 AI 工具能使用的位置。

macOS / Linux：

```bash
curl -fsSL https://oracleapex.cn/cli/install-agent.sh | APEXCN_API_KEY='你的_API_KEY' APEXCN_CLI_INSTALL_AGENT_SKILLS=1 bash -s -- --yes
```

Windows PowerShell：

```powershell
$env:APEXCN_API_KEY="你的_API_KEY"; $env:APEXCN_CLI_YES="1"; $env:APEXCN_CLI_INSTALL_AGENT_SKILLS="1"; irm "https://oracleapex.cn/cli/install-agent.ps1" | iex
```

### 普通用户自己安装

只想先在终端里用 `apexcn`，用这一组。

macOS / Linux：

```bash
curl -fsSL https://oracleapex.cn/cli/install-agent.sh | APEXCN_API_KEY='你的_API_KEY' bash -s -- --yes
```

Windows PowerShell：

```powershell
$env:APEXCN_API_KEY="你的_API_KEY"; $env:APEXCN_CLI_YES="1"; irm "https://oracleapex.cn/cli/install-agent.ps1" | iex
```

## 验证

```bash
command -v apexcn
apexcn auth show --json
apexcn me --json
apexcn category list --json
```

能看到账号信息和板块列表，就可以用了。

## 让 AI 帮你

skill 装好后，可以直接对 AI 说：

```text
用 apexcn-cli 搜索 APEX REST API 相关帖子，帮我总结前 5 条。
```

```text
帮我查一下社区里有没有关于 ORDS 认证失败的讨论，输出排查清单。
```

```text
根据这个问题帮我起草一篇社区提问帖，先不要发布，给我确认。
```

## 常用命令

```bash
apexcn search "Oracle APEX" --page-size 5 --json
apexcn topic view 30549 --json
apexcn category list --json
apexcn me --json
apexcn ask "Oracle APEX 如何调用 REST API？" --top-k 3 --json
```

发帖示例：

```bash
apexcn topic create \
  --category-id 4 \
  --title "APEX 中如何使用 OPEN_QUERY_CONTEXT？" \
  --content-file ./post.md \
  --tags "APEX,SQL,AI" \
  --json
```

更多命令见 [docs/quickstart.md](docs/quickstart.md)。

## 常见问题

如果 shell 找不到 `apexcn`，或者 `command -v apexcn` 显示的不是安装脚本最后输出的目录，把该目录放到 `PATH` 前面。默认通常是：

- macOS / Linux：`~/.local/bin`
- Windows：`%LOCALAPPDATA%\apexcn\bin`

macOS / Linux 可先执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

如果 AI 没有自动识别 `apexcn-cli`，重新执行“AI 工具里安装”那组命令，然后重启 AI 工具，或让 AI 重新读取本地 skills。脚本最后的 `Agent skill installed under:` 会告诉你 skill 被复制到了哪里。

如果要换 API key：

```bash
apexcn auth set-token \
  --profile agent-prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "新的_API_KEY"
```

## 开发

```bash
npm ci
npm run build
npm test
```

稳定安装文件：

```text
https://oracleapex.cn/cli/install-agent.sh
https://oracleapex.cn/cli/install-agent.ps1
https://oracleapex.cn/cli/apexcn-cli.tgz
```
