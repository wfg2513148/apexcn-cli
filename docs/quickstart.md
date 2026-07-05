# apexcn-cli 快速使用手册

面向两类使用者：

- human：在终端里手动搜索、提问、发帖、回帖和维护自己的内容。
- AI agent：以非交互、可审计、可重复的方式调用 APEX 中文社区。

完整手册：

- 小白用户手册（中文）：[user-guide.zh.md](user-guide.zh.md)
- Beginner guide (English)：[user-guide.en.md](user-guide.en.md)
- 命令行终端手册（中文）：[cli-manual.zh.md](cli-manual.zh.md)
- Terminal manual (English)：[cli-manual.en.md](cli-manual.en.md)

## 1. 定位

`apexcn-cli` 是 APEX 中文社区的命令行客户端。它把社区已经开放的 ORDS REST API 封装成稳定的终端命令，让人和本地 AI agent 都能在浏览器之外访问社区能力。

它适合这些场景：

- 在终端里搜索社区话题、查看帖子、收藏和订阅内容。
- 用本地 AI 工具读取社区知识，辅助排查 APEX、ORDS、SQL、PL/SQL 等问题。
- 让 AI agent 以可审计的命令方式发布、编辑或删除当前账号有权限管理的帖子和回复。
- 把社区内容操作纳入脚本、自动化流程或个人知识工作流。

它不是数据库直连工具，也不是管理员后门。CLI 只能通过 API key 代表当前社区账号操作，所有权限判断都在服务端完成：不能删除他人的帖子，不能绕过禁言、锁帖、板块权限或系统配置。

可以把它理解成三层关系：

- `APEX 中文社区`：真实网站和数据所在。
- `ORDS REST API`：受权限控制的服务端接口。
- `apexcn-cli`：人和 AI agent 调用这些接口的命令行外壳。

对 human 来说，它减少了打开浏览器、复制粘贴和手动检索的成本。对 AI agent 来说，它提供了比网页操作更稳定、更可记录、更容易复现的社区访问方式。

## 2. 一键安装

`apexcn-cli` 优先提供面向 AI agent 的一键安装方式。用户只需要把一行命令发给自己的 AI agent；agent 会自动完成：

- 检测操作系统和基础工具。
- 在允许的情况下安装缺失的 `git`、Node.js、npm。
- 从 GitHub Release 下载稳定文件名的安装脚本和 CLI 压缩包。
- 安装依赖并构建 CLI。
- 创建本机 `apexcn` 命令。
- 可选把 skill 安装到已检测到的 Codex、Claude、OpenCode 等 AI 工具中，让后续 agent 知道如何安全调用 CLI。
- 如果安装命令是在支持的 AI 工具内执行，默认会把 skill 安装到当前用户运行该命令的 AI 工具全局 Skills 目录。
- 如果提供 `APEXCN_API_KEY`，自动配置生产 API profile。

当前生产 ORDS base URL 是：

```bash
https://oracleapex.cn/ords/api
```

### 给 AI agent 的一行命令

macOS / Linux：

```bash
curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/download/v0.18.3/install-agent.sh | APEXCN_API_KEY='你的_API_KEY' APEXCN_CLI_INSTALL_AGENT_SKILLS=1 bash -s -- --yes
```

Windows PowerShell：

```powershell
$env:APEXCN_API_KEY="你的_API_KEY"; $env:APEXCN_CLI_YES="1"; $env:APEXCN_CLI_INSTALL_AGENT_SKILLS="1"; irm "https://github.com/wfg2513148/apexcn-cli/releases/download/v0.18.3/install-agent.ps1" | iex
```

安装脚本默认下载固定文件名的 CLI 包：

```bash
https://github.com/wfg2513148/apexcn-cli/releases/download/v0.18.3/apexcn-cli.tgz
https://github.com/wfg2513148/apexcn-cli/releases/download/v0.18.3/checksums.txt
```

即使 CLI 版本更新，上述 URL 和压缩包文件名也保持不变。安装脚本默认用 `checksums.txt` 校验 `apexcn-cli.tgz`；只有显式设置 `APEXCN_CLI_SKIP_CHECKSUM=1` 时才跳过校验。

如果只是让 agent 先检查会做什么，把 macOS / Linux 命令最后的 `--yes` 改为：

```bash
--dry-run --yes --install-agent-skills
```

Windows 可加：

```powershell
$env:APEXCN_CLI_DRY_RUN="1"
```

自动化测试或受控环境中，如需禁止安装脚本根据当前 AI 工具自动写入 skill，可设置 `APEXCN_CLI_CURRENT_AGENT=none`；显式设置 `APEXCN_CLI_INSTALL_AGENT_SKILLS=1` 时仍会安装已检测到的工具 skill。

安装完成后验证：

```bash
command -v apexcn
apexcn auth show --json
apexcn auth audit --json
apexcn me --json
apexcn category list --json
```

如果 shell 找不到 `apexcn`，或者 `command -v apexcn` 显示的不是安装脚本最后输出的目录，先把该目录放到 `PATH` 前面。macOS / Linux 默认是 `~/.local/bin`，Windows 默认是 `%LOCALAPPDATA%\apexcn\bin`。

### 本地源码开发模式

开发者也可以从当前仓库源码直接运行：

```bash
npm install
npm run build
```

`npm install` 可能提示依赖审计或 install script 审批信息。快速试用时可以先继续完成构建；正式发布前再按项目安全流程处理依赖审计。

源码运行命令：

```bash
node dist/index.js <command>
```

为了让下面的示例可以直接复制，也可以在当前 shell 里设置临时 alias：

```bash
alias apexcn='node dist/index.js'
```

一键安装或以后作为 npm 包安装后，命令名是：

```bash
apexcn <command>
```

下面统一用 `apexcn` 表示 CLI 命令。源码模式下可替换为 `node dist/index.js`。

## 3. 登录与配置

保存 API key：

```bash
apexcn auth set-token \
  --profile prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "$APEXCN_API_KEY"
```

保存后，`prod` 会成为当前 active profile。后续命令不需要再传 `--profile`。

`--token`、`--profile` 和 `--base-url` 不能是空字符串或只有空白字符；`--base-url` 必须是绝对 `http` 或 `https` URL。如果使用环境变量，先确认变量已经设置。

查看当前配置，不会泄露完整 token：

```bash
apexcn auth show
apexcn auth show --json
apexcn auth audit --json
apexcn auth list --json
```

`auth audit` 是纯本地配置审计，不调用社区 API。它会检查 active profile、profile 是否存在、base URL 是否有效、token 是否缺失、是否使用 HTTP、以及多个 profile 是否复用同一 base URL；输出只包含脱敏 token。

需要维护多个 API profile 时，可用 `auth set-token --no-switch` 保存但不切换当前 profile，用 `auth use <profile>` 切换，用 `auth remove <profile>` 删除。删除当前 profile 会清空 active profile，但不会自动切到其他账号。

验证当前身份：

```bash
apexcn me
apexcn me --json
apexcn me --verbose --json
apexcn me --format text
```

退出当前 profile：

```bash
apexcn auth logout
```

配置文件默认保存在：

```bash
~/.apexcn/config.json
```

自动化测试或一次性脚本需要隔离配置时，可在根命令位置传 `--config <path>`，也可以设置 `APEXCN_CONFIG_PATH`。
AI agent 需要生成命令时，应先读取 `apexcn commands --json`。当前支持 `schemaVersion === 1` 和 additive `manifestVersion === 2`；如果缺失或不支持，不要消费结构化的 `safety` 或 `examples` 字段，应升级 CLI 或请求用户确认。确认 schema 后，再使用其中的 `schema`、`safety.effects`、`safety.preview`、`safety.confirmation` 和 `examples[].mode` 判断命令风险与安全调用方式。需要机器校验时可读取：

```bash
apexcn commands --json-schema
```

网络不稳定时，可设置默认请求超时：

```bash
export APEXCN_HTTP_TIMEOUT_MS=10000
```

空值或非正整数会被忽略。

脚本需要解析错误时，可设置：

```bash
export APEXCN_ERROR_FORMAT=json
```

文件权限会尽量设为 `0600`。一个社区账号只允许一个 active API key；轮换 API key 会让旧 key 失效。

## 4. 基本读取

列出板块：

```bash
apexcn category list
apexcn category list --json
apexcn category list --format text
```

搜索话题：

```bash
apexcn search APEX --page-size 5 --json
apexcn search APEX --page-size 5 --format text
apexcn search "向量索引" --category-id 4 --from-date 2026-01-01 --to-date 2026-12-31 --json
apexcn research "REST API" --limit 3 --json
apexcn collection build --query "REST API" --query "ORDS" --topic-id 30549 --output-dir ./collection --json
apexcn collection verify --dir ./collection --json
apexcn draft question --title "APEX 问题" --problem "现象描述" --research-file research.json --format text
apexcn draft reply --topic-id 30549 --answer "回复建议" --format text
apexcn review topic --title "APEX 问题" --content-file question.md --category-id 4 --json
apexcn review reply --topic-id 30549 --content-file reply.md --json
apexcn workflow plan --goal ask-question --keyword "REST API" --title "APEX 问题" --problem "现象描述" --category-id 4 --json
apexcn workflow run --goal ask-question --keyword "REST API" --title "APEX 问题" --problem "现象描述" --category-id 4 --output-dir ./run --json
apexcn workflow approve --run-dir ./run --approved-by reviewer --note "preview reviewed" --json
apexcn workflow verify --run-dir ./run --write-report --json
apexcn workflow export --run-dir ./run --output ./workflow-bundle.json --json
apexcn workflow verify-bundle --bundle ./workflow-bundle.json --json
apexcn workflow run --resume ./run --execute --yes --json
```

`--page-size` 支持 1 到 50。搜索结果如果返回 `page.nextCursor`，用 `apexcn search "<关键词>" --cursor "<nextCursor>" --json` 读取下一页；`--offset` 仅作为兼容参数保留。需要缩小搜索范围时，用 `--category-id`、`--from-date` 和 `--to-date`。
需要查看最新帖子时，用 `apexcn topic recent --since-hours 48 --json`；CLI 会优先调用 `GET /api/v1/topics`，旧服务端会自动降级到搜索和帖子详情组合。
需要给 AI agent 一次性整理可引用资料时，用 `research` 直接生成搜索结果和帖子详情组合的研究包。
需要把多个搜索词和指定帖子整理成可离线复用的资料库时，用 `collection build`；使用前可用 `collection verify` 本地校验文件 hash 和 topic artifact。
需要把问题信息和研究包整理成可发帖正文时，用本地 `draft question` 生成 Markdown 草稿。该命令不需要认证、不调用 API；`--format text` 输出可保存为 `question.md` 并传给 `topic create --content-file`。
需要先起草回帖时，用本地 `draft reply --format text` 生成 Markdown 回复，再传给 `reply create --content-file` 做 API 预览。
发布预览前，用本地 `review topic` 检查 Markdown 草稿是否仍含 `待补充`、过短正文或疑似密钥；该命令不替代 `topic create --preview`。
发布回复前，用本地 `review reply` 检查回复草稿、topic id、parent post id、重复行和疑似密钥；普通 Markdown 文件输入会给出 `reply create --dry-run` 建议命令。
需要让 AI agent 先给出完整可审计步骤时，用本地 `workflow plan` 生成机器可读计划；它只规划，不执行命令。
需要让 CLI 直接执行可恢复工作流时，用 `workflow run`；默认只读取 API 并写入本地产物和 `preview.json`。审查后用 `workflow approve` 写入 hash 绑定的 `approval.json`，只有批准未过期时 `--resume <run-dir> --execute --yes` 才会发送最终 POST。
需要归档或复核工作流证据时，用 `workflow verify` 本地校验 artifact 图、approval hash 和 execute 请求一致性；`--write-report` 会写入 `verification.json`。
需要把工作流证据交给外部系统或人工审计时，用 `workflow export` 生成单文件 `workflow-bundle`，其中包含 verification report 和 artifact 内容/hash。
只拿到 bundle 文件时，用 `workflow verify-bundle` 独立校验 bundle schema、artifact content/hash、embedded verification 和 preview/approval/execute 链。

查看话题：

```bash
apexcn topic view 30549 --json
apexcn thread view 30549 --json
apexcn topic view 30549 --format text
```

`thread` 是 `topic` 的别名。

RAG 问答：

```bash
apexcn ask "Oracle APEX 如何调用 REST API？" --top-k 3 --json
apexcn ask "Oracle APEX 如何调用 REST API？" --format text
```

生产当前 `API_ENABLE_RAG=N`，所以 `ask` 的预期行为是返回 `HTTP 403`。管理员启用 `API_ENABLE_RAG=Y` 后才会返回回答。

## 5. 发帖与编辑

创建话题：

```bash
apexcn topic create \
  --category-id 4 \
  --title "APEX 中如何使用 OPEN_QUERY_CONTEXT？" \
  --content-file ./post.md \
  --tags "APEX,SQL,AI" \
  --json
```

人类在 TTY 终端里可以省略 `--category-id`，CLI 会列出可发帖板块让你选择。

AI agent 必须传 `--category-id`，不要依赖交互选择。

编辑话题：

```bash
apexcn topic edit 30687 \
  --title "新的标题" \
  --content-file ./updated.md \
  --tags "APEX,ORDS" \
  --json
```

也可以用 `update`：

```bash
apexcn topic update 30687 --content "新的正文" --json
```

正文来源三选一：

- 长正文用 `--content-file`
- 短正文用 `--content`
- 批处理可用 `--content-file -` 明确读取 stdin

不要同时传 `--content` 和 `--content-file`，CLI 会拒绝执行。
如果文件名真的叫 `-`，请写成 `--content-file ./-`。

示例：

```bash
printf '从 stdin 提交正文\n' | apexcn topic create --category-id 4 --title "stdin 示例" --content-file - --json
```

## 6. 删除话题

删除话题是高风险操作。非交互模式必须同时提供：

- `--yes`
- `--force`
- `--confirm-title <完整标题>`

```bash
apexcn topic delete 30687 \
  --yes \
  --force \
  --confirm-title "新的标题" \
  --json
```

如果 `--confirm-title` 与线上当前标题不一致，CLI 会拒绝删除。话题编辑过标题时，要使用编辑后的完整标题。

人类在 TTY 终端里可以不传这些参数，CLI 会加载话题并要求输入完整标题确认。

AI agent 必须使用非交互确认参数；不要模拟人工输入。

## 7. 回复

创建回复：

```bash
apexcn reply create 30687 --content "这个方法可行。" --json
printf '从 stdin 回复\n' | apexcn reply create 30687 --content-file - --json
apexcn reply create 30687 --content-file ./reply.md --json
```

回复指定父回复：

```bash
apexcn reply create 30687 --parent-post-id 201480 --content "补充说明" --json
```

编辑回复：

```bash
apexcn reply edit 201480 --content "更新后的回复" --json
apexcn post edit 201480 --content-file ./reply-updated.md --json
```

`post` 是 `reply` 的别名。

删除回复：

```bash
apexcn reply delete 201480 --yes --force --json
```

人类 TTY 模式下可以交互输入 `delete` 确认。AI agent 必须传 `--yes --force`。

## 8. 收藏与订阅

收藏：

```bash
apexcn favorite add 30687 --json
apexcn favorite remove 30687 --json
```

订阅：

```bash
apexcn subscription add 30687 --json
apexcn subscription remove 30687 --json
```

这些操作是幂等的。重复 add/remove 时，响应里的 `changed` 可能为 `false`，这不是错误。

## 9. AI Agent 使用规范

AI agent 调用 CLI 时建议固定这些规则：

- 总是使用 `--json`。
- 总是显式设置 profile，不要混用人的默认 profile。
- 首次执行前用 `auth show --json` 和 `me --json` 验证身份。
- 写入前先用 `category list --json` 获取可用板块。
- 创建话题时必须传 `--category-id`。
- 长正文用 `--content-file`，短正文用 `--content`，批处理用 `--content-file -` 明确读取 stdin。
- 删除话题必须先 `topic view <id> --json` 读取标题，再用 `--confirm-title` 精确确认。
- 捕获 stderr；HTTP 错误通常包含 `requestId`，要写入日志。
- 遇到 401 先刷新 API key；遇到 403 不要重试写入，先判断权限/禁言/RAG 开关；遇到 429 按限流退避。
- 不要在生产环境切换 `API_ENABLE_CLI`、限流、禁言、版主、锁帖等运营配置。

API 写操作预览与安装脚本的 `--dry-run` 是两件事：安装脚本 dry-run 用于检查安装动作；CLI API `--preview` / `--dry-run` 用于打印将要发送的社区 API 写请求但不联网执行。CLI API 预览只覆盖 `topic create/update/edit/delete`、`reply create/update/edit/delete`、`favorite add/remove`、`subscription add/remove`，别名 `thread` 和 `post` 继承同样分类。`ask` 虽然使用 POST，但属于只读 RAG 问答，不纳入 API 写操作预览。预览下不需要预先执行 `category list` 或 `topic view`；创建话题仍必须显式传 `--category-id`，删除话题仍必须传 `--yes --force --confirm-title`。

推荐非交互骨架：

```bash
set -euo pipefail

apexcn auth set-token \
  --profile agent-prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "$APEXCN_API_KEY"

apexcn me --json
apexcn category list --json
apexcn search "APEX" --page-size 3 --json
```

## 10. 权限与安全边界

服务端会按当前 API key 绑定的用户执行授权判断。CLI 不能绕过权限。

常见限制：

- 未登录或 token 无效：`401`
- 没有权限编辑/删除他人内容：`403`
- 被禁言用户不能发帖/回帖/编辑/删除：`403`
- 锁定话题对普通用户拒绝写入：`409`
- API 或 RAG 被配置关闭：`403` 或 `503`
- 触发限流：`429`

删除、编辑、收藏、订阅都应视为线上写操作。AI agent 需要保留输入、响应和 `requestId`，方便审计。

## 11. 常用命令速查

| 能力 | 命令 |
| --- | --- |
| 保存 token | `apexcn auth set-token --base-url https://oracleapex.cn/ords/api --token "$APEXCN_API_KEY"` |
| 查看配置 | `apexcn auth show --json` |
| 配置审计 | `apexcn auth audit --json` |
| 当前用户 | `apexcn me --json` |
| 我的统计 | `apexcn me stats --json` |
| 我的帖子 | `apexcn me topics --page-size 10 --json` |
| 我的回复 | `apexcn me replies --page-size 10 --json` |
| 我的收藏 | `apexcn me favorites --page-size 10 --json` |
| 我的订阅 | `apexcn me subscriptions --page-size 10 --json` |
| 板块列表 | `apexcn category list --json` |
| 板块统计 | `apexcn stats category --json` |
| 板块统计日期窗 | `apexcn stats category --from 2026-07-01 --to 2026-07-05 --json` |
| 话题统计 | `apexcn stats topic --tag ORDS --from 2026-07-01 --top 10 --json` |
| 标签统计 | `apexcn stats tag --from 2026-07-01 --top 20 --json` |
| 管理员列表 | `apexcn admin list --json` |
| 搜索 | `apexcn search "APEX" --page-size 5 --json` |
| 过滤搜索 | `apexcn search "ORDS" --tags APEX,ORDS --has-useful-reply --source-type external --json` |
| 话题列表 | `apexcn topic list --view unanswered --page-size 20 --json` |
| 研究包 | `apexcn research "REST API" --limit 3 --json` |
| 资料库 | `apexcn collection build --query <keyword> --topic-id <id> --output-dir <dir> --json` |
| 资料库校验 | `apexcn collection verify --dir <dir> --json` |
| 问题草稿 | `apexcn draft question --title <title> --problem <text> --research-file <file> --format text` |
| 回复草稿 | `apexcn draft reply --topic-id <thread_id> --answer <text> --format text` |
| 发布审查 | `apexcn review topic --title <title> --content-file <file> --category-id <id> --json` |
| 回复审查 | `apexcn review reply --topic-id <thread_id> --content-file <file> --json` |
| 工作流计划 | `apexcn workflow plan --goal ask-question --keyword <keyword> --title <title> --problem <text> --category-id <id> --json` |
| 工作流运行 | `apexcn workflow run --goal ask-question --keyword <keyword> --title <title> --problem <text> --category-id <id> --output-dir <dir> --json` |
| 工作流批准 | `apexcn workflow approve --run-dir <dir> --approved-by <name> --json` |
| 工作流验证 | `apexcn workflow verify --run-dir <dir> --write-report --json` |
| 工作流导出 | `apexcn workflow export --run-dir <dir> --output <file> --json` |
| Bundle 验证 | `apexcn workflow verify-bundle --bundle <file> --json` |
| RAG 问答 | `apexcn ask "问题" --top-k 3 --json` |
| 范围问答 | `apexcn ask "问题" --tag ORDS --from 2026-07-01 --to 2026-07-05 --json` |
| 查看话题 | `apexcn topic view <thread_id> --json` |
| 发帖 | `apexcn topic create --category-id <id> --title <title> --content-file <file> --json` |
| 编辑话题 | `apexcn topic edit <thread_id> --content-file <file> --json` |
| 删除话题 | `apexcn topic delete <thread_id> --yes --force --confirm-title <title> --json` |
| 回复 | `apexcn reply create <thread_id> --content <text> --json` |
| 编辑回复 | `apexcn post edit <post_id> --content <text> --json` |
| 删除回复 | `apexcn reply delete <post_id> --yes --force --json` |
| 收藏 | `apexcn favorite add <thread_id> --json` |
| 取消收藏 | `apexcn favorite remove <thread_id> --json` |
| 订阅 | `apexcn subscription add <thread_id> --json` |
| 取消订阅 | `apexcn subscription remove <thread_id> --json` |

## 12. 验证与排障

本地验证：

```bash
npm test
npm run build
```

可选只读真实环境验收：

```bash
npm run test:e2e:readonly
```

没有 `APEXCN_API_KEY` 时脚本会跳过；有 key 时会用临时配置运行 `doctor`、`me`、`category list`、`search` 和 `ask`，写操作只做 `--preview`。

排障顺序：

1. `apexcn auth show --json`
2. `apexcn doctor snapshot --json`
3. `apexcn doctor --format json`
4. `apexcn me --verbose --json`

`doctor snapshot` 不联网，适合先采集本地配置、环境变量 presence/validity 和 agent skill 安装状态；它不会输出完整 token 或 `APEXCN_API_KEY`。`doctor` 默认输出文本；`--format json` 适合脚本采集诊断字段，包括 CLI 版本、User-Agent、配置文件路径、Node.js 版本、平台和架构。默认只检查 profile、账号、板块和搜索；只有显式传 `--check-ask <question>` 时才会额外检查 RAG 问答接口。网络不稳定时可加 `--timeout-ms 10000` 设置每个检查的超时时间。
5. 检查 stderr 中的 `HTTP <status>` 和 `requestId`
6. 用 `requestId` 查服务端日志
7. 必要时轮换 API key 后重新 `auth set-token`
