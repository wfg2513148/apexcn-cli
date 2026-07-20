---
name: apexcn-cli
description: Use when the user refers to oracleapex.cn, APEX 中文社区/APEX Chinese Community, asks to search/summarize/inspect/RAG/publish community content, or asks an Oracle APEX troubleshooting/how-to question that can benefit from community references. Do not use for unrelated generic Chinese/community/forum mentions.
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
- Natural Oracle APEX troubleshooting or how-to questions such as APEX 页面报错、ORDS 401、Interactive Grid 保存失败、授权方案配置、REST API 调用, especially from users who may not know to mention the community explicitly
- `apexcn search`, `apexcn ask`, `apexcn topic`, `apexcn workflow`

Do not use this skill for:

- generic mentions of 中文社区, community, forum, 社区帖子, or RAG without APEX Chinese Community or oracleapex.cn context
- Oracle APEX questions where the user explicitly asks for official documentation only or asks not to use community knowledge

## Before Acting

1. Confirm the `apexcn` command is available:

```bash
apexcn --help
```

2. Confirm auth without exposing secrets:

```bash
apexcn auth audit --json
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
  --token-env APEXCN_API_KEY
```

This stores only the environment variable name. Pass both `--token-env` and `--token` only when a file fallback is intentionally required.
Never pass an API key to `install-agent.sh` or `install-agent.ps1`. Installation and authentication are separate operations; install first, then configure the environment-variable name with `auth set-token`.

## Agent Rules

- Pass `--json` for machine-readability by default. Exception: use `apexcn draft question --format text` when generating Markdown content for `topic create --content-file`.
- For natural Oracle APEX troubleshooting/how-to questions, use `apexcn ask "<question>" --top-k 3 --json` to retrieve community-grounded references even when the user does not explicitly say "APEX 中文社区". If the answer is weak or unanswerable, report that limitation instead of inventing an answer.
- Use `apexcn guide learning|compatibility|deployment|security|performance --json` when a novice asks for a curated task path instead of a list of search results. Treat these local guides as checklists, not Oracle support statements; compatibility and deployment conclusions still require official documentation and target-environment verification.
- Maintain conversation context in the agent. When the user asks a short follow-up such as "那第一步呢？", "具体怎么做？", "为什么？", or "这个报错怎么排？", pass the previous question/topic and key constraints with `--context "<previous question/topic and constraints>"`; do not call `apexcn ask` with only the short follow-up.
- If there is no reliable previous context for a short follow-up, ask the user for the missing topic or surface the CLI `needsContext` fallback. Do not silently answer the short follow-up as an unrelated standalone question.
- `apexcn draft question` is local-only and does not require auth preflight when you are only drafting content; run auth checks before API reads or writes.
- Use `apexcn draft reply --format text` to prepare a local Markdown reply before `reply create --content-file`.
- Use `apexcn review topic` before `topic create --preview` when you have a local Markdown draft or question-draft JSON. It is local-only, detects placeholders and possible secrets, and never publishes.
- Use `apexcn review reply` before `reply create --dry-run` when you have a local Markdown reply or reply-draft JSON. It is local-only, validates topic/parent ids, detects weak replies and possible secrets, and never publishes.
- Use `apexcn workflow plan` when you need a machine-readable sequence of local, preview, and execute steps. It only plans; it never executes commands.
- Use `apexcn workflow run` when you need the CLI to run a resumable workflow with persisted artifacts. The default run reads API data and writes local `run.json`, draft files, review data, and `preview.json`; it does not publish.
- Approve a workflow preview with `apexcn workflow approve --run-dir <run-dir> --json` after reviewing `preview.json`. This records a hash-bound approval artifact. If the selected policy requires two approvers, pass distinct `--approved-by` and `--second-approver` values.
- Only execute an approved workflow with `apexcn workflow run --resume <run-dir> --execute --yes --policy <file> --json`. Execution refuses missing or stale approvals, enforces the supplied policy before any API write, and reuses the approved preview request body for the final POST.
- Use `apexcn workflow verify --run-dir <run-dir> --json` to locally verify workflow artifacts, approval hashes, and execute evidence. Add `--write-report` when the user needs `verification.json` for audit records.
- Use `apexcn workflow export --run-dir <run-dir> --output <file> --json` when the user needs a portable single-file workflow evidence bundle for archival or external review.
- Use `apexcn workflow verify-bundle --bundle <file> --json` when reviewing a portable workflow bundle without access to the original run directory.
- Use `apexcn collection build --query <keyword> --topic-id <id> --output-dir <dir> --json` when the user needs a reusable offline knowledge collection from multiple searches or explicit topics.
- Use `apexcn collection verify --dir <dir> --json` before relying on a saved collection in an AI workflow.
- Use `apexcn collection index --dir <dir> --json` after building a collection when the user wants offline local search.
- Use `apexcn collection query --dir <dir> "<query>" --json` when answering from an existing offline collection without network access.
- Use `apexcn mcp tools --json` and `apexcn mcp inspect --json` to inspect the optional local stdio MCP adapter. MCP is readonly by default. Preview-only MCP write tools may generate requests with `willExecute: false`, but real write execution must continue through CLI workflow approval.
- Use `apexcn stats category --json`, `apexcn stats topic --json`, and `apexcn stats tag --json` when the user asks for aggregate community, category, topic, or tag counts. Add `--from/--to` and `--top` when the user asks for a date window or top tag/topic list.
- Use `apexcn admin list --json` when the user asks who administers the community; only report public fields returned by the API.
- Use `apexcn me stats --json`, `apexcn me topics --json`, `apexcn me replies --json`, `apexcn me favorites --json`, or `apexcn me subscriptions --json` when the user asks about their own activity.
- Use `apexcn topic list --view unanswered --json`, `apexcn topic list --view popular --json`, `apexcn topic list --source-domain <domain> --json`, or equivalent server-side filters when the user asks for triage, source audit, imported articles, unanswered topics, hot/popular topics, pinned/featured/locked topics, or useful-answer topics.
- Use `apexcn topic recent --since-hours 48 --json` when the user asks for recently updated or latest community posts. If `page.hasMore` is true and `page.nextCursor` is present, pass it back with `--cursor` to continue.
- Use `apexcn search "<keyword>" --tag <tag> --source-type <type> --json` when the user asks for filtered search. Prefer server-side filters such as `--tag`, `--tags`, `--author`, `--author-id`, `--source-domain`, `--original-url`, `--content-type`, `--source-type`, `--status`, `--view`, `--sort`, `--featured`, `--pinned`, `--locked`, `--unanswered`, and `--has-useful-reply`; do not crawl pages and filter client-side when the server supports the filter.
- Use `apexcn search "<keyword>" --cursor <page.nextCursor> --json` when continuing a paginated search result. Prefer cursor pagination over `--offset`; keep `--offset` only for compatibility.
- Use `apexcn research "<natural-language query>" --limit 5 --json` when the user needs a citable bundle rather than a result list. If the original phrase is too narrow, inspect `query.attemptedKeywords`, `query.selectedKeyword`, and `searchAttempts`; cite only URLs in `provenance.sources`.
- Use filtered ask flags `--category-id`, `--from/--to`, and `--tag` only when the user wants scoped reference retrieval. Treat filtered ask output as scoped references with `confidence`, `limitations`, and `filters`, not as full RAG generation unless the server contract changes.
- Use `apexcn commands --json` to inspect available commands, purposes, safety metadata, examples, and options instead of parsing help text.
- Use `apexcn auth audit --json` before API workflows when you need a local-only check for missing active profile, invalid base URLs, missing tokens, duplicate base URLs, or insecure HTTP profiles.
- Use `apexcn doctor snapshot --output <file> --json` before sharing diagnostics with a user or support channel. It is local-only, writes a user-only sanitized file, and reports config/env/agent-skill state without exposing full tokens or API key values.
- Use `apexcn me capabilities --require-capability <ids...> --json` before a workflow that depends on specific server APIs. Do not continue when `clientCompatibility.ok` is false.
- Use `apexcn workflow audit-log --run-dir <run-dir> --verify-file <file> --json` before trusting an archived JSON or NDJSON audit log.
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
- Preserve `provenance.requestIds` and `provenance.sources` from search, topic, ask, and research outputs in downstream evidence.
- Do not infer an exact total from search results. If `page.hasMore` is true, report a lower bound such as "at least N results" and suggest narrowing by category or date.
- Treat `401` as auth/token failure, `403` as permission/config denial, `409` as state conflict, and `429` as rate limiting. If stderr includes `retryAfterSeconds`, wait or report that exact retry window instead of retrying immediately.
- Preserve stderr and `requestId` in logs for troubleshooting.
- If community API calls hang or the network is unstable, set `APEXCN_HTTP_TIMEOUT_MS` to a positive millisecond value before rerunning.
- For scripts that need parseable stderr, set `APEXCN_ERROR_FORMAT=json`.
- Do not output full API key, local config file contents, or other secrets.

## Common Commands

```bash
apexcn search "APEX" --page-size 5 --json
apexcn auth audit --json
apexcn doctor snapshot --output ./support-snapshot.json --json
apexcn stats category --json
apexcn stats category --from 2026-07-01 --to 2026-07-05 --json
apexcn stats topic --tag ORDS --from 2026-07-01 --top 10 --json
apexcn stats tag --from 2026-07-01 --top 20 --json
apexcn admin list --json
apexcn me stats --json
apexcn me topics --page-size 10 --json
apexcn me replies --page-size 10 --json
apexcn me favorites --page-size 10 --json
apexcn me subscriptions --page-size 10 --json
apexcn search "ORDS" --tags APEX,ORDS --has-useful-reply --source-type external --json
apexcn topic list --view unanswered --page-size 20 --json
apexcn topic list --source-domain example.com --sort updated --json
apexcn topic recent --since-hours 48 --page-size 10 --json
apexcn research "REST API" --limit 3 --json
apexcn guide learning --json
apexcn guide compatibility --apex-version 24.2 --ords-version 24.4 --json
apexcn guide deployment --format text
apexcn collection build --query "REST API" --query "ORDS" --topic-id 30549 --output-dir ./collection --json
apexcn collection verify --dir ./collection --json
apexcn draft question --title "标题" --problem "问题描述" --research-file ./research.json --format text
apexcn draft reply --topic-id 30549 --answer "回复建议" --format text
apexcn review topic --title "标题" --content-file ./question.md --category-id 4 --json
apexcn review reply --topic-id 30549 --content-file ./reply.md --json
apexcn workflow plan --goal ask-question --keyword "REST API" --title "标题" --problem "问题描述" --category-id 4 --json
apexcn workflow run --goal ask-question --keyword "REST API" --title "标题" --problem "问题描述" --category-id 4 --output-dir ./run --json
apexcn workflow approve --run-dir ./run --approved-by reviewer --note "preview reviewed" --json
apexcn workflow audit-log --run-dir ./run --verify-file ./audit.ndjson --json
apexcn workflow verify --run-dir ./run --write-report --json
apexcn workflow export --run-dir ./run --output ./workflow-bundle.json --json
apexcn workflow verify-bundle --bundle ./workflow-bundle.json --json
apexcn workflow run --resume ./run --execute --yes --json
apexcn commands --json
apexcn ask "Oracle APEX 如何调用 REST API？" --top-k 3 --json
apexcn ask "最近 ORDS API 有哪些更新？" --tag ORDS --from 2026-07-01 --to 2026-07-05 --top-k 5 --json
apexcn topic view 30549 --json
apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --preview
apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --json
generator | apexcn topic create --category-id 4 --title "标题" --content-file - --json
apexcn topic edit 30549 --content-file ./updated.md --json
apexcn reply create 30549 --content "回复内容" --json
```
