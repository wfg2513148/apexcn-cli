---
name: apexcn-cli
description: Use apexcn-cli to access APEX Chinese Community ORDS REST APIs from a local AI agent.
---

# apexcn-cli

Use this skill when a user asks an AI agent to search, ask RAG questions, publish, edit, delete, favorite, subscribe, or inspect APEX Chinese Community content through `apexcn-cli`.

## Before Acting

1. Confirm the `apexcn` command is available:

```bash
apexcn --help
```

2. Confirm auth without exposing secrets:

```bash
apexcn auth show --json
apexcn me --json
```

不要输出完整 API key。Do not output the full API key. If auth is missing and `APEXCN_API_KEY` is available, configure it:

```bash
apexcn auth set-token \
  --profile agent-prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "$APEXCN_API_KEY"
```

## Agent Rules

- Always pass `--json` for machine-readability.
- Prefer `--content-file` for long posts or replies.
- Before creating a topic, run `apexcn category list --json` and use a valid `--category-id`.
- Do not rely on interactive prompts. Supply required non-interactive flags explicitly.
- Before deleting a topic, run `apexcn topic view <thread_id> --json`, then pass `--yes --force --confirm-title "<exact title>"`.
- Before deleting a reply, confirm the target post id belongs to the intended thread, then pass `--yes --force`.
- Treat `401` as auth/token failure, `403` as permission/config denial, `409` as state conflict, and `429` as rate limiting.
- Preserve stderr and `requestId` in logs for troubleshooting.
- Do not output full API key, local config file contents, or other secrets.

## Common Commands

```bash
apexcn search "APEX" --page-size 5 --json
apexcn ask "Oracle APEX 如何调用 REST API？" --top-k 3 --json
apexcn topic view 30549 --json
apexcn topic create --category-id 4 --title "标题" --content-file ./post.md --json
apexcn topic edit 30549 --content-file ./updated.md --json
apexcn reply create 30549 --content "回复内容" --json
```
