# apexcn-cli 命令行终端手册

这份面向在终端中直接执行命令的用户。所有示例默认已经完成安装和认证。

## 全局

```bash
apexcn --help
apexcn --version
apexcn help search
apexcn commands --json
apexcn --config /tmp/apexcn-config.json auth show --json
```

建议脚本和 AI agent 都加 `--json`，方便解析。自动化需要隔离配置文件时，可使用根选项 `--config <path>` 或环境变量 `APEXCN_CONFIG_PATH`。

AI agent 需要判断命令、别名、用途、风险分类、安全示例和可用选项时，优先使用 `apexcn commands --json`，不要解析 `--help` 文本。当前结构化 manifest 契约为 `schemaVersion === 1`；如果缺失或不支持，不要消费结构化的 `safety` 或 `examples` 字段，应升级 CLI 或请求用户确认。manifest 中的 `schema` 列出可用枚举值；`safety.effects` 描述命令影响，`safety.preview` 描述是否支持或要求预览，`safety.confirmation` 列出显式确认参数，`examples[].mode` 区分读取、预览和执行示例。

网络不稳定时，可设置 `APEXCN_HTTP_TIMEOUT_MS` 为所有社区 API 请求提供默认超时；`doctor --timeout-ms` 会覆盖这个默认值。空值或非正整数会被忽略。

脚本需要解析失败原因时，可设置 `APEXCN_ERROR_FORMAT=json`，content/me 等 API 命令会把错误写成单行 JSON 到 stderr；默认仍输出人类可读文本。

## auth

保存 API key：

```bash
apexcn auth set-token \
  --profile agent-prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "$APEXCN_API_KEY"
```

`--token`、`--profile` 和 `--base-url` 不能是空字符串或只有空白字符。`--base-url` 必须是绝对 `http` 或 `https` URL。如果传环境变量，先确认变量已经设置。
如果只想保存 profile 而不切换当前 profile，加 `--no-switch`。

查看当前 profile：

```bash
apexcn auth show
apexcn auth show --json
apexcn auth list
apexcn auth list --json
apexcn auth use agent-prod
apexcn auth remove old-profile
```

退出当前 profile：

```bash
apexcn auth logout
```

## me

查看当前账号：

```bash
apexcn me
apexcn me --json
apexcn me --verbose --json
apexcn me --format text
```

## doctor

检查安装、登录和 API 连通性：

```bash
apexcn doctor
apexcn doctor --json
apexcn doctor --format json
apexcn doctor --format text
apexcn doctor --check-ask "Oracle APEX 如何调用 REST API？" --json
apexcn doctor --timeout-ms 10000 --json
```

`doctor` 默认输出文本。`--format json` 输出压缩 JSON；`--json` 和 `--format pretty` 输出格式化 JSON。JSON 输出包含 CLI 版本、User-Agent、配置文件路径、Node.js 版本、平台和架构等诊断信息。默认只检查 profile、账号、板块和搜索；只有显式传 `--check-ask <question>` 时才会额外检查 RAG 问答接口。`--timeout-ms` 可为每个检查设置毫秒级请求超时。

## category

列出板块：

```bash
apexcn category list
apexcn category list --json
apexcn category list --format text
```

## search

基础搜索：

```bash
apexcn search "Oracle APEX" --json
apexcn search "Oracle APEX" --format text
```

限制数量：

```bash
apexcn search "REST API" --page-size 5 --json
```

按板块搜索：

```bash
apexcn search "ORDS" --category-id 4 --page-size 10 --json
```

按更新时间范围搜索：

```bash
apexcn search "JSON" --from-date 2026-01-01 --to-date 2026-12-31 --json
```

`--page-size` 支持 1 到 50。当前搜索接口不支持 offset 翻页。需要缩小范围时，优先使用 `--category-id`、`--from-date` 和 `--to-date`。

## research

一次搜索并抓取前几条帖子，生成适合 AI agent 总结和引用的研究包：

```bash
apexcn research "REST API" --limit 3 --json
apexcn research "ORDS" --category-id 4 --from-date 2026-01-01 --format text
```

`--limit` 支持 1 到 10，默认 3。JSON 输出固定包含 `query`、`items`、`topics`、`links`、`requestIds` 和 `errors`。单个帖子抓取失败时，命令仍输出已完成的研究包并把失败写入 `errors`，同时返回非零退出码。

## draft

本地生成可审阅的问题草稿，不读取认证配置，不调用社区 API，也不会发布内容：

```bash
apexcn draft question \
  --title "APEX 中调用 REST API 返回 403" \
  --problem "页面进程调用 REST API 时返回 403。" \
  --environment "APEX 24.1 / ORDS 24" \
  --tried "确认 URL 可以从浏览器访问。" \
  --expected "返回 JSON 数据。" \
  --actual "返回 403。" \
  --json
```

JSON 契约固定为 `kind`、`schemaVersion`、`title`、`content`、`sections` 和 `references`。`content` 是完整 Markdown 正文；`sections` 固定包含 `problem`、`environment`、`tried`、`expected` 和 `actual`；空字段在 JSON 中保留为空字符串，在 Markdown 中显示为 `待补充`。

接入 `research` 研究包：

```bash
apexcn research "REST API" --limit 3 --json > research.json
apexcn draft question \
  --title "APEX 中调用 REST API 返回 403" \
  --problem "页面进程调用 REST API 时返回 403。" \
  --research-file research.json \
  --format text > question.md
apexcn topic create --category-id 4 --title "APEX 中调用 REST API 返回 403" --content-file question.md --preview
```

`--research-file <path>` 接受 `research --json` 输出，也可用 `--research-file -` 从 stdin 读取。引用会按 `url`、`originalUrl`、`id` 去重，并按 `links`、`items`、`topics` 的顺序提取 `id`、`title`、`url` 和 `originalUrl`。只有 `--format text` 输出适合作为 `topic create --content-file` 的 Markdown 正文；JSON 输出用于审查和脚本处理。

## topic / thread

`thread` 是 `topic` 的别名。

查看帖子：

```bash
apexcn topic view 30549 --json
apexcn thread view 30549 --json
apexcn topic view 30549 --format text
```

创建帖子，正文来自文件：

```bash
apexcn topic create \
  --category-id 4 \
  --title "APEX 中如何调用 REST API？" \
  --content-file ./post.md \
  --tags "APEX,ORDS,REST" \
  --preview
```

确认预览输出无误后再执行：

```bash
apexcn topic create \
  --category-id 4 \
  --title "APEX 中如何调用 REST API？" \
  --content-file ./post.md \
  --tags "APEX,ORDS,REST" \
  --json
```

创建帖子，正文来自命令行参数：

```bash
apexcn topic create \
  --category-id 4 \
  --title "APEX REST API 示例" \
  --content "想请教一个 APEX 调用 REST API 的问题。" \
  --json
```

创建帖子，正文来自 stdin：

```bash
printf '正文来自 stdin\n' | apexcn topic create --category-id 4 --title "stdin 示例" --content-file - --json
```

正文来源三选一：`--content-file`、`--content` 或 stdin。不要同时传 `--content` 和 `--content-file`，CLI 会拒绝执行。`--content-file -` 会明确读取 stdin；如果文件名真的叫 `-`，请写成 `--content-file ./-`。

编辑帖子：

```bash
apexcn topic update 30549 --content "更新后的正文。" --json
apexcn topic edit 30549 --title "更新后的标题" --content-file ./updated-post.md --json
apexcn thread edit 30549 --tags "APEX,REST" --json
```

删除帖子：

```bash
apexcn topic delete 30549 \
  --yes \
  --force \
  --confirm-title "完整标题" \
  --json
```

## reply / post

`post` 是 `reply` 的别名。

创建回复：

```bash
apexcn reply create 30549 --content "这个方法可行。" --json
apexcn reply create 30549 --content-file ./reply.md --json
printf '正文来自 stdin\n' | apexcn reply create 30549 --content-file - --json
```

创建楼中楼回复：

```bash
apexcn reply create 30549 --parent-post-id 201480 --content "补充说明。" --json
```

编辑回复：

```bash
apexcn reply update 201480 --content "更新后的回复。" --json
apexcn reply edit 201480 --content-file ./reply-updated.md --json
apexcn post edit 201480 --content "使用 post 别名更新。" --json
```

删除回复：

```bash
apexcn reply delete 201480 --yes --force --json
apexcn post delete 201480 --yes --force --json
```

## favorite

收藏帖子：

```bash
apexcn favorite add 30549 --json
```

取消收藏：

```bash
apexcn favorite remove 30549 --json
```

## subscription

订阅帖子：

```bash
apexcn subscription add 30549 --json
```

取消订阅：

```bash
apexcn subscription remove 30549 --json
```

## ask

使用社区内容问答：

```bash
apexcn ask "Oracle APEX 如何调用 REST API？" --json
apexcn ask "ORDS OAuth2 Bearer token 怎么生成？" --top-k 3 --json
apexcn ask "Oracle APEX 如何调用 REST API？" --format text
```

## 常用组合

只读真实环境验收。没有 `APEXCN_API_KEY` 时脚本会跳过；有 key 时会检查 `doctor`、`me`、`category list`、`search` 和 `ask`，写操作只做 `--preview`：

```bash
npm run test:e2e:readonly
```

搜索后查看第一条：

```bash
apexcn search "REST API" --page-size 5 --json
apexcn topic view 30354 --json
```

发帖前确认板块：

```bash
apexcn category list --json
apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --json
```

删除前确认标题：

```bash
apexcn topic view 30549 --json
apexcn topic delete 30549 --yes --force --confirm-title "完整标题" --json
```

## API 写操作 dry-run 分类

安装脚本的 `--dry-run` 和 CLI API 命令预览是两件事。安装脚本 dry-run 用于检查安装动作；CLI API `--preview` / `--dry-run` 用于打印将要发送的社区 API 写请求但不联网执行。CLI API 预览只覆盖 `topic create/update/edit/delete`、`reply create/update/edit/delete`、`favorite add/remove`、`subscription add/remove`，别名 `thread` 和 `post` 继承同样分类。`ask` 虽然使用 POST，但属于只读 RAG 问答，不纳入 API 写操作预览。预览下不需要预先执行 `category list` 或 `topic view`；创建话题仍必须显式传 `--category-id`，删除话题仍必须传 `--yes --force --confirm-title`。
