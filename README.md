# apexcn-cli

让你正在使用的本地 AI 助手，更方便地访问和操作 [APEX 中文社区](https://oracleapex.cn/)。

安装并绑定社区 API Key 后，你只需要用自然语言告诉 AI 想做什么，不必记住一长串命令，也不必在网页、聊天窗口和终端之间反复复制内容。

## 它能帮你做什么

- **查资料**：搜索社区话题、查看近期内容、阅读完整讨论，并让 AI 归纳重点和操作步骤。
- **问问题**：基于社区现有内容回答 Oracle APEX 问题，同时给出可核对的参考话题。
- **管理个人内容**：查看我创建的、我回复的、我收藏的和我订阅的内容，并只在个人看板范围内搜索。
- **管理员运营观测**：具备管理员权限时，按日期和用户查看 apexcn-cli 调用量、异常分布和显式搜索关键词趋势。
- **参与社区交流**：起草、发布、修改或删除话题与回复，收藏、订阅，以及在有权限时标记正确答案。
- **保留来源**：结果会显示完整话题标题和可直接打开的社区页面；转载内容还会单独显示原文链接。

涉及发布、修改、删除、收藏、订阅或标记答案时，`apexcn-cli` 会先让 AI 展示预览。只有你明确确认后，才会执行刚才看到的那项操作。

## 用 AI 工具开始使用

`apexcn-cli` 的主要使用方式不是手工输入命令，而是让能够在本机执行命令的 AI 工具代为调用。WorkBuddy、千问办公、Codex 等工具只要具备本地命令执行能力，就可以按下面的流程使用。

唯一官方 GitHub 仓库是 [wfg2513148/apexcn-cli](https://github.com/wfg2513148/apexcn-cli)。安装时请始终使用该地址，不要从同名或相似名称的仓库下载安装脚本。

### 开始前：确认 AI 工具具备两项能力

在 WorkBuddy、千问办公或 Codex 中新建一个本地任务，确认该工具可以：

1. 在你的电脑上执行安装和诊断命令；
2. 使用本机的安全密钥或环境变量设置，而不是要求你把 Key 发到普通对话中。

不同工具的入口名称可能不同，但后续的安装、配置和使用提示完全相同。

### 1. 让 AI 安装

在 AI 工具中直接发送：

> 请从官方 GitHub 仓库 https://github.com/wfg2513148/apexcn-cli 在本机安装 apexcn-cli。只使用该仓库的官方安装器；安装后运行 `apexcn --version` 并告诉我结果。安装阶段不要向我索取、记录或显示 API Key。

安装器会安装 CLI，并显示升级、回滚和卸载方法。安装程序需要 Node.js 20 或更高版本；缺少时，让 AI 先安装合适的 Node.js 再继续。

### 2. 首次配置 API Key

先在 [APEX 中文社区](https://oracleapex.cn/) 登录账号，在 **API Key 管理** 中复制 Key。不要把 Key 粘贴到普通聊天、帖子、截图或 issue 中。

安装完成后，`apexcn` 已注册为全局命令。最容易理解的做法是打开一次终端：macOS 打开 **终端**，Windows 打开 **PowerShell**，然后依次执行下面两行。把第二行中的示例文字替换成刚刚复制的真实 Key：

```bash
apexcn auth set-token "在这里粘贴你的 API Key"
apexcn doctor --json
```

第一行保存 Key，第二行会检查当前账号、板块和搜索功能。输出只显示脱敏后的 Key。若终端提示找不到 `apexcn`，请回到上一步，让 AI 重新安装并检查 `apexcn --version`。

如果你已经会在 AI 工具的安全密钥或环境变量设置中保存变量，也可以将 Key 保存为 `APEXCN_API_KEY`，再让 AI 配置和验证；这是一种可选的高级方式，不是开始使用的前提。无论选择哪种方式，都不要把完整 API Key 发到普通对话中。

### 3. 直接让 AI 使用社区

配置完成后，继续在同一个 AI 工具中用自然语言提出需求。例如：

> 请查看最近 7 天更新的 APEX 中文社区话题，按板块归类，并给出每篇的社区链接。

> 请在 APEX 中文社区搜索“ORDS 认证失败”，总结最相关的 5 篇话题，并显示完整标题、社区链接和原文链接。

> 请根据社区现有内容回答“Oracle APEX 如何调用 REST API”，为关键结论附上对应话题标题和链接。

阅读与搜索由 AI 在后台调用 `apexcn-cli` 完成。你不需要再输入命令行；发布、修改、删除、收藏、订阅和标记答案时，AI 仍会先显示预览，只有你明确确认后才会执行。

### 备用：在终端手动安装和配置

如果你明确希望自行使用终端，可以使用以下安装命令。

macOS / Linux：

```bash
bash -euo pipefail -c 'tmp="$(mktemp)"; trap "rm -f \"$tmp\"" EXIT; curl -fsSL -o "$tmp" https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh; bash "$tmp"'
```

Windows PowerShell：

```powershell
irm "https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.ps1" | iex
```

安装命令不接收 API key，认证只在安装成功后单独配置。

### 备用：手动获取和绑定 API Key

API Key 用来确认 `apexcn-cli` 正在以你的社区账号访问内容：

1. 打开 [APEX 中文社区](https://oracleapex.cn/)；
2. 注册或登录账号；
3. 打开右上角账号菜单，选择 **API Key 管理**；
4. 点击 **复制**。

API Key 和密码一样重要。不要把它贴到帖子、聊天记录、GitHub issue 或截图中。

如果你希望步骤最少，请在自己的终端中执行下面的命令，并把示例文字替换成刚刚复制的真实 Key：

```bash
apexcn auth set-token "YOUR_API_KEY"
apexcn auth audit
```

`YOUR_API_KEY` 只是占位文字，不能原样使用。因为终端可能保留命令历史，公共电脑或更重视安全的场景建议使用环境变量方式：

```bash
export APEXCN_API_KEY="YOUR_API_KEY"
apexcn auth set-token --token-env APEXCN_API_KEY
apexcn auth audit
```

Windows PowerShell：

```powershell
$env:APEXCN_API_KEY="YOUR_API_KEY"
apexcn auth set-token --token-env APEXCN_API_KEY
apexcn auth audit
```

最后可以让 AI 验证：

> 请检查 apexcn-cli 当前登录的是哪个社区账号，并确认搜索功能可用。不要显示完整 API Key。

## APEX 中文社区是什么

APEX 中文社区汇集了 Oracle APEX 用户分享的问题解答、入门教程、进阶技巧和实践经验。你仍然可以直接打开社区网页阅读和交流；`apexcn-cli` 的作用，是让本地 AI 帮你更快地找到、理解和使用这些内容。

![APEX 中文社区首页和内容板块](docs/assets/readme/apexcn-community-home.jpg)

常见内容包括：

- **问题求助**：查找相似问题或向社区描述自己的问题；
- **新手入门**：了解环境搭建、基础功能和常见操作；
- **进阶技巧**：阅读开发技巧、最佳实践和完整案例；
- **建议与反馈**：提出社区使用建议或反馈问题。

## 如何获取 API Key

登录社区后，在账号菜单中打开 **API Key 管理**，即可复制当前 Key。

![APEX 中文社区 API Key 管理弹窗](docs/assets/readme/apexcn-api-key-management.png)

弹窗中的 **重新生成** 会立即撤销旧 Key。只有在 Key 丢失、疑似泄露或确实需要更换时才使用。

如果忘记绑定方法，直接运行：

```bash
apexcn auth --help
```

帮助信息会同时显示最简单的绑定方式、更安全的环境变量方式和验证命令。

## 可以直接对 AI 这样说

### 查找和理解资料

> 请在 APEX 中文社区搜索“ORDS 认证失败”，总结最相关的 5 篇话题，并显示完整标题、社区链接和原文链接。

> 请告诉我最近 7 天有哪些最近更新的话题，按板块分类，并概括每篇适合解决什么问题。

也可以直接在终端查看最近更新的话题：

```bash
apexcn topic recent --since-hours 168 --page-size 10 --json
```

`topic recent` 用于浏览最近更新的话题；不要把空关键词传给 `search` 来代替它。

> 请根据社区现有内容回答“Oracle APEX 如何调用 REST API”，为关键结论附上对应话题标题和链接。

### 使用个人看板

> 打开我的个人看板，分别显示我创建的、我回复的、我收藏的和我订阅的内容。

> 只在我收藏和订阅的内容中搜索 ORDS，不要搜索整个社区。

### 参与社区

> 请先搜索是否已有相似讨论，再帮我起草一篇关于 APEX 调用 REST API 返回 401 的求助帖。先给我预览，不要发布。

> 请回复刚才选中的话题，补充我的测试结果。先显示目标话题和回复内容，等我确认后再发布。

> 请把刚才选中的回复标记为正确答案。先检查我是否有权限并显示预览，等我确认后执行。

> 请收藏这个话题并订阅后续更新。执行前先让我确认目标内容。

### 管理员运营观测

> 请检查当前账号是否具备管理员运营权限，然后查看最近七天 apexcn-cli 的调用量、失败情况和搜索关键词趋势。不要显示 API Key、请求正文或 ask 问题内容。

帖子和回复编号应从实际搜索结果或你的个人内容中选择，不要把示例编号当作当前线上内容。

更多可直接复制的话术见 [中文用户手册](docs/user-guide.zh.md)。

## 链接和参考来源

当结果对应社区中的话题、回复、收藏或订阅内容时，CLI 会使用社区现有网页地址，不会另外制作一套重复页面。

- 需要校验信息的社区链接由社区系统直接提供，点击后可打开对应页面；
- 转载内容的 **社区页面** 和 **原文链接** 会分别显示；
- AI 引用资料时应显示完整话题标题，而不是只显示 `S1`、`S4` 之类的内部编号；
- 部分个人页面需要先在浏览器中登录社区。CLI 的 API Key 登录不会自动替代浏览器登录。

## 安全边界

- 搜索、阅读和总结只会读取内容；
- 发布、修改、删除、收藏、订阅和标记答案会先预览，再等待明确确认；
- 预览后如果内容、账号或目标状态发生变化，需要重新预览；
- CLI 不会要求你把 API Key 发布到社区或提交到 GitHub；
- `apexcn-cli` 是社区访问工具，不是 Oracle 官方产品。

## 遇到问题

可以先对 AI 说：

> apexcn-cli 好像不能用了。请检查安装版本、API Key 配置、当前账号、社区连接和搜索功能，告诉我失败在哪一步。不要输出完整 API Key。

也可以在终端运行：

```bash
apexcn auth audit --json
apexcn doctor --json
```

`auth audit` 只检查本地配置；`doctor` 才会检查社区 API。若提示 API Key 被拒绝，请在社区重新复制或生成 Key 后运行 `apexcn auth set-token "NEW_API_KEY"`，再执行 `apexcn doctor --json` 验证。浏览器登录与 CLI 的 API Key 是两个独立会话。

进一步资料：

- [用户手册（中文）](docs/user-guide.zh.md)
- [User Guide (English)](docs/user-guide.en.md)
- [命令行终端手册](docs/cli-manual.zh.md)
- [Terminal Manual (English)](docs/cli-manual.en.md)
- [安全说明](docs/security-model.md)
