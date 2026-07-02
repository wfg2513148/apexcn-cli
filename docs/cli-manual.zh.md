# apexcn-cli 命令行终端手册

这份面向在终端中直接执行命令的用户。所有示例默认已经完成安装和认证。

## 全局

```bash
apexcn --help
apexcn --version
apexcn help search
apexcn --config /tmp/apexcn-config.json auth show --json
```

建议脚本和 AI agent 都加 `--json`，方便解析。自动化需要隔离配置文件时，可使用根选项 `--config <path>` 或环境变量 `APEXCN_CONFIG_PATH`。

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
```

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

安装脚本的 `--dry-run` 和 CLI API 命令 dry-run 是两件事。安装脚本 dry-run 用于检查安装动作；CLI API dry-run 用于打印将要发送的社区 API 写请求但不联网执行。CLI API dry-run 只覆盖 `topic create/update/edit/delete`、`reply create/update/edit/delete`、`favorite add/remove`、`subscription add/remove`，别名 `thread` 和 `post` 继承同样分类。`ask` 虽然使用 POST，但属于只读 RAG 问答，不纳入 API 写操作 dry-run。dry-run 下不需要预先执行 `category list` 或 `topic view`；创建话题仍必须显式传 `--category-id`，删除话题仍必须传 `--yes --force --confirm-title`。
