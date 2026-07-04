---
name: apexcn-cli
description: Use when the user refers to oracleapex.cn, APEX 中文社区/APEX Chinese Community, or asks to search, summarize, inspect, ask RAG questions, publish, edit, reply, delete, favorite, or subscribe to posts on that APEX community. Do not use for generic Chinese/community/forum mentions or general Oracle APEX questions without community-content access intent.
---

# apexcn-cli

Use this skill when a user asks an AI agent to search, ask RAG questions, publish, edit, delete, favorite, subscribe, or inspect APEX Chinese Community content through `apexcn-cli`.

## Trigger Keywords

Use this skill for natural requests mentioning:

- oracleapex.cn, APEX中文社区, APEX 中文社区, Oracle APEX 中文社区, APEX Chinese Community
- APEX 社区 or APEX社区 when paired with actions like 搜索, 查找, 总结, 查看, 发帖, 回帖, 编辑, 删除, 收藏, or 订阅
- 在 APEX 中文社区搜索, 搜一下 APEX 中文社区, 查 oracleapex.cn, 总结 APEX 中文社区帖子
- 发布到 APEX 中文社区, 在 oracleapex.cn 发帖, 在 oracleapex.cn 回帖, 查看社区帖子 ID
- APEX 中文社区 RAG, 问一下 APEX 中文社区知识库
- `apexcn search`, `apexcn ask`, `apexcn topic`, `apexcn workflow`

Do not use this skill for:

- generic mentions of 中文社区, community, forum, 社区帖子, or RAG without APEX Chinese Community or oracleapex.cn context
- general Oracle APEX technical questions where the user is not asking to access, search, summarize, or publish community content

## Before Acting

1. Confirm the `apexcn` command is available:

```bash
apexcn --help
```

2. Confirm auth without exposing secrets:

```bash
apexcn doctor --json
apexcn auth show --json
apexcn me --json
apexcn commands --json
```

不要输出完整 API key。Do not output the full API key. If auth is missing and `APEXCN_API_KEY` is available, configure it:

```bash
apexcn auth set-token \
  --profile agent-prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "$APEXCN_API_KEY"
```

## Agent Rules

- Pass `--json` for machine-readability by default. Exception: use `apexcn draft question --format text` when generating Markdown content for `topic create --content-file`.
- `apexcn draft question` is local-only and does not require auth preflight when you are only drafting content; run auth checks before API reads or writes.
- Use `apexcn draft reply --format text` to prepare a local Markdown reply before `reply create --content-file`.
- Use `apexcn review topic` before `topic create --preview` when you have a local Markdown draft or question-draft JSON. It is local-only, detects placeholders and possible secrets, and never publishes.
- Use `apexcn workflow plan` when you need a machine-readable sequence of local, preview, and execute steps. It only plans; it never executes commands.
- Use `apexcn workflow run` when you need the CLI to run a resumable workflow with persisted artifacts. The default run reads API data and writes local `run.json`, draft files, review data, and `preview.json`; it does not publish.
- Approve a workflow preview with `apexcn workflow approve --run-dir <run-dir> --json` after reviewing `preview.json`. This records a hash-bound approval artifact.
- Only execute an approved workflow with `apexcn workflow run --resume <run-dir> --execute --yes --json`. Execution refuses missing or stale approvals and reuses the approved preview request body for the final POST.
- Use `apexcn workflow verify --run-dir <run-dir> --json` to locally verify workflow artifacts, approval hashes, and execute evidence. Add `--write-report` when the user needs `verification.json` for audit records.
- Use `apexcn commands --json` to inspect available commands, purposes, safety metadata, examples, and options instead of parsing help text.
- This skill supports manifest `schemaVersion === 1`. If `schemaVersion` is missing or unsupported, do not consume structured `safety` or `examples`; upgrade `apexcn-cli` or ask the user before continuing.
- Prefer manifest `examples[].command` for command shape, check `examples[].mode`, and inspect `safety.effects`, `safety.preview`, and `safety.confirmation` before writes or destructive actions.
- Prefer `--content-file` for long posts or replies. Use `--content-file -` when piping generated content through stdin.
- Never pass both `--content` and `--content-file`; choose one body source.
- Before creating a topic, run `apexcn category list --json` and use a valid `--category-id`.
- Before API writes, preview the exact request with `--preview` or `--dry-run`, show it to the user, then execute only after confirmation.
- For API write previews, do not preflight with `category list` or `topic view`; pass the same required write flags and add `--preview` or `--dry-run`.
- Do not rely on interactive prompts. Supply required non-interactive flags explicitly.
- Before deleting a topic, run `apexcn topic view <thread_id> --json`, then pass `--yes --force --confirm-title "<exact title>"`.
- Before deleting a reply, confirm the target post id belongs to the intended thread, then pass `--yes --force`.
- When reporting search results, topic summaries, or inspected content to a user, include each topic's real URL from `url` or `threadUrl`; include `originalUrl` too when present.
- Do not infer an exact total from search results. If `page.hasMore` is true, report a lower bound such as "at least N results" and suggest narrowing by category or date.
- Treat `401` as auth/token failure, `403` as permission/config denial, `409` as state conflict, and `429` as rate limiting.
- Preserve stderr and `requestId` in logs for troubleshooting.
- If community API calls hang or the network is unstable, set `APEXCN_HTTP_TIMEOUT_MS` to a positive millisecond value before rerunning.
- For scripts that need parseable stderr, set `APEXCN_ERROR_FORMAT=json`.
- Do not output full API key, local config file contents, or other secrets.

## Common Commands

```bash
apexcn search "APEX" --page-size 5 --json
apexcn research "REST API" --limit 3 --json
apexcn draft question --title "标题" --problem "问题描述" --research-file ./research.json --format text
apexcn draft reply --topic-id 30549 --answer "回复建议" --format text
apexcn review topic --title "标题" --content-file ./question.md --category-id 4 --json
apexcn workflow plan --goal ask-question --keyword "REST API" --title "标题" --problem "问题描述" --category-id 4 --json
apexcn workflow run --goal ask-question --keyword "REST API" --title "标题" --problem "问题描述" --category-id 4 --output-dir ./run --json
apexcn workflow approve --run-dir ./run --approved-by reviewer --note "preview reviewed" --json
apexcn workflow verify --run-dir ./run --write-report --json
apexcn workflow run --resume ./run --execute --yes --json
apexcn commands --json
apexcn ask "Oracle APEX 如何调用 REST API？" --top-k 3 --json
apexcn topic view 30549 --json
apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --preview
apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --json
generator | apexcn topic create --category-id 4 --title "标题" --content-file - --json
apexcn topic edit 30549 --content-file ./updated.md --json
apexcn reply create 30549 --content "回复内容" --json
```
